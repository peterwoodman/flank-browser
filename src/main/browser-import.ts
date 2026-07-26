import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { BrowserScanDto, ImportableExtensionDto, ImportResultDto } from '@shared/ipc-types';
import { extensionsDir } from './paths';
import { settingsStore } from './stores/settings-store';
import { parseExtensionManifest } from './extension-manifest';
import { newId } from './ids';
import { log, logError } from './log';

/**
 * Importing extensions from other Chromium browsers (docs/behaviors.md →
 * Extensions). Chrome and its relatives keep installed extensions already
 * unpacked, at <user data>/<profile>/Extensions/<id>/<version>_<n>/ — the same
 * shape Flank's "add unpacked folder" takes — so importing is a matter of
 * finding those folders and copying one into Flank's own data directory.
 */

interface BrowserCandidate {
  /** Shown in the picker. */
  name: string;
  /** Chromium "user data" directory: holds the profile folders and Local State. */
  userDataDir: string;
}

interface Discovered {
  extensionId: string;
  name: string;
  version: string;
  iconDataUrl: string;
  sourcePath: string;
  browser: string;
  profile: string;
}

/** The last scan, so importing works from ids the renderer already saw. */
let lastScan: Discovered[] = [];

/**
 * Chromium browsers that share Chrome's profile layout, per platform. Only the
 * root differs between them, so supporting one more is one more line.
 */
function browserCandidates(): BrowserCandidate[] {
  const home = app.getPath('home');
  // %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on
  // Linux — which is already the browser root on the latter two.
  const appData = app.getPath('appData');
  const found: BrowserCandidate[] = [];
  const add = (name: string, ...segments: string[]): void => {
    found.push({ name, userDataDir: path.join(...segments) });
  };

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    add('Google Chrome', local, 'Google', 'Chrome', 'User Data');
    add('Chrome Beta', local, 'Google', 'Chrome Beta', 'User Data');
    add('Chrome Canary', local, 'Google', 'Chrome SxS', 'User Data');
    add('Chromium', local, 'Chromium', 'User Data');
    add('Microsoft Edge', local, 'Microsoft', 'Edge', 'User Data');
    add('Brave', local, 'BraveSoftware', 'Brave-Browser', 'User Data');
    add('Vivaldi', local, 'Vivaldi', 'User Data');
  } else if (process.platform === 'darwin') {
    add('Google Chrome', appData, 'Google', 'Chrome');
    add('Chrome Beta', appData, 'Google', 'Chrome Beta');
    add('Chrome Canary', appData, 'Google', 'Chrome Canary');
    add('Chromium', appData, 'Chromium');
    add('Microsoft Edge', appData, 'Microsoft Edge');
    add('Brave', appData, 'BraveSoftware', 'Brave-Browser');
    add('Vivaldi', appData, 'Vivaldi');
  } else {
    add('Google Chrome', appData, 'google-chrome');
    add('Chrome Beta', appData, 'google-chrome-beta');
    add('Chrome Unstable', appData, 'google-chrome-unstable');
    add('Chromium', appData, 'chromium');
    add('Microsoft Edge', appData, 'microsoft-edge');
    add('Brave', appData, 'BraveSoftware', 'Brave-Browser');
    add('Vivaldi', appData, 'vivaldi');
    // Sandboxed installs relocate the whole config tree.
    const flatpak = path.join(home, '.var', 'app');
    add('Google Chrome (Flatpak)', flatpak, 'com.google.Chrome', 'config', 'google-chrome');
    add('Chromium (Flatpak)', flatpak, 'org.chromium.Chromium', 'config', 'chromium');
    add('Microsoft Edge (Flatpak)', flatpak, 'com.microsoft.Edge', 'config', 'microsoft-edge');
    add('Brave (Flatpak)', flatpak, 'com.brave.Browser', 'config', 'BraveSoftware/Brave-Browser');
    add('Chromium (Snap)', home, 'snap', 'chromium', 'common', 'chromium');
  }

  return found.filter((c) => dirExists(c.userDataDir));
}

/**
 * Profile folders inside a user-data directory, with the display names the
 * browser shows its user (from `Local State`) rather than "Profile 3".
 */
function profilesIn(userDataDir: string): { dir: string; label: string }[] {
  let names: Record<string, string> = {};
  try {
    const localState = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'));
    const cache = localState?.profile?.info_cache;
    if (cache && typeof cache === 'object') {
      for (const [dir, info] of Object.entries(cache as Record<string, { name?: string }>)) {
        if (info && typeof info.name === 'string') names[dir] = info.name;
      }
    }
  } catch {
    names = {}; // no Local State, or unreadable: fall back to folder names
  }

  const profiles: { dir: string; label: string }[] = [];
  for (const entry of readDir(userDataDir)) {
    if (!entry.isDirectory()) continue;
    if (!dirExists(path.join(userDataDir, entry.name, 'Extensions'))) continue;
    profiles.push({ dir: entry.name, label: names[entry.name] || entry.name });
  }
  return profiles;
}

/**
 * Every importable extension across every installed Chromium browser.
 * Deduplicated by extension id, keeping the newest version, so the same
 * extension present in several profiles is offered once.
 */
export function scanBrowsers(): BrowserScanDto {
  const browsers: string[] = [];
  const byId = new Map<string, Discovered>();

  for (const candidate of browserCandidates()) {
    browsers.push(candidate.name);
    for (const profile of profilesIn(candidate.userDataDir)) {
      const root = path.join(candidate.userDataDir, profile.dir, 'Extensions');
      for (const entry of readDir(root)) {
        if (!entry.isDirectory()) continue;
        const found = readExtension(path.join(root, entry.name), entry.name);
        if (!found) continue;

        const existing = byId.get(found.extensionId);
        if (existing && compareVersions(existing.version, found.version) >= 0) continue;
        byId.set(found.extensionId, {
          ...found,
          browser: candidate.name,
          profile: profile.label
        });
      }
    }
  }

  lastScan = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const imported = importedExtensionIds();
  const extensions: ImportableExtensionDto[] = lastScan.map((e) => ({
    extensionId: e.extensionId,
    name: e.name,
    version: e.version,
    icon: e.iconDataUrl,
    source: `${e.browser} · ${e.profile}`,
    alreadyAdded: imported.has(e.extensionId)
  }));
  log(`extension scan: ${extensions.length} found in ${browsers.length} browser(s)`);
  return { browsers, extensions };
}

/**
 * Copies the chosen extensions into Flank's data directory and adds them to
 * settings. Copying rather than pointing at the browser's own folder is
 * deliberate: that folder is versioned (`1.2.3_0`) and the browser deletes it
 * on the extension's next update, which would leave Flank with a dead path.
 * They load on the next app start, like any other extension change.
 */
export function importExtensions(extensionIds: string[]): ImportResultDto {
  const wanted = new Set(extensionIds);
  const errors: string[] = [];
  let imported = 0;

  for (const entry of lastScan) {
    if (!wanted.has(entry.extensionId)) continue;
    try {
      const dest = path.join(extensionsDir, entry.extensionId);
      fs.mkdirSync(extensionsDir, { recursive: true });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(entry.sourcePath, dest, { recursive: true });
      // Chromium refuses to load an unpacked extension containing top-level
      // underscore-prefixed folders (reserved), and browsers put webstore
      // verification data in _metadata. _locales is the one exception.
      for (const child of readDir(dest)) {
        if (child.name.startsWith('_') && child.name !== '_locales') {
          fs.rmSync(path.join(dest, child.name), { recursive: true, force: true });
        }
      }

      const manifest = parseExtensionManifest(dest);
      settingsStore.update((s) =>
        s.extensions.push({
          id: newId(),
          name: manifest.name || entry.name,
          path: dest,
          enabled: true,
          browserExtensionId: ''
        })
      );
      imported++;
      log(`extension imported from ${entry.browser}: ${entry.name} (${entry.extensionId})`);
    } catch (err) {
      logError(`extension import failed (${entry.name})`, err);
      errors.push(entry.name);
    }
  }

  return { imported, errors };
}

/** Extension ids Flank already has, so the picker can mark them. */
function importedExtensionIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of settingsStore.current.extensions) {
    if (entry.browserExtensionId) ids.add(entry.browserExtensionId);
    // Imports are stored under the source extension id, so a folder name
    // matches even before the engine has assigned an id at first load.
    if (path.dirname(entry.path) === extensionsDir) ids.add(path.basename(entry.path));
  }
  return ids;
}

/** Reads the newest version folder of one `Extensions/<id>` directory. */
function readExtension(
  idDir: string,
  extensionId: string
): Omit<Discovered, 'browser' | 'profile'> | null {
  const versions = readDir(idDir)
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(compareVersions);
  const version = versions.pop();
  if (!version) return null;

  const folder = path.join(idDir, version);
  let manifestRoot: Record<string, unknown>;
  try {
    manifestRoot = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  } catch {
    return null; // no manifest: not an extension we can load
  }
  if (manifestRoot.theme) return null; // themes aren't extensions Flank can use

  const info = parseExtensionManifest(folder);
  return {
    extensionId,
    name: info.name,
    // The folder is "<version>_<build>"; the manifest holds the real version.
    version: typeof manifestRoot.version === 'string' ? manifestRoot.version : version,
    iconDataUrl: info.iconPath ? readIconDataUrl(info.iconPath) : '',
    sourcePath: folder
  };
}

const ICON_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

/**
 * Icons travel to the picker inline. The flank-icon:// protocol only serves
 * files inside configured extension folders, and these are not configured yet.
 */
function readIconDataUrl(file: string): string {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 256 * 1024) return '';
    const mime = ICON_MIME[path.extname(file).toLowerCase()];
    if (!mime) return '';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return '';
  }
}

/** Orders "1.107.1_0"-style names numerically, so 1.10 sorts above 1.9. */
function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.split(/[._]/).map((p) => parseInt(p, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
