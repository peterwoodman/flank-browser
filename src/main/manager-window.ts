import { BrowserWindow, nativeTheme } from 'electron';
import { settingsStore } from './stores/settings-store';
import { applyRestoredPosition, capturePlacement, windowOptionsFrom } from './placement';
import { chromePreloadPath, loadChromeRoute } from './renderer-url';
import iconPath from '../../resources/icon.png?asset';

export const TITLEBAR_HEIGHT = 40;

/** Windows and macOS take the window icon from the executable/bundle; Linux
 * windows must set one explicitly or the WM shows a generic placeholder. */
export const windowIcon = process.platform === 'linux' ? iconPath : undefined;

let managerWindow: BrowserWindow | null = null;

/**
 * Colors for the native caption-button strip. The strip takes one flat color,
 * so this is the backdrop wash's color where it sits — the base tinted by
 * `--wash-veil` and lifted by `--wash-glow` (styles.css) — rather than the
 * bare window base, which would show as a patch on the title bar. Keep the two
 * in step; the wash is deliberately vertical so one color can match it across
 * the whole width. Pages override this with their own adaptive colors.
 */
export function titleBarOverlayColors(): { color: string; symbolColor: string; height: number } {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#374145' : '#f7f9fa',
    symbolColor: dark ? '#f0f0f0' : '#1a1a1a',
    height: TITLEBAR_HEIGHT
  };
}

/** Opens the Manager window (at most one instance), or focuses the open one. */
export function openManager(): BrowserWindow {
  if (managerWindow) {
    if (managerWindow.isMinimized()) managerWindow.restore();
    managerWindow.focus();
    return managerWindow;
  }

  const opts = windowOptionsFrom(settingsStore.current.managerWindow, { width: 660, height: 560 });
  const win = new BrowserWindow({
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    minWidth: 400,
    minHeight: 300,
    show: false,
    icon: windowIcon,
    title: 'Flank',
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: titleBarOverlayColors() } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
    webPreferences: {
      preload: chromePreloadPath
    }
  });
  managerWindow = win;
  applyRestoredPosition(win, opts);

  if (opts.maximized) win.maximize();
  win.once('ready-to-show', () => {
    win.show();
    if (!opts.maximized) applyRestoredPosition(win, opts);
  });
  loadChromeRoute(win.webContents, 'manager');

  const persistBounds = (): void => {
    const placement = capturePlacement(win, settingsStore.current.managerWindow);
    if (placement) settingsStore.update((s) => (s.managerWindow = placement));
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
  win.on('close', persistBounds);
  // Open-space dots refresh whenever the Manager regains focus.
  win.on('focus', () => win.webContents.send('flank:manager:refresh'));
  win.on('closed', () => {
    managerWindow = null;
  });

  return win;
}

export function getManagerWindow(): BrowserWindow | null {
  return managerWindow;
}

/** The Manager refreshes open-space dots whenever it regains focus. */
export function notifyManager(channel: string, ...args: unknown[]): void {
  managerWindow?.webContents.send(`flank:${channel}`, ...args);
}
