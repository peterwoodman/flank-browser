import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Space, SpaceLink } from '@shared/types';
import { dataDir, iconsDir } from './paths';
import { logError } from './log';
import { readManifest } from './manifest-info';
import type { ContentView } from './content-view';

/**
 * Manages the home grid favicon cache (<data>/icons).
 *
 * Two sources, in order of fidelity:
 * - `storeIcon` saves the favicon the page itself declared, captured live
 *   from an open view (pinning a page, or a home-link tab loading). This is
 *   what real browsers show, and the only way per-service icons work
 *   (mail/calendar/drive.google.com all get the generic "G" from icon
 *   services; hosts differing only by port get nothing).
 * - `ensureIcon` is the fallback for links that were never opened (added by
 *   hand): the site's own /favicon.ico, then DuckDuckGo's icon service.
 *   Failed sources are only attempted once per app run.
 */

const FETCH_TIMEOUT_MS = 10_000;
const attemptedKeys = new Set<string>();

/**
 * Saves a page-provided favicon as the link's icon. Returns true if the link
 * or the icon's content changed.
 */
export function storeIcon(link: SpaceLink, image: Buffer): boolean {
  if (image.length === 0) return false;

  // Keyed by a hash of the link URL: stable across refreshes, distinct for
  // same-host links (ports, paths), shared only when URLs match.
  const relativePath = path.join('icons', urlHash(link.url) + '.png');
  const fullPath = path.join(dataDir, relativePath);

  try {
    if (link.icon === relativePath && fs.existsSync(fullPath) && fs.readFileSync(fullPath).equals(image)) {
      return false; // unchanged; avoid save/refresh churn (favicon events re-fire)
    }
    fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(fullPath, image);
  } catch (err) {
    logError('storeIcon', err);
    return false;
  }

  link.icon = relativePath;
  return true;
}

/**
 * Downloads an image, or returns null if the fetch fails or the response
 * isn't a raster image (SPAs answer arbitrary paths with their HTML).
 */
export async function tryDownloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return looksLikeImage(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/** Fallback fetch for links without a live-captured icon. Returns true if the link was updated. */
export async function ensureIcon(link: SpaceLink): Promise<boolean> {
  if (link.icon && fs.existsSync(path.join(dataDir, link.icon))) return false;

  let uri: URL;
  try {
    uri = new URL(link.url);
  } catch {
    return false;
  }

  // Authority, not host: LAN services on the same host differ by port.
  const key = uri.host.replace(':', '_');
  const relativePath = path.join('icons', key + '.ico');
  const fullPath = path.join(dataDir, relativePath);

  if (fs.existsSync(fullPath)) {
    link.icon = relativePath;
    return true;
  }

  if (attemptedKeys.has(key)) return false;
  attemptedKeys.add(key);

  // The site's own /favicon.ico first (works for LAN services and is at
  // least as specific as any icon service), then DuckDuckGo (covers sites
  // that declare icons only via <link> tags).
  const sources = [
    `${uri.protocol}//${uri.host}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${uri.hostname}.ico`
  ];

  for (const source of sources) {
    const bytes = await tryDownloadImage(source);
    if (!bytes) continue;

    try {
      fs.mkdirSync(iconsDir, { recursive: true });
      fs.writeFileSync(fullPath, bytes);
    } catch (err) {
      logError('ensureIcon write', err);
      return false;
    }

    link.icon = relativePath;
    return true;
  }

  return false;
}

/** Fills missing icons for a space's links; returns true if anything changed. */
export async function ensureSpaceIcons(space: Space): Promise<boolean> {
  let changed = false;
  for (const link of [...space.links]) {
    changed = (await ensureIcon(link)) || changed;
  }
  return changed;
}

/** Lists the page's declared icons: href, rel, and the sizes attribute. */
const iconProbeScript = `
JSON.stringify([...document.querySelectorAll(
    'link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]')]
    .filter(l => l.href)
    .map(l => ({ href: l.href, rel: l.rel, sizes: (l.sizes && l.sizes.value) || '' })))`;

/**
 * Best favicon for a home tile (docs/behaviors.md → Favicons). Priority: the
 * PWA manifest's app icons, then the page's declared <link> icons (largest
 * raster; apple-touch is ~180 px), then the engine-reported favicon URLs,
 * which are tab-sized and upscale blurry.
 */
export async function captureBestFavicon(
  view: ContentView,
  manifestIconUrls?: string[]
): Promise<Buffer | null> {
  const manifestIcons = manifestIconUrls ?? (await readManifest(view.webContents)).iconUrls;
  for (const href of manifestIcons) {
    const bytes = await tryDownloadImage(href);
    if (bytes) return bytes;
  }

  try {
    const raw = (await view.webContents.executeJavaScript(iconProbeScript, false)) as string;
    const candidates = (
      JSON.parse(raw) as { href: string; rel: string; sizes: string }[]
    )
      .filter((c) => c.href.startsWith('http') && !c.href.toLowerCase().endsWith('.svg'))
      .sort((a, b) => declaredIconSize(b.rel, b.sizes) - declaredIconSize(a.rel, a.sizes));

    for (const candidate of candidates) {
      const bytes = await tryDownloadImage(candidate.href);
      if (bytes) return bytes;
    }
  } catch (err) {
    logError('favicon probe failed', err);
  }

  for (const href of view.latestFaviconUrls) {
    const bytes = await tryDownloadImage(href);
    if (bytes) return bytes;
  }

  return null;
}

/** Pixel size a link tag promises ("32x32", possibly several, "any" for SVG). */
function declaredIconSize(rel: string, sizes: string): number {
  let best = 0;
  for (const token of sizes.split(' ').filter(Boolean)) {
    const x = token.toLowerCase().indexOf('x');
    if (x > 0) {
      const width = parseInt(token.slice(0, x), 10);
      if (Number.isFinite(width)) best = Math.max(best, width);
    }
  }
  if (best === 0) {
    // No sizes attribute: apple-touch icons are 180 by convention.
    best = rel.toLowerCase().includes('apple-touch') ? 180 : 32;
  }
  return best;
}

function urlHash(url: string): string {
  return createHash('sha1').update(url, 'utf8').digest('hex').slice(0, 16);
}

function looksLikeImage(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  return (
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) || // ICO
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) || // PNG
    (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) || // GIF
    (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
    (bytes[0] === 0x42 && bytes[1] === 0x4d) // BMP
  );
}
