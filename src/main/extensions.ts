import { BaseWindow, BrowserWindow, WebContents } from 'electron';
import fs from 'fs';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { ExtensionButtonDto } from '@shared/space-types';
import { flankSession } from './browser-session';
import { settingsStore } from './stores/settings-store';
import { parseExtensionManifest } from './extension-manifest';
import { extensionIconUrl } from './icons-protocol';
import { extensionCompatPreloadPath } from './renderer-url';
import { windowIcon } from './manager-window';
import { log, logError } from './log';

/**
 * Chrome extension support (docs/behaviors.md → Extensions): essentials only,
 * loaded unpacked into the shared profile. electron-chrome-extensions fills
 * the chrome.* API gaps Electron leaves (tabs, action popups, storage).
 */

let instance: ElectronChromeExtensions | null = null;
let reconciled = false;

/** Extensions whose MV3 background worker we hold alive (browser extension id). */
const keepAliveIds = new Set<string>();
const keepAliveTasks = new Map<string, { end: () => void }>();
const keepAliveRetryAt = new Map<string, number>();

/** How extension-initiated tabs open; provided by the app entry point to
 * avoid a module cycle with the window manager. */
export interface ExtensionsHost {
  /** chrome.tabs.create: open the URL per Flank's new-window rules. */
  openTab(url: string): [WebContents, BaseWindow] | null;
}

export function initExtensions(host: ExtensionsHost): void {
  instance = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: flankSession(),
    async createTab(details) {
      const opened = details.url ? host.openTab(details.url) : null;
      if (!opened) throw new Error('Flank has no window to open a tab in');
      return opened;
    },
    removeTab() {
      // Sections don't close from extensions; ignore.
    },
    // chrome.windows.create: extensions open standalone "popout" windows with
    // this (Bitwarden finishes SSO/2FA login in one). Host it as a plain
    // window in the shared profile, like Chrome's type:'popup' windows.
    async createWindow(details) {
      const win = new BrowserWindow({
        width: details.width ?? 500,
        height: details.height ?? 640,
        x: details.left,
        y: details.top,
        icon: windowIcon,
        autoHideMenuBar: true,
        webPreferences: {
          session: flankSession(),
          sandbox: true,
          contextIsolation: true
        }
      });
      const url = Array.isArray(details.url) ? details.url[0] : details.url;
      if (url) {
        void win.webContents.loadURL(url).catch((err) => logError('extension window load', err));
      }
      instance?.addTab(win.webContents, win);
      return win;
    }
  });

  // After the constructor, so these run after electron-chrome-extensions' own
  // preloads have finished building `chrome` (see extension-compat.ts).
  for (const type of ['service-worker', 'frame'] as const) {
    flankSession().registerPreloadScript({
      id: `flank-extension-compat-${type}`,
      type,
      filePath: extensionCompatPreloadPath
    });
  }
}

/** Registers a content view so chrome.tabs can see it. Removal is automatic
 * when the webContents is destroyed. */
export function extensionsAddTab(tab: WebContents, window: BaseWindow): void {
  try {
    instance?.addTab(tab, window);
  } catch (err) {
    logError('extensions addTab', err);
  }
}

/** Marks the view now shown in its section as the active tab. */
export function extensionsSelectTab(tab: WebContents): void {
  try {
    instance?.selectTab(tab);
  } catch (err) {
    logError('extensions selectTab', err);
  }
}

/**
 * Aligns the profile's loaded extensions with settings, once per app session
 * (extension changes made later apply after a restart, docs/behaviors.md).
 * Electron sessions start with nothing loaded, so reconciling means loading
 * every enabled entry; failures are logged and skipped — a broken extension
 * must not break startup.
 */
export async function reconcileExtensions(): Promise<void> {
  if (reconciled) return;
  reconciled = true;

  const ses = flankSession();
  let changed = false;
  for (const entry of settingsStore.current.extensions) {
    if (!entry.enabled || !fs.existsSync(entry.path)) continue;
    try {
      const loaded = await ses.extensions.loadExtension(entry.path, { allowFileAccess: true });
      if (entry.browserExtensionId !== loaded.id) {
        entry.browserExtensionId = loaded.id;
        changed = true;
      }
      log(`extension loaded: ${entry.name} (${loaded.id})`);
      if (loaded.manifest?.background?.service_worker) {
        keepAliveIds.add(loaded.id);
        void keepWorkerAlive(loaded.id);
      }
    } catch (err) {
      logError(`extension load failed (${entry.name})`, err);
    }
  }
  if (changed) settingsStore.save();

  // A worker can only be started once its registration exists; on a fresh
  // profile that happens after reconcile, so hook registrations too.
  ses.serviceWorkers.on('registration-completed', (_event, details) => {
    let id = '';
    try {
      id = new URL(details.scope).host;
    } catch {
      return;
    }
    if (keepAliveIds.has(id)) {
      keepAliveRetryAt.delete(id);
      void keepWorkerAlive(id);
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
    for (const id of keepAliveIds) {
      if (!running.has(id)) {
        keepAliveTasks.delete(id);
        void keepWorkerAlive(id);
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
async function keepWorkerAlive(browserExtensionId: string): Promise<void> {
  const now = Date.now();
  const retryAt = keepAliveRetryAt.get(browserExtensionId) ?? 0;
  if (now < retryAt) return; // a crash-looping worker must not spin us
  keepAliveRetryAt.set(browserExtensionId, now + 5000);

  try {
    const ses = flankSession();
    const worker = await ses.serviceWorkers.startWorkerForScope(
      `chrome-extension://${browserExtensionId}/`
    );
    if (!keepAliveTasks.has(browserExtensionId)) {
      keepAliveTasks.set(browserExtensionId, worker.startTask());
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
