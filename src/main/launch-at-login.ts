import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { logError } from './log';

/**
 * Launch-at-login registration. Windows/macOS use the OS login-item API
 * (registry Run key / login items); Linux uses an XDG autostart .desktop file.
 * At login this restores last session's spaces like any plain launch.
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  try {
    if (process.platform === 'linux') {
      const autostartDir = path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(app.getPath('home'), '.config'),
        'autostart'
      );
      const desktopFile = path.join(autostartDir, 'flank.desktop');
      if (enabled) {
        fs.mkdirSync(autostartDir, { recursive: true });
        fs.writeFileSync(
          desktopFile,
          `[Desktop Entry]\nType=Application\nName=Flank\nExec="${process.execPath}"\nX-GNOME-Autostart-enabled=true\n`
        );
      } else {
        fs.rmSync(desktopFile, { force: true });
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled });
    }
  } catch (err) {
    logError('applyLaunchAtLogin', err);
  }
}
