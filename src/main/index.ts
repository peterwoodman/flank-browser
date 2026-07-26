import { app } from 'electron';
import { dataDir, ensureDataDirs } from './paths';
import { installGlobalErrorLogging, log, logError } from './log';
import { settingsStore } from './stores/settings-store';
import { spacesStore } from './stores/spaces-store';
import { parseSpaceArg } from './args';
import { openManager } from './manager-window';
import { registerIconSchemePrivileges, installIconProtocol } from './icons-protocol';
import { registerManagerIpc } from './ipc/manager-ipc';
import { registerSpaceIpc } from './ipc/space-ipc';
import { registerContentMessageRouting } from './content-view';
import { installPermissionHandler } from './permissions';
import { installDisplayMediaHandler } from './screen-share';
import { installDownloadHandler } from './downloads';
import { initExtensions, reconcileExtensions } from './extensions';
import { describeLinuxSession } from './linux-platform';
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

  app.whenReady().then(async () => {
    installGlobalErrorLogging();
    ensureDataDirs();
    settingsStore.load();
    spacesStore.load();
    ensureDesktopEntry();
    installIconProtocol();
    registerManagerIpc();
    registerSpaceIpc();
    registerContentMessageRouting();
    initExtensions({
      openTab: (url) => windowManager.focusedController()?.openTabForExtension(url) ?? null
    });
    // Before any window opens, so content scripts reach the first pages too.
    await reconcileExtensions().catch((err) => logError('extension reconcile', err));
    installPermissionHandler((contents, prompt) => {
      const c = windowManager.controllerForWebContents(contents.id);
      return c ? c.showPermissionPrompt(prompt) : Promise.resolve(false);
    });
    installDisplayMediaHandler((contents, prompt) => {
      const c = windowManager.controllerForWebContents(contents.id);
      return c ? c.showScreenSharePrompt(prompt) : Promise.resolve(null);
    });
    installDownloadHandler((contents, notice) => {
      windowManager.controllerForWebContents(contents.id)?.notifyChrome('space:download', notice);
    });
    if (process.platform === 'linux') log(`Linux session: ${describeLinuxSession()}`);
    log('App started');
    handleActivation(parseSpaceArg(process.argv), false);
  });
}

// The app exits when its last window closes (no tray, all platforms).
app.on('window-all-closed', () => {
  app.quit();
});

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
      windowManager.openSpace(space.id);
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
    for (const id of toRestore) windowManager.openSpace(id);
  } else {
    openManager();
  }
}
