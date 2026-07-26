import { WebContents } from 'electron';
import { join } from 'path';

export const chromePreloadPath = join(__dirname, '../preload/chrome.js');
export const contentPreloadPath = join(__dirname, '../preload/content.js');

/** Loads a chrome-UI route (`manager` or `space/<windowId>`) into a web contents. */
export function loadChromeRoute(contents: WebContents, route: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void contents.loadURL(`${devUrl}#${route}`);
  } else {
    void contents.loadFile(join(__dirname, '../renderer/index.html'), { hash: route });
  }
}
