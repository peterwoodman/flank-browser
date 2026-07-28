import { ipcMain } from 'electron';
import { Rect, Side, SuggestionDto } from '@shared/space-types';
import { SpaceLink } from '@shared/types';
import * as windowManager from '../window-manager';
import { spacesStore } from '../stores/spaces-store';
import { settingsStore } from '../stores/settings-store';
import { toUrl } from '../navigation-input';
import { buildSuggestions } from '../suggestions';
import { openManager } from '../manager-window';
import { newId } from '../ids';
import { ChromeWindow } from '../chrome-window';
import { SpaceWindowController } from '../space-window';

/**
 * Channels every browsing window answers — layout, the address bar, find,
 * extensions, prompts — address their window by the id its chrome was given,
 * which is the space id for a space window and its own id for a 1-shot one.
 */
function chromeWindow(windowId: string): ChromeWindow | undefined {
  return windowManager.getWindow(String(windowId));
}

/** Channels that only make sense where there is a space behind the window. */
function controller(spaceId: string): SpaceWindowController | undefined {
  return windowManager.getController(String(spaceId));
}

function sideOf(value: unknown): Side {
  return value === 'right' ? 'right' : 'left';
}

export function registerSpaceIpc(): void {
  ipcMain.handle('flank:space:init', (_e, windowId: string) => {
    return chromeWindow(windowId)?.buildState() ?? null;
  });

  // Layout/overlay are high-frequency fire-and-forget messages.
  ipcMain.on('flank:space:layout', (_e, windowId: string, side: unknown, rect: Rect | null) => {
    chromeWindow(windowId)?.setLayout(sideOf(side), rect);
  });

  ipcMain.on('flank:space:overlay', (_e, windowId: string, active: boolean) => {
    chromeWindow(windowId)?.setOverlay(!!active);
  });

  /** The sidebar's 1-shot button, in the profile of the window that asked. */
  ipcMain.handle('flank:oneshot:open', (_e, windowId: string) => {
    const from = chromeWindow(windowId);
    if (from) windowManager.openOneShot(from.session);
  });

  // --- Section actions ---

  ipcMain.handle('flank:section:openLink', (_e, spaceId: string, side: unknown, linkId: string) => {
    controller(spaceId)?.openLink(sideOf(side), String(linkId));
  });

  // Free-form input from the home search box or a suggestion row:
  // URL-vs-search resolution happens here (docs/behaviors.md).
  ipcMain.handle('flank:section:submitInput', (_e, spaceId: string, side: unknown, text: string) => {
    const url = toUrl(String(text), settingsStore.current.searchTemplate);
    controller(spaceId)?.navigateAdhoc(sideOf(side), url);
  });

  // Address bar: navigates this view in place (same URL-vs-search rules).
  ipcMain.handle(
    'flank:section:addressSubmit',
    (_e, windowId: string, side: unknown, text: string, directUrl: string | null) => {
      const url = directUrl ?? toUrl(String(text), settingsStore.current.searchTemplate);
      const w = chromeWindow(windowId);
      if (!w) return;
      const s = sideOf(side);
      const view = w.sectionView(s);
      if (view) view.navigate(url);
      else controller(windowId)?.navigateAdhoc(s, url);
    }
  );

  ipcMain.handle('flank:section:goHome', (_e, spaceId: string, side: unknown) => {
    controller(spaceId)?.goHome(sideOf(side));
  });

  ipcMain.handle('flank:section:returnFromHome', (_e, spaceId: string, side: unknown) => {
    controller(spaceId)?.returnFromHome(sideOf(side));
  });

  ipcMain.handle('flank:section:refresh', (_e, windowId: string, side: unknown) => {
    chromeWindow(windowId)?.refresh(sideOf(side));
  });

  ipcMain.handle('flank:section:back', (_e, windowId: string, side: unknown) => {
    chromeWindow(windowId)?.goBack(sideOf(side));
  });

  ipcMain.handle('flank:section:openRight', (_e, spaceId: string) => {
    controller(spaceId)?.openRight();
  });

  ipcMain.handle('flank:section:closeRight', (_e, spaceId: string) => {
    controller(spaceId)?.closeRightSection();
  });

  ipcMain.handle('flank:section:promote', (_e, spaceId: string) => {
    controller(spaceId)?.promoteToLeft();
  });

  // --- Trail ---

  ipcMain.handle('flank:trail:navigate', (_e, spaceId: string, side: unknown, index: number) => {
    controller(spaceId)?.trailNavigate(sideOf(side), Number(index));
  });

  ipcMain.handle('flank:trail:delete', (_e, spaceId: string, side: unknown, index: number) => {
    controller(spaceId)?.trailDelete(sideOf(side), Number(index));
  });

  ipcMain.handle('flank:trail:clear', (_e, spaceId: string, side: unknown) => {
    controller(spaceId)?.trailClear(sideOf(side));
  });

  // --- Split ---

  ipcMain.handle('flank:split:set', (_e, spaceId: string, ratio: number) => {
    controller(spaceId)?.setSplitRatio(Number(ratio));
  });

  ipcMain.handle('flank:split:nudge', (_e, spaceId: string, direction: number) => {
    controller(spaceId)?.nudgeSplit(direction < 0 ? -1 : 1);
  });

  // --- Suggestions ---

  ipcMain.handle(
    'flank:suggest:query',
    async (
      _e,
      windowId: string,
      side: unknown,
      text: string,
      includeTrail: boolean
    ): Promise<SuggestionDto[]> => {
      // A 1-shot window has no space behind it and no trail: remote
      // suggestions and plain search are all its address bar offers.
      const space = spacesStore.byId(String(windowId));
      const w = chromeWindow(windowId);
      const trail = includeTrail ? (w?.sectionView(sideOf(side))?.trail ?? null) : null;
      return buildSuggestions(
        `${windowId}:${String(side)}:${includeTrail ? 'addr' : 'home'}`,
        String(text),
        space ? [...space.links].sort((a, b) => a.order - b.order) : null,
        trail
      );
    }
  );

  // --- Home grid links ---

  ipcMain.handle(
    'flank:links:add',
    (_e, spaceId: string, data: { title: string; url: string }) => {
      const space = spacesStore.byId(String(spaceId));
      if (!space || !data.url?.trim()) return;
      const url = normalizeUrl(data.url.trim());
      space.links.push({
        id: newId(),
        title: data.title?.trim() || url,
        url,
        icon: '',
        background: '',
        order: space.links.length === 0 ? 0 : Math.max(...space.links.map((l) => l.order)) + 1
      });
      spacesStore.save();
      windowManager.refreshSpace(space.id);
    }
  );

  ipcMain.handle(
    'flank:links:update',
    (_e, spaceId: string, linkId: string, data: { title: string; url: string }) => {
      const space = spacesStore.byId(String(spaceId));
      const link = space?.links.find((l) => l.id === linkId);
      if (!space || !link || !data.url?.trim()) return;

      const url = normalizeUrl(data.url.trim());
      if (host(url) !== host(link.url)) link.icon = ''; // host changed: refetch favicon
      link.title = data.title?.trim() || url;
      link.url = url;
      spacesStore.save();
      windowManager.refreshSpace(space.id);
    }
  );

  ipcMain.handle('flank:links:remove', (_e, spaceId: string, linkId: string) => {
    const space = spacesStore.byId(String(spaceId));
    if (!space) return;
    space.links = space.links.filter((l) => l.id !== linkId);
    spacesStore.save();
    windowManager.refreshSpace(space.id);
  });

  ipcMain.handle('flank:links:reorder', (_e, spaceId: string, orderedIds: string[]) => {
    const space = spacesStore.byId(String(spaceId));
    if (!space || !Array.isArray(orderedIds)) return;
    const order = new Map(orderedIds.map((id, i) => [id, i]));
    for (const link of space.links) {
      const idx = order.get(link.id);
      if (idx !== undefined) link.order = idx;
    }
    spacesStore.save();
    windowManager.refreshSpace(space.id);
  });

  // The space window's Spaces button; the Manager is where spaces are picked.
  ipcMain.handle('flank:manager:open', () => {
    openManager();
  });

  // Pin the current page to the home grid (with live favicon capture).
  ipcMain.handle('flank:section:pin', async (_e, spaceId: string, side: unknown) => {
    await controller(spaceId)?.pinCurrentPage(sideOf(side));
  });

  // --- Find in page ---

  ipcMain.on(
    'flank:find:query',
    (_e, windowId: string, side: unknown, text: string, forward: boolean, findNext: boolean) => {
      chromeWindow(windowId)?.find(sideOf(side), String(text), !!forward, !!findNext);
    }
  );

  ipcMain.on('flank:find:stop', (_e, windowId: string, side: unknown) => {
    chromeWindow(windowId)?.stopFind(sideOf(side));
  });

  // --- Extensions ---

  ipcMain.handle(
    'flank:ext:activate',
    (_e, windowId: string, side: unknown, extensionId: string, anchor: Rect) => {
      chromeWindow(windowId)?.activateExtension(sideOf(side), String(extensionId), anchor);
    }
  );

  // --- Permissions ---

  ipcMain.on('flank:permission:respond', (_e, windowId: string, id: string, allow: boolean) => {
    chromeWindow(windowId)?.resolvePermission(String(id), !!allow);
  });

  ipcMain.on('flank:screenShare:respond', (_e, windowId: string, choice: string | null) => {
    chromeWindow(windowId)?.resolveScreenShare(choice == null ? null : String(choice));
  });

  // --- Adaptive colors: the chrome's resolved theme tints the native caption buttons ---

  ipcMain.on(
    'flank:space:chromeColors',
    (_e, windowId: string, colors: { bg: string; fg: string } | null) => {
      chromeWindow(windowId)?.setChromeColors(colors);
    }
  );
}

function normalizeUrl(url: string): string {
  return url.includes('://') ? url : 'https://' + url;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
