import { WebContents } from 'electron';
import { logError } from './log';

export interface ManifestInfo {
  /** short_name over name (a stable app label); null when absent. */
  name: string | null;
  /** Absolute icon URLs, best first (any/unspecified purpose over maskable, largest raster). */
  iconUrls: string[];
  /** Splash canvas: background_color, falling back to theme_color. */
  backgroundColor: string | null;
}

export const emptyManifest: ManifestInfo = {
  name: null,
  iconUrls: [],
  backgroundColor: null
};

/**
 * Fetches the page's web app manifest from inside the page (same-origin, so
 * cookies apply) and extracts the fields Flank uses. Empty when the page
 * declares no manifest or it can't be read.
 */
const manifestProbeScript = `
(async () => {
  try {
    const link = document.querySelector('link[rel~="manifest"]');
    if (!link || !link.href) return '';
    const res = await fetch(link.href, { credentials: 'same-origin' });
    if (!res.ok) return '';
    return JSON.stringify({ base: link.href, body: await res.text() });
  } catch (e) { return ''; }
})()`;

export async function readManifest(contents: WebContents): Promise<ManifestInfo> {
  try {
    const envelope = (await contents.executeJavaScript(manifestProbeScript, false)) as string;
    if (!envelope) return emptyManifest;

    const outer = JSON.parse(envelope) as { base: string; body: string };
    if (!outer.body || !outer.base) return emptyManifest;
    const manifestUrl = new URL(outer.base);
    const root = JSON.parse(outer.body) as Record<string, unknown>;

    const rawName = str(root, 'short_name') ?? str(root, 'name');
    const name = rawName && rawName.trim() ? rawName.trim() : null;

    const iconUrls: string[] = [];
    if (Array.isArray(root.icons)) {
      const ranked = root.icons
        .map((ic) => ({
          src: str(ic as Record<string, unknown>, 'src') ?? '',
          sizes: str(ic as Record<string, unknown>, 'sizes') ?? '',
          purpose: str(ic as Record<string, unknown>, 'purpose') ?? ''
        }))
        .filter(
          (ic) =>
            ic.src.length > 0 &&
            !ic.src.toLowerCase().endsWith('.svg') &&
            ic.purpose.toLowerCase() !== 'monochrome'
        )
        // "any"/unspecified render correctly untouched; pure "maskable" has
        // safe-zone padding and only looks right when cropped, so it ranks
        // below. Then largest wins.
        .sort((a, b) => {
          const rank = (ic: { purpose: string }): number =>
            ic.purpose.length === 0 || ic.purpose.toLowerCase().includes('any') ? 1 : 0;
          return rank(b) - rank(a) || iconSize(b.sizes) - iconSize(a.sizes);
        });
      for (const ic of ranked) {
        try {
          const abs = new URL(ic.src, manifestUrl);
          if (abs.protocol === 'http:' || abs.protocol === 'https:') iconUrls.push(abs.toString());
        } catch {
          /* skip malformed */
        }
      }
    }

    const backgroundColor = str(root, 'background_color') ?? str(root, 'theme_color');

    return { name, iconUrls, backgroundColor };
  } catch (err) {
    logError('manifest read failed', err);
    return emptyManifest;
  }
}

function str(element: Record<string, unknown>, name: string): string | null {
  const v = element?.[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Largest width in a manifest icon "sizes" string ("48x48 96x96"); 0 for "any". */
function iconSize(sizes: string): number {
  let best = 0;
  for (const token of sizes.split(' ').filter(Boolean)) {
    const x = token.toLowerCase().indexOf('x');
    if (x > 0) {
      const width = parseInt(token.slice(0, x), 10);
      if (Number.isFinite(width)) best = Math.max(best, width);
    }
  }
  return best;
}
