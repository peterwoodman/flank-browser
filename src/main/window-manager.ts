import { app } from 'electron';
import { Space } from '@shared/types';
import { SpaceWindowController } from './space-window';
import { spacesStore } from './stores/spaces-store';
import { settingsStore } from './stores/settings-store';
import { getManagerWindow, notifyManager, openManager } from './manager-window';
import { log, fireAndForget } from './log';

/** Windows close on the way out too; the hub should not pop up mid-quit. */
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

/**
 * Tracks open space windows and keeps the `openSpaces` session-memory list in
 * settings current (skipping the final close of a session — that ends the
 * session rather than meaning "done with this space"). Windows that close
 * together in a rapid burst (taskbar "close all", shutdown) are all remembered.
 */
const controllers = new Map<string, SpaceWindowController>();

/** Space ids whose windows closed within the burst window, newest last. */
const recentCloses: { spaceId: string; at: number }[] = [];
const CLOSE_BURST_MS = 2000;

export function openSpaceIds(): string[] {
  return [...controllers.keys()];
}

export function isSpaceOpen(spaceId: string): boolean {
  return controllers.has(spaceId);
}

export function getController(spaceId: string): SpaceWindowController | undefined {
  return controllers.get(spaceId);
}

export function openSpace(spaceId: string): void {
  const existing = controllers.get(spaceId);
  if (existing) {
    existing.focus();
  } else {
    const space = spacesStore.byId(spaceId);
    if (!space) {
      log(`openSpace: no space with id ${spaceId}`);
      return;
    }

    const controller = new SpaceWindowController(space);
    controllers.set(space.id, controller);
    controller.onClosed = () => onControllerClosed(space);
    rememberOpenSpaces();
    notifyManager('manager:refresh');
  }

  // The Manager stays open behind the spaces as Flank's hub, minimized out of
  // the way. Keeping it a real window is what makes leaving Flank predictable:
  // the desktop's "close all windows" reaches it like any other window, and the
  // window list emptying always means "exit", never "show me the hub".
  openManager('minimized');
}

function onControllerClosed(space: Space): void {
  controllers.delete(space.id);
  const now = Date.now();
  recentCloses.push({ spaceId: space.id, at: now });
  while (recentCloses.length > 0 && now - recentCloses[0].at > CLOSE_BURST_MS) {
    recentCloses.shift();
  }

  if (controllers.size > 0) {
    // Closing a single window mid-session: you're "done" with that space.
    rememberOpenSpaces();
  } else {
    // The last window (or a rapid burst ending in it) ends the session rather
    // than saying you're done with those spaces — remember the whole burst so
    // they all reopen next launch.
    const burst = recentCloses.map((c) => c.spaceId);
    settingsStore.update((s) => {
      s.openSpaces = [...new Set([...s.openSpaces, ...burst])].filter(
        (id) => burst.includes(id) || controllers.has(id)
      );
    });
  }
  notifyManager('manager:refresh');

  // With no space left, the hub comes back out — but only if it is still there.
  // It is deliberately never recreated here: when the desktop closes every
  // window at once the Manager goes with them, and reopening it would leave
  // Flank running after the user asked for the opposite.
  if (!quitting && controllers.size === 0 && getManagerWindow()) openManager();
}

function rememberOpenSpaces(): void {
  settingsStore.update((s) => (s.openSpaces = openSpaceIds()));
}

/** Focuses any open space window; returns false if none exist. */
export function focusAnySpaceWindow(): boolean {
  const first = controllers.values().next();
  if (first.done) return false;
  first.value.focus();
  return true;
}

/** A space was renamed/edited outside its window (e.g. in the Manager). */
export function refreshSpace(spaceId: string): void {
  const controller = controllers.get(spaceId);
  if (!controller) return;
  controller.pushState();
  // The color scheme may have changed, and the native caption strip is painted
  // outside the chrome's state snapshot.
  controller.refreshCaptionColors();
  // Edited/added links may need their tile icon (re)fetched.
  fireAndForget('refresh favicons', controller.refreshFavicons());
}

/** A setting the space chrome renders from changed; re-push to every window. */
export function refreshAllSpaces(): void {
  for (const controller of controllers.values()) controller.pushState();
}

/** The focused space window, or any open one (extension-initiated tabs). */
export function focusedController(): SpaceWindowController | undefined {
  for (const controller of controllers.values()) {
    if (controller.win.isFocused()) return controller;
  }
  return controllers.values().next().value;
}

/** The controller whose pages include this webContents (permissions, downloads). */
export function controllerForWebContents(webContentsId: number): SpaceWindowController | undefined {
  for (const controller of controllers.values()) {
    if (controller.containsWebContents(webContentsId)) return controller;
  }
  return undefined;
}

/** A space is being deleted; close its window without re-recording it. */
export function closeSpaceWindow(spaceId: string): void {
  controllers.get(spaceId)?.close();
}

export function saveAllSessions(): void {
  for (const controller of controllers.values()) controller.saveSession();
}
