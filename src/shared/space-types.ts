import type { SpaceLink, ToolbarPosition, TrailEntry } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = 'left' | 'right';

/** Adaptive page colors reported by the content script (CSS color strings). */
export interface PageColors {
  bg: string;
  fg: string;
}

export interface SplashDto {
  title: string;
  /** flank-icon:// URL or empty. */
  icon: string;
  /** CSS color from the app manifest, or empty for theme-neutral. */
  background: string;
}

export interface SectionDto {
  side: Side;
  /** Right section only: whether it is currently shown. Left is always open. */
  open: boolean;
  mode: 'home' | 'web';
  url: string;
  pageTitle: string;
  canGoBack: boolean;
  /** Home ✕ button: whether it is shown at all. */
  showReturnButton: boolean;
  /** Home ✕ button: true = "Close view" (right, nothing to return to), false = "Back to page". */
  returnCloses: boolean;
  /** Address bar shows when the page is not from a home link (docs/ui.md). */
  showAddressBar: boolean;
  trail: TrailEntry[];
  loading: boolean;
  crashed: boolean;
  colors: PageColors | null;
  splash: SplashDto | null;
}

export interface SwitcherSpaceDto {
  id: string;
  name: string;
  isCurrent: boolean;
  isOpen: boolean;
}

export interface ExtensionButtonDto {
  id: string;
  name: string;
  /** flank-icon://ext/ URL, or empty for the fallback glyph. */
  icon: string;
}

export interface SpaceStateDto {
  spaceId: string;
  name: string;
  /** Backdrop scheme id; the chrome mixes the wash from it (docs/ui.md). */
  colorScheme: string;
  links: SpaceLink[];
  splitRatio: number;
  rightOpen: boolean;
  left: SectionDto;
  right: SectionDto;
  extensions: ExtensionButtonDto[];
  /** From settings; the chrome re-renders when it changes (docs/ui.md). */
  toolbarPosition: ToolbarPosition;
}

/** One row in a search/address suggestion dropdown. */
export interface SuggestionDto {
  text: string;
  /** Direct navigation target; null means "search for text". */
  url: string | null;
  /** Home link backing a local match, so activation reuses its tab. */
  linkId: string | null;
  /** Dimmed second line (the URL for local matches). */
  detail: string;
  kind: 'link' | 'trail' | 'search';
}
