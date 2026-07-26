import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// One data folder for everything: the JSON stores below plus the Chromium
// profile, which lands in subfolders of the same directory (userData is
// pointed here).
export const dataDir = path.join(app.getPath('appData'), 'Flank-Electron');

export const settingsFile = path.join(dataDir, 'settings.json');
export const spacesFile = path.join(dataDir, 'spaces.json');
export const sessionsDir = path.join(dataDir, 'sessions');
export const iconsDir = path.join(dataDir, 'icons');
export const logFile = path.join(dataDir, 'debug.log');

export function sessionFilePath(spaceId: string): string {
  return path.join(sessionsDir, `${spaceId}.json`);
}

export function ensureDataDirs(): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });
}
