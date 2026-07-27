import type { CSSProperties } from 'react';
import { colorScheme } from '@shared/color-schemes';

/**
 * The custom properties a backdrop-wash scope carries: both of a color
 * scheme's accents, from which the stylesheet picks per the OS theme
 * (styles.css → wash scopes).
 */
export function washVars(schemeId: string): CSSProperties {
  const scheme = colorScheme(schemeId);
  return {
    '--wash-accent-light': scheme.light,
    '--wash-accent-dark': scheme.dark
  } as CSSProperties;
}
