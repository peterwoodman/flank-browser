import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// One data folder for everything: the JSON stores below plus the Chromium
// profile, which lands in subfolders of the same directory (userData is
// pointed here). FLANK_DATA_DIR points the whole lot somewhere else, so a
// throwaway profile (demos, screenshots, trying a change against clean data)
// never touches the real one.
export const dataDir = process.env.FLANK_DATA_DIR?.trim()
  ? path.resolve(process.env.FLANK_DATA_DIR.trim())
  : path.join(app.getPath('appData'), 'Flank-Electron');

export const settingsFile = path.join(dataDir, 'settings.json');
export const spacesFile = path.join(dataDir, 'spaces.json');
export const sessionsDir = path.join(dataDir, 'sessions');
export const iconsDir = path.join(dataDir, 'icons');
/** Extensions copied out of another browser; created on first import. */
export const extensionsDir = path.join(dataDir, 'extensions');
export const logFile = path.join(dataDir, 'debug.log');

export function sessionFilePath(spaceId: string): string {
  return path.join(sessionsDir, `${spaceId}.json`);
}

export function ensureDataDirs(): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });
}
