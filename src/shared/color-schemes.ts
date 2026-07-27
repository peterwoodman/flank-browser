// The palette a space picks its backdrop from (docs/ui.md → Backdrop).

/**
 * One backdrop color scheme. A scheme is a single accent: the wash mixes its
 * veil and pool from it, and everything else about the chrome still follows the
 * OS light/dark theme, so each scheme names an accent per theme.
 */
export interface ColorScheme {
  id: string;
  name: string;
  light: string;
  /** Brighter than the light accent: a dark base swallows a wash. */
  dark: string;
}

/** The first entry is the default for spaces that never picked one. */
export const COLOR_SCHEMES: readonly ColorScheme[] = [
  { id: 'azure', name: 'Azure', light: '#0067c0', dark: '#4cc2ff' },
  { id: 'lagoon', name: 'Lagoon', light: '#00757d', dark: '#45d5d0' },
  { id: 'fern', name: 'Fern', light: '#2e7d32', dark: '#79dd8b' },
  { id: 'amber', name: 'Amber', light: '#a86a00', dark: '#ffc86b' },
  { id: 'ember', name: 'Ember', light: '#b4472a', dark: '#ff9b7a' },
  { id: 'rose', name: 'Rose', light: '#b3305f', dark: '#ff9cbb' },
  { id: 'iris', name: 'Iris', light: '#5a46c8', dark: '#b6a7ff' },
  { id: 'graphite', name: 'Graphite', light: '#4b5563', dark: '#aab6c4' }
];

export const DEFAULT_COLOR_SCHEME = COLOR_SCHEMES[0].id;

/** Unknown, missing, and hand-edited ids all resolve to the default. */
export function colorScheme(id: string | undefined): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? COLOR_SCHEMES[0];
}

/* The wash's ingredients, mirroring styles.css: the theme base it sits on, the
   accent veil over it, and the light lifting off the top edge. Duplicated here
   because the native caption strip is painted by the main process and has to
   land on the same color as the CSS. */
const WASH = {
  light: { base: '#f3f3f3', veil: 0.05, glow: 0.7 },
  dark: { base: '#202020', veil: 0.09, glow: 0.09 }
};

/**
 * The wash's color along the top of the window, where the glow is at full
 * strength — the color the native caption-button strip has to match, since it
 * takes one flat color (see titleBarOverlayColors in the main process).
 */
export function washTopColor(scheme: ColorScheme, dark: boolean): string {
  const wash = dark ? WASH.dark : WASH.light;
  const veiled = blend(rgbOf(wash.base), rgbOf(dark ? scheme.dark : scheme.light), wash.veil);
  return hexOf(blend(veiled, [255, 255, 255], wash.glow));
}

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexOf(rgb: Rgb): string {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function blend(base: Rgb, over: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + over[i] * alpha) as Rgb;
}
