import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { log, logError } from './log';
import iconPath from '../../resources/icon.png?asset';

/**
 * The desktop file id. It must match `desktopName` in package.json, from
 * which Electron derives the window's `app_id` (Wayland) and `WM_CLASS`
 * (X11): desktop environments pair a window with its launcher by comparing
 * those against this file's base name, and take the app icon from the entry.
 * Without the pairing the shell falls back to a generic icon — and on
 * Wayland there is no other way to give a window an icon, since the
 * BrowserWindow `icon` option only reaches X11.
 */
const APP_ID = 'flank';

/**
 * Registers the app with the desktop: an XDG desktop entry plus its icon in
 * the user's icon theme. The release is a plain archive with no installer,
 * so the app does this itself on every start — cheap, and it re-points the
 * entry when the folder is moved.
 */
export function ensureDesktopEntry(): void {
  if (process.platform !== 'linux' || !app.isPackaged) return;
  try {
    const dataHome =
      process.env.XDG_DATA_HOME ?? path.join(app.getPath('home'), '.local', 'share');

    const iconDir = path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(iconPath, path.join(iconDir, `${APP_ID}.png`));

    const entry =
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Flank',
        'Comment=A personal, space-oriented web browser',
        `Exec="${process.execPath}" %U`,
        `Icon=${APP_ID}`,
        `StartupWMClass=${APP_ID}`,
        'Terminal=false',
        'Categories=Network;WebBrowser;'
      ].join('\n') + '\n';

    const appsDir = path.join(dataHome, 'applications');
    fs.mkdirSync(appsDir, { recursive: true });
    const file = path.join(appsDir, `${APP_ID}.desktop`);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current !== entry) {
      fs.writeFileSync(file, entry);
      log(`desktop entry installed: ${file}`);
    }
  } catch (err) {
    logError('ensureDesktopEntry', err);
  }
}
