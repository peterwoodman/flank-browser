import { protocol, net } from 'electron';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { dataDir } from './paths';
import { settingsStore } from './stores/settings-store';

export const ICON_SCHEME = 'flank-icon';

/** Must run before app ready. */
export function registerIconSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ICON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

/** URL for a data-relative icon path (e.g. "icons/3fa4.png" from spaces.json). */
export function iconUrl(relativePath: string): string {
  return `${ICON_SCHEME}://data/${relativePath.replace(/\\/g, '/')}`;
}

/** URL for an extension's own icon file (must live inside a configured extension folder). */
export function extensionIconUrl(absolutePath: string): string {
  return `${ICON_SCHEME}://ext/${encodeURIComponent(absolutePath)}`;
}

/**
 * Serves local icon files to the chrome renderer:
 *   flank-icon://data/<path relative to the data dir, icons/ only>
 *   flank-icon://ext/<encoded absolute path inside a configured extension folder>
 */
export function installIconProtocol(): void {
  protocol.handle(ICON_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host === 'data') {
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
      const file = path.normalize(path.join(dataDir, rel));
      const iconsRoot = path.join(dataDir, 'icons') + path.sep;
      if (file.startsWith(iconsRoot) && fs.existsSync(file)) {
        return net.fetch(pathToFileURL(file).toString());
      }
    } else if (url.host === 'ext') {
      const file = path.normalize(decodeURIComponent(url.pathname).replace(/^\//, ''));
      const allowed = settingsStore.current.extensions.some((e) =>
        file.startsWith(path.normalize(e.path) + path.sep)
      );
      if (allowed && fs.existsSync(file)) {
        return net.fetch(pathToFileURL(file).toString());
      }
    }
    return new Response(null, { status: 404 });
  });
}
