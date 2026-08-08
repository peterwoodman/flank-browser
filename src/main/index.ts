import { app } from 'electron';
import { ChromeWindow } from './chrome-window';
import { dataDir, ensureDataDirs } from './paths';
import { installGlobalErrorLogging, log, logError, fireAndForget } from './log';
import { settingsStore } from './stores/settings-store';
import { spacesStore } from './stores/spaces-store';
import { parseSpaceArg } from './args';
import { openManager } from './manager-window';
import { registerIconSchemePrivileges, installIconProtocol } from './icons-protocol';
import { registerManagerIpc } from './ipc/manager-ipc';
import { registerSpaceIpc } from './ipc/space-ipc';
import { registerContentMessageRouting } from './content-view';
import { installCertificateHandler } from './certificates';
import { installClientCertificateHandler } from './client-certificates';
import { installAuthHandler } from './http-auth';
import { installPermissionHandler } from './permissions';
import { installDisplayMediaHandler } from './screen-share';
import { installDownloadHandler } from './downloads';
import { initExtensions } from './extensions';
import { describeLinuxSession } from './linux-platform';
import { installUserAgentPolicy } from './user-agent';
import { ensureDesktopEntry } from './desktop-entry';
import * as windowManager from './window-manager';

// Dev affordance: FLANK_DEBUG_PORT exposes the Chromium remote-debugging
// endpoint so tooling can inspect/drive the chrome views.
if (process.env.FLANK_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.FLANK_DEBUG_PORT);
}

// All Flank data (JSON + the Chromium profile) lives in one folder.
app.setPath('userData', dataDir);
app.setName('Flank');

// Chrome-like UA for the web at large, stock Electron UA for Google sign-in
// (which rejects the Chrome imitation as insecure). See user-agent.ts.
installUserAgentPolicy();

registerIconSchemePrivileges();

// Single instance: second launches route into the running app. The --space
// value travels via additionalData because Chromium reorders argv for
// second instances (switch/positional-arg pairs get separated).
if (!app.requestSingleInstanceLock({ spaceArg: parseSpaceArg(process.argv) })) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _cwd, additionalData) => {
    try {
      const fromData = (additionalData as { spaceArg?: string | null } | undefined)?.spaceArg;
      handleActivation(fromData ?? parseSpaceArg(argv), true);
    } catch (err) {
      logError('second-instance', err);
    }
  });

  app.whenReady().then(() => {
    installGlobalErrorLogging();
    ensureDataDirs();
    settingsStore.load();
    spacesStore.load();
    ensureDesktopEntry();
    installIconProtocol();
    registerManagerIpc();
    registerSpaceIpc();
    registerContentMessageRouting();
    installCertificateHandler();
    installAuthHandler((contents, prompt) => {
      const w = askingWindow(contents);
      return w ? w.showAuthPrompt(prompt) : Promise.resolve(null);
    });
    installClientCertificateHandler((contents, certificates) => {
      const w = askingWindow(contents);
      return w ? w.showClientCertPrompt(certificates) : Promise.resolve(null);
    });
    // These all install per browsing session, as each profile's partition is
    // created; only the app-wide policy is decided here.
    initExtensions({
      openTab: (url, ses) => windowManager.focusedWindow(ses)?.openTabForExtension(url) ?? null
    });
    installPermissionHandler((contents, prompt) => {
      const w = windowManager.windowForWebContents(contents.id);
      return w ? w.showPermissionPrompt(prompt) : Promise.resolve(false);
    });
    installDisplayMediaHandler((contents, prompt) => {
      const w = windowManager.windowForWebContents(contents.id);
      return w ? w.showScreenSharePrompt(prompt) : Promise.resolve(null);
    });
    installDownloadHandler((contents, notice) => {
      windowManager.windowForWebContents(contents.id)?.notifyChrome('space:download', notice);
    });
    // The engine survives losing these, and the page usually does too — but a
    // GPU process that keeps dying is behind a whole class of "it went blank"
    // and leaves no other trace.
    app.on('child-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      log(`${details.type} process gone: ${details.reason}`);
    });
    if (process.platform === 'linux') log(`Linux session: ${describeLinuxSession()}`);
    log('App started');
    handleActivation(parseSpaceArg(process.argv), false);
  });
}

// The app exits when its last window closes (no tray, all platforms). Closing a
// space window lands you at the Manager because the Manager was open behind it
// all along (see openSpace in window-manager), not because anything is reopened
// here — so closing every window really does mean "leave".
app.on('window-all-closed', () => {
  app.quit();
});

/**
 * Where a dialog raised on behalf of a page belongs. A request can come from a
 * page in an adopted popup or an extension page, which no window counts among
 * its own; a window of that page's profile is still the right place to ask,
 * and the only one that could be asking.
 */
function askingWindow(contents: Electron.WebContents): ChromeWindow | undefined {
  return (
    windowManager.windowForWebContents(contents.id) ??
    windowManager.focusedWindow(contents.session)
  );
}

/**
 * Launch/activation per docs/behaviors.md → Startup:
 * - `--space <name or id>` opens exactly that space (no session restore of
 *   the others).
 * - A plain launch reopens the last session's spaces; with nothing to
 *   restore, the Manager opens.
 * - Second launches route into the running instance: with `--space` they
 *   open/focus that space, otherwise they focus an open window (or the
 *   Manager).
 */
function handleActivation(spaceArg: string | null, isSecondInstance: boolean): void {
  if (spaceArg) {
    const space = spacesStore.byNameOrId(spaceArg);
    if (space) {
      fireAndForget('open space', windowManager.openSpace(space.id));
      return;
    }
    log(`--space "${spaceArg}" matched no space`);
  }

  if (isSecondInstance) {
    if (!windowManager.focusAnySpaceWindow()) openManager();
    return;
  }

  const toRestore = settingsStore.current.openSpaces.filter((id) => spacesStore.byId(id));
  if (toRestore.length > 0) {
    for (const id of toRestore) fireAndForget('restore space', windowManager.openSpace(id));
  } else {
    openManager();
  }
}
