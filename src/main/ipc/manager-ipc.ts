import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppSettings, Space } from '@shared/types';
import {
  BrowserScanDto,
  ImportResultDto,
  ManagerState,
  ProfileSummary,
  SpaceSummary
} from '@shared/ipc-types';
import { settingsStore } from '../stores/settings-store';
import { spacesStore } from '../stores/spaces-store';
import { newId } from '../ids';
import { iconUrl } from '../icons-protocol';
import { parseExtensionManifest } from '../extension-manifest';
import { isValidTemplate, isWebUrl } from '../navigation-input';
import { importExtensions, scanBrowsers } from '../browser-import';
import { applyLaunchAtLogin } from '../launch-at-login';
import { discardProfileData } from '../profiles';
import { dataDir } from '../paths';
import * as windowManager from '../window-manager';

function spaceSummary(space: Space): SpaceSummary {
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
}

/** The launcher lists spaces grouped by the profile they browse as. */
function profileSummaries(): ProfileSummary[] {
  return spacesStore.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    spaces: spacesStore.spacesIn(profile.id).map(spaceSummary)
  }));
}

export function registerManagerIpc(): void {
  ipcMain.handle('flank:manager:getState', (): ManagerState => {
    // getVersion() reads the version out of package.json (the generated one in
    // a packaged build), so the footer needs no build step to stay current.
    return {
      profiles: profileSummaries(),
      settings: settingsStore.current,
      version: app.getVersion()
    };
  });

  ipcMain.handle('flank:spaces:create', (_e, name: string, profileId: string) => {
    spacesStore.create(String(name).trim() || 'New space', String(profileId));
  });

  ipcMain.handle('flank:spaces:duplicate', (_e, id: string, profileId: string) => {
    spacesStore.duplicate(id, String(profileId));
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
  // its profile's browsing data, which its other spaces share.
  ipcMain.handle('flank:spaces:delete', (_e, id: string) => {
    windowManager.closeSpaceWindow(id);
    spacesStore.remove(id);
    settingsStore.update((s) => (s.openSpaces = s.openSpaces.filter((sid) => sid !== id)));
  });

  ipcMain.handle('flank:spaces:move', (_e, id: string, delta: -1 | 1) => {
    spacesStore.move(id, delta === -1 ? -1 : 1);
  });

  ipcMain.handle('flank:spaces:open', (_e, id: string) => windowManager.openSpace(id));

  ipcMain.handle('flank:profiles:create', (_e, name: string) => {
    spacesStore.createProfile(String(name).trim() || 'New profile');
  });

  ipcMain.handle('flank:profiles:rename', (_e, id: string, name: string) => {
    spacesStore.renameProfile(id, String(name).trim());
  });

  // Only an empty profile can go, so no window is browsing as it; its cookies,
  // logins, and cache go with it.
  ipcMain.handle('flank:profiles:remove', async (_e, id: string) => {
    const removed = spacesStore.removeProfile(id);
    if (removed) await discardProfileData(removed);
  });

  ipcMain.handle('flank:settings:update', (_e, patch: Partial<AppSettings>) => {
    const before = settingsStore.current.launchAtLogin;
    const toolbarBefore = settingsStore.current.toolbarPosition;
    settingsStore.update((s) => {
      // Both templates are navigated to or fetched with the user's typed text in
      // them, so an unusable one is refused rather than stored (the Manager's
      // field reverts to the kept value). Empty clears remote suggestions.
      if (typeof patch.searchTemplate === 'string' && isValidTemplate(patch.searchTemplate)) {
        s.searchTemplate = patch.searchTemplate.trim();
      }
      if (typeof patch.suggestTemplate === 'string') {
        const suggest = patch.suggestTemplate.trim();
        if (suggest === '' || isValidTemplate(suggest)) s.suggestTemplate = suggest;
      }
      if (typeof patch.launchAtLogin === 'boolean') s.launchAtLogin = patch.launchAtLogin;
      if (patch.toolbarPosition === 'side' || patch.toolbarPosition === 'top') {
        s.toolbarPosition = patch.toolbarPosition;
      }
      if (typeof patch.backgroundTabMinutes === 'number' && patch.backgroundTabMinutes >= 1) {
        s.backgroundTabMinutes = Math.floor(patch.backgroundTabMinutes);
      }
      if (typeof patch.backgroundTabKeepCount === 'number' && patch.backgroundTabKeepCount >= 0) {
        s.backgroundTabKeepCount = Math.floor(patch.backgroundTabKeepCount);
      }
      if (
        patch.oneShotStart === 'blank' ||
        patch.oneShotStart === 'search' ||
        patch.oneShotStart === 'custom'
      ) {
        s.oneShotStart = patch.oneShotStart;
      }
      // A 1-shot window is navigated to this by the host, so it is held to the
      // same schemes as a search template. Empty clears it.
      if (typeof patch.oneShotStartUrl === 'string') {
        const url = patch.oneShotStartUrl.trim();
        if (url === '' || isWebUrl(url)) s.oneShotStartUrl = url;
      }
    });
    if (settingsStore.current.launchAtLogin !== before) {
      applyLaunchAtLogin(settingsStore.current.launchAtLogin);
    }
    // Open windows re-lay out immediately; no restart, unlike extensions.
    if (settingsStore.current.toolbarPosition !== toolbarBefore) {
      windowManager.refreshAllWindows();
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
