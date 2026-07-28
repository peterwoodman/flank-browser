import { BaseWindow, BrowserWindow, Session, WebContents } from 'electron';
import fs from 'fs';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { ExtensionButtonDto } from '@shared/space-types';
import { prepareEverySession } from './browser-session';
import { settingsStore } from './stores/settings-store';
import { parseExtensionManifest } from './extension-manifest';
import { extensionIconUrl } from './icons-protocol';
import { extensionCompatPreloadPath } from './renderer-url';
import { windowIcon } from './manager-window';
import { log, logError } from './log';

/**
 * Chrome extension support (docs/behaviors.md → Extensions): essentials only,
 * loaded unpacked. electron-chrome-extensions fills the chrome.* API gaps
 * Electron leaves (tabs, action popups, storage).
 *
 * The extension list is app-wide, but each is loaded into a session and a
 * profile's partition starts with nothing in it — so every profile gets its own
 * host with the same set loaded into it, and an extension's stored state
 * (logins, vaults) is that profile's alone.
 */

interface ProfileExtensions {
  host: ElectronChromeExtensions;
  /** Settles once the enabled extensions have loaded (or failed to). */
  loaded: Promise<void>;
  /** Extensions whose MV3 background worker we hold alive (browser extension id). */
  keepAliveIds: Set<string>;
  keepAliveTasks: Map<string, { end: () => void }>;
  keepAliveRetryAt: Map<string, number>;
}

const bySession = new Map<Session, ProfileExtensions>();

/** How extension-initiated tabs open; provided by the app entry point to
 * avoid a module cycle with the window manager. */
export interface ExtensionsHost {
  /** chrome.tabs.create: open the URL per Flank's new-window rules, in a window of this session's profile. */
  openTab(url: string, ses: Session): [WebContents, BaseWindow] | null;
}

export function initExtensions(host: ExtensionsHost): void {
  prepareEverySession((ses) => attach(ses, host));
}

function attach(ses: Session, host: ExtensionsHost): void {
  const extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: ses,
    async createTab(details) {
      const opened = details.url ? host.openTab(details.url, ses) : null;
      if (!opened) throw new Error('Flank has no window to open a tab in');
      return opened;
    },
    removeTab() {
      // Sections don't close from extensions; ignore.
    },
    // chrome.windows.create: extensions open standalone "popout" windows with
    // this (Bitwarden finishes SSO/2FA login in one). Host it as a plain
    // window in the same profile, like Chrome's type:'popup' windows.
    async createWindow(details) {
      const win = new BrowserWindow({
        width: details.width ?? 500,
        height: details.height ?? 640,
        x: details.left,
        y: details.top,
        icon: windowIcon,
        autoHideMenuBar: true,
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true
        }
      });
      const url = Array.isArray(details.url) ? details.url[0] : details.url;
      if (url) {
        void win.webContents.loadURL(url).catch((err) => logError('extension window load', err));
      }
      extensions.addTab(win.webContents, win);
      return win;
    }
  });

  // After the constructor, so these run after electron-chrome-extensions' own
  // preloads have finished building `chrome` (see extension-compat.ts).
  for (const type of ['service-worker', 'frame'] as const) {
    ses.registerPreloadScript({
      id: `flank-extension-compat-${type}`,
      type,
      filePath: extensionCompatPreloadPath
    });
  }

  const profile: ProfileExtensions = {
    host: extensions,
    loaded: Promise.resolve(),
    keepAliveIds: new Set(),
    keepAliveTasks: new Map(),
    keepAliveRetryAt: new Map()
  };
  bySession.set(ses, profile);
  // Never rejects: a window must open even if this profile's extensions don't.
  profile.loaded = loadEnabled(ses, profile).catch((err) => logError('extension load', err));
}

/**
 * Resolves once this profile's extensions are in place. A content script that
 * isn't registered before a page loads never runs on it, so the first window in
 * a profile waits for this.
 */
export function extensionsReady(ses: Session): Promise<void> {
  return bySession.get(ses)?.loaded ?? Promise.resolve();
}

/** Registers a content view so chrome.tabs can see it. Removal is automatic
 * when the webContents is destroyed. */
export function extensionsAddTab(tab: WebContents, window: BaseWindow): void {
  try {
    bySession.get(tab.session)?.host.addTab(tab, window);
  } catch (err) {
    logError('extensions addTab', err);
  }
}

/** Marks the view now shown in its section as the active tab. */
export function extensionsSelectTab(tab: WebContents): void {
  try {
    bySession.get(tab.session)?.host.selectTab(tab);
  } catch (err) {
    logError('extensions selectTab', err);
  }
}

/**
 * Loads every enabled extension into a profile's freshly created session, once
 * (extension changes made later apply after a restart, docs/behaviors.md).
 * Failures are logged and skipped — a broken extension must not break a
 * window.
 */
async function loadEnabled(ses: Session, profile: ProfileExtensions): Promise<void> {
  let changed = false;
  for (const entry of settingsStore.current.extensions) {
    if (!entry.enabled || !fs.existsSync(entry.path)) continue;
    try {
      const loaded = await ses.extensions.loadExtension(entry.path, { allowFileAccess: true });
      // The engine derives the id from the folder, so every profile loading
      // the same entry agrees on it.
      if (entry.browserExtensionId !== loaded.id) {
        entry.browserExtensionId = loaded.id;
        changed = true;
      }
      log(`extension loaded: ${entry.name} (${loaded.id})`);
      if (loaded.manifest?.background?.service_worker) {
        profile.keepAliveIds.add(loaded.id);
        void keepWorkerAlive(ses, profile, loaded.id);
      }
    } catch (err) {
      logError(`extension load failed (${entry.name})`, err);
    }
  }
  if (changed) settingsStore.save();

  // A worker can only be started once its registration exists; on a fresh
  // profile that happens after loading, so hook registrations too.
  ses.serviceWorkers.on('registration-completed', (_event, details) => {
    let id = '';
    try {
      id = new URL(details.scope).host;
    } catch {
      return;
    }
    if (profile.keepAliveIds.has(id)) {
      profile.keepAliveRetryAt.delete(id);
      void keepWorkerAlive(ses, profile, id);
    }
  });

  // Re-assert keep-alives if a worker still stops (crash, engine shutdown of
  // an idle worker racing the task, extension update).
  ses.serviceWorkers.on('running-status-changed', (details) => {
    if (details.runningStatus !== 'stopped') return;
    const running = new Set(
      Object.values(ses.serviceWorkers.getAllRunning()).map((w) => {
        try {
          return new URL(w.scope).host;
        } catch {
          return '';
        }
      })
    );
    for (const id of profile.keepAliveIds) {
      if (!running.has(id)) {
        profile.keepAliveTasks.delete(id);
        void keepWorkerAlive(ses, profile, id);
      }
    }
  });
}

/**
 * Holds an MV3 background service worker alive. Chromium idle-kills extension
 * workers after ~30 s and — unlike Chrome — Electron does not revive a dead
 * worker when a runtime message arrives for it, so anything a content script
 * relays to a dead background is silently lost. That broke e.g. Bitwarden's
 * SSO/2FA login, whose vault connector page reports the auth result via a
 * content script after the user spends minutes on an identity provider.
 * An explicit keep-alive task makes background workers resident, like the
 * MV2 background pages extensions expect a real browser to run.
 */
async function keepWorkerAlive(
  ses: Session,
  profile: ProfileExtensions,
  browserExtensionId: string
): Promise<void> {
  const now = Date.now();
  const retryAt = profile.keepAliveRetryAt.get(browserExtensionId) ?? 0;
  if (now < retryAt) return; // a crash-looping worker must not spin us
  profile.keepAliveRetryAt.set(browserExtensionId, now + 5000);

  try {
    const worker = await ses.serviceWorkers.startWorkerForScope(
      `chrome-extension://${browserExtensionId}/`
    );
    if (!profile.keepAliveTasks.has(browserExtensionId)) {
      profile.keepAliveTasks.set(browserExtensionId, worker.startTask());
    }
  } catch (err) {
    logError(`extension worker keep-alive (${browserExtensionId})`, err);
  }
}

/** Toolbar buttons for the enabled extensions (manifest-derived, per section). */
export function extensionButtons(): ExtensionButtonDto[] {
  return settingsStore.current.extensions
    .filter((e) => e.enabled && fs.existsSync(e.path))
    .map((e) => {
      const manifest = parseExtensionManifest(e.path);
      return {
        id: e.id,
        name: manifest.name || e.name,
        icon: manifest.iconPath ? extensionIconUrl(manifest.iconPath) : ''
      };
    });
}

export interface ExtensionActivation {
  kind: 'popup' | 'options';
  url: string;
}

/**
 * What clicking an extension's toolbar button does: its popup when it
 * declares one, otherwise its options page (docs/behaviors.md).
 */
export function extensionActivation(settingsId: string): ExtensionActivation | null {
  const entry = settingsStore.current.extensions.find((e) => e.id === settingsId);
  if (!entry?.browserExtensionId || !fs.existsSync(entry.path)) return null;

  const manifest = parseExtensionManifest(entry.path);
  const page = manifest.popupPage ?? manifest.optionsPage;
  if (!page) return null;
  return {
    kind: manifest.popupPage ? 'popup' : 'options',
    url: `chrome-extension://${entry.browserExtensionId}/${page.replace(/^\//, '')}`
  };
}
