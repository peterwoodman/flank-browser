import type { PageColors } from '@shared/space-types';

/**
 * Adaptive-chrome color math (docs/ui.md): pages report their theme-color /
 * computed colors as raw CSS; the chrome parses them, guarantees a readable
 * foreground, and derives dark/light.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ResolvedColors {
  bg: string;
  fg: string;
  dark: boolean;
}

/** Parses CSS `#rgb`/`#rrggbb`/`#rrggbbaa`/`rgb()`/`rgba()`. Transparent → null. */
export function parseCssColor(css: string | null | undefined): Rgb | null {
  if (!css || !css.trim()) return null;
  const value = css.trim().toLowerCase();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0], 16) * 17,
        g: parseInt(hex[1], 16) * 17,
        b: parseInt(hex[2], 16) * 17
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      if (hex.length === 8 && parseInt(hex.slice(6, 8), 16) < 26) return null; // ~transparent
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
    return null;
  }

  if (value.startsWith('rgb')) {
    const open = value.indexOf('(');
    const close = value.indexOf(')');
    if (open < 0 || close <= open) return null;
    const parts = value
      .slice(open + 1, close)
      .split(/[\s,/]+/)
      .filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map(Number);
    if (![r, g, b].every(Number.isFinite)) return null;
    if (parts.length >= 4) {
      const a = parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
      if (Number.isFinite(a) && a < 0.1) return null; // effectively transparent
    }
    const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
    return { r: clamp(r), g: clamp(g), b: clamp(b) };
  }

  if (value === 'white') return { r: 255, g: 255, b: 255 };
  if (value === 'black') return { r: 0, g: 0, b: 0 };
  return null;
}

/** Perceived luminance 0–255. */
function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function isDark(c: Rgb): boolean {
  return luminance(c) < 128;
}

/** A foreground guaranteed to read against the background. */
function ensureContrast(foreground: Rgb, background: Rgb): Rgb {
  if (Math.abs(luminance(foreground) - luminance(background)) < 60) {
    return isDark(background) ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  }
  return foreground;
}

function toHex(c: Rgb): string {
  const h = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Raw page-reported colors → chrome-ready values, or null to use defaults. */
export function resolveChromeColors(colors: PageColors | null | undefined): ResolvedColors | null {
  if (!colors) return null;
  const bg = parseCssColor(colors.bg);
  if (!bg) return null;
  const reported = parseCssColor(colors.fg);
  const fg = ensureContrast(
    reported ?? (isDark(bg) ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }),
    bg
  );
  return { bg: toHex(bg), fg: toHex(fg), dark: isDark(bg) };
}
