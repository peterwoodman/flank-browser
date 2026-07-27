import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppSettings } from '@shared/types';
import { BrowserScanDto, ImportResultDto, ManagerState, SpaceSummary } from '@shared/ipc-types';
import { settingsStore } from '../stores/settings-store';
import { spacesStore } from '../stores/spaces-store';
import { newId } from '../ids';
import { iconUrl } from '../icons-protocol';
import { parseExtensionManifest } from '../extension-manifest';
import { importExtensions, scanBrowsers } from '../browser-import';
import { applyLaunchAtLogin } from '../launch-at-login';
import { dataDir } from '../paths';
import * as windowManager from '../window-manager';

function spaceSummaries(): SpaceSummary[] {
  return spacesStore.all.map((space) => {
    const icons: string[] = [];
    for (const link of [...space.links].sort((a, b) => a.order - b.order)) {
      if (icons.length === 4) break;
      if (!link.icon) continue;
      if (fs.existsSync(path.join(dataDir, link.icon))) icons.push(iconUrl(link.icon));
    }
    return {
      id: space.id,
      name: space.name,
      colorScheme: space.colorScheme,
      open: windowManager.isSpaceOpen(space.id),
      icons
    };
  });
}

export function registerManagerIpc(): void {
  ipcMain.handle('flank:manager:getState', (): ManagerState => {
    return { spaces: spaceSummaries(), settings: settingsStore.current };
  });

  ipcMain.handle('flank:spaces:create', (_e, name: string) => {
    spacesStore.create(String(name).trim() || 'New space');
  });

  ipcMain.handle(
    'flank:spaces:update',
    (_e, id: string, patch: { name?: string; colorScheme?: string }) => {
      spacesStore.update(id, {
        name: typeof patch?.name === 'string' ? patch.name.trim() : undefined,
        colorScheme: typeof patch?.colorScheme === 'string' ? patch.colorScheme : undefined
      });
      windowManager.refreshSpace(id);
    }
  );

  // Removes the space's session file and its entry everywhere; never touches
  // shared browser data.
  ipcMain.handle('flank:spaces:delete', (_e, id: string) => {
    windowManager.closeSpaceWindow(id);
    spacesStore.remove(id);
    settingsStore.update((s) => (s.openSpaces = s.openSpaces.filter((sid) => sid !== id)));
  });

  ipcMain.handle('flank:spaces:move', (_e, id: string, delta: -1 | 1) => {
    spacesStore.move(id, delta === -1 ? -1 : 1);
  });

  ipcMain.handle('flank:spaces:open', (_e, id: string) => {
    windowManager.openSpace(id);
  });

  ipcMain.handle('flank:settings:update', (_e, patch: Partial<AppSettings>) => {
    const before = settingsStore.current.launchAtLogin;
    const toolbarBefore = settingsStore.current.toolbarPosition;
    settingsStore.update((s) => {
      if (typeof patch.searchTemplate === 'string') s.searchTemplate = patch.searchTemplate;
      if (typeof patch.suggestTemplate === 'string') s.suggestTemplate = patch.suggestTemplate;
      if (typeof patch.launchAtLogin === 'boolean') s.launchAtLogin = patch.launchAtLogin;
      if (patch.toolbarPosition === 'side' || patch.toolbarPosition === 'top') {
        s.toolbarPosition = patch.toolbarPosition;
      }
      if (typeof patch.backgroundTabMinutes === 'number' && patch.backgroundTabMinutes >= 1) {
        s.backgroundTabMinutes = Math.floor(patch.backgroundTabMinutes);
      }
    });
    if (settingsStore.current.launchAtLogin !== before) {
      applyLaunchAtLogin(settingsStore.current.launchAtLogin);
    }
    // Open windows re-lay out immediately; no restart, unlike extensions.
    if (settingsStore.current.toolbarPosition !== toolbarBefore) {
      windowManager.refreshAllSpaces();
    }
  });

  ipcMain.handle(
    'flank:extensions:add',
    async (event): Promise<{ ok: boolean; error?: string }> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
        title: 'Add unpacked extension',
        properties: ['openDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false };

      const folder = result.filePaths[0];
      if (!fs.existsSync(path.join(folder, 'manifest.json'))) {
        return { ok: false, error: 'The folder does not contain a manifest.json.' };
      }
      if (settingsStore.current.extensions.some((e) => e.path === folder)) {
        return { ok: false, error: 'That extension folder is already added.' };
      }
      const manifest = parseExtensionManifest(folder);
      settingsStore.update((s) =>
        s.extensions.push({
          id: newId(),
          name: manifest.name,
          path: folder,
          enabled: true,
          browserExtensionId: ''
        })
      );
      return { ok: true };
    }
  );

  // Scanning touches every installed browser's profile folders; keep it off
  // the renderer's critical path by only running it when the picker opens.
  ipcMain.handle('flank:extensions:scanBrowsers', (): BrowserScanDto => scanBrowsers());

  ipcMain.handle('flank:extensions:import', (_e, ids: string[]): ImportResultDto => {
    return importExtensions(Array.isArray(ids) ? ids.map(String) : []);
  });

  ipcMain.handle('flank:extensions:toggle', (_e, id: string, enabled: boolean) => {
    settingsStore.update((s) => {
      const ext = s.extensions.find((x) => x.id === id);
      if (ext) ext.enabled = !!enabled;
    });
  });

  ipcMain.handle('flank:extensions:remove', (_e, id: string) => {
    settingsStore.update((s) => (s.extensions = s.extensions.filter((x) => x.id !== id)));
  });
}
