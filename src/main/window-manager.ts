import { app, Session } from 'electron';
import { Space } from '@shared/types';
import { ChromeWindow } from './chrome-window';
import { SpaceWindowController } from './space-window';
import { OneShotWindowController, oneShotStartUrl } from './one-shot-window';
import { spacesStore } from './stores/spaces-store';
import { settingsStore } from './stores/settings-store';
import { readySessionForSpace } from './profiles';
import { getManagerWindow, notifyManager, openManager } from './manager-window';
import { newId } from './ids';
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

/**
 * Open 1-shot windows, by their own ids. Deliberately kept apart from the
 * spaces: they are errands, not places, so nothing about them is remembered
 * and none of the session bookkeeping above applies to them.
 */
const oneShots = new Map<string, OneShotWindowController>();

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

/** Any browsing window by the id its chrome sends with every message. */
export function getWindow(windowId: string): ChromeWindow | undefined {
  return controllers.get(windowId) ?? oneShots.get(windowId);
}

/**
 * Opens a 1-shot window in the given profile — the profile of whatever window
 * asked for it, so the errand runs as the identity you were already browsing
 * as. The session is already prepared, since a window is browsing in it.
 */
export function openOneShot(ses: Session): void {
  const id = newId();
  const controller = new OneShotWindowController(id, ses, oneShotStartUrl());
  oneShots.set(id, controller);
  controller.onClosed = () => oneShots.delete(id);
}

export async function openSpace(spaceId: string): Promise<void> {
  const space = spacesStore.byId(spaceId);
  if (!space) {
    log(`openSpace: no space with id ${spaceId}`);
    return;
  }

  // The Manager stays open behind the spaces as Flank's hub. Keeping it a real
  // window is what makes leaving Flank predictable: the desktop's "close all
  // windows" reaches it like any other window, and the window list emptying
  // always means "exit", never "show me the hub". It is never minimized (or
  // otherwise rearranged) by Flank itself — the space window simply opens in
  // front of it, and where it sits is the user's business.
  openManager('background');

  const existing = controllers.get(spaceId);
  if (existing) {
    existing.focus();
    return;
  }

  // The space's profile partition is created on demand, and its extensions have
  // to be in it before the first page loads.
  const ses = await readySessionForSpace(space);
  // That await leaves room for a second open of the same space to land first.
  const raced = controllers.get(spaceId);
  if (raced) raced.focus();
  else createWindow(space, ses);
}

function createWindow(space: Space, ses: Session): void {
  const controller = new SpaceWindowController(space, ses);
  controllers.set(space.id, controller);
  controller.onClosed = () => onControllerClosed(space);
  rememberOpenSpaces();
  notifyManager('manager:refresh');
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

/** A setting the chrome renders from changed; re-push to every window. */
export function refreshAllWindows(): void {
  for (const controller of allWindows()) controller.pushState();
}

/**
 * Where an extension-initiated tab goes: the focused window of that
 * extension's own profile, or any window of it. An extension is loaded per
 * profile, so its tab must not land in a window browsing as another one.
 */
export function focusedWindow(ses: Session): ChromeWindow | undefined {
  const inProfile = allWindows().filter((c) => c.session === ses);
  return inProfile.find((c) => c.win.isFocused()) ?? inProfile[0];
}

/** The window whose pages include this webContents (permissions, downloads). */
export function windowForWebContents(webContentsId: number): ChromeWindow | undefined {
  return allWindows().find((c) => c.containsWebContents(webContentsId));
}

function allWindows(): ChromeWindow[] {
  return [...controllers.values(), ...oneShots.values()];
}

/** A space is being deleted; close its window without re-recording it. */
export function closeSpaceWindow(spaceId: string): void {
  controllers.get(spaceId)?.close();
}

export function saveAllSessions(): void {
  for (const controller of controllers.values()) controller.saveSession();
}
