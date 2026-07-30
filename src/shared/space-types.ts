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

/**
 * A navigation that never became a page. The chrome words the reason from the
 * code, so the host reports only the facts.
 */
export interface LoadErrorDto {
  /** The address that failed, which the panel's retry goes back to. */
  url: string;
  host: string;
  /** The engine's error name, e.g. `ERR_CONNECTION_REFUSED`. */
  code: string;
  /** A certificate refusal, which the user may choose to continue past. */
  certificate: boolean;
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
  /** The page stopped answering; the chrome offers to wait or end it. */
  unresponsive: boolean;
  /** Set while a failed navigation's panel is up (docs/behaviors.md). */
  loadError: LoadErrorDto | null;
  colors: PageColors | null;
  splash: SplashDto | null;
}

/** One certificate offered when a server asks the browser to identify itself. */
export interface ClientCertDto {
  /** Identifies the choice back to the engine's own list. */
  fingerprint: string;
  subject: string;
  issuer: string;
  /** ISO date; a certificate past it is the wrong one to send. */
  expiresAt: string;
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

/**
 * A 1-shot window's chrome state (docs/ui.md → 1-shot window). One free
 * browsing pane and nothing of a space: no links, no split, no trail.
 */
export interface OneShotStateDto {
  windowId: string;
  /** The single pane, reported under `left` so one web chrome serves both. */
  pane: SectionDto;
  extensions: ExtensionButtonDto[];
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
