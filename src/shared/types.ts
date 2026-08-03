// Data model per docs/data-model.md. JSON, camelCase, human-editable.
// IDs are GUID strings without dashes; timestamps are ISO 8601 strings.

export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  /** The id the browser engine assigned on install; written back after the first successful add. */
  browserExtensionId: string;
}

/** Where a web view's toolbar sits: down the section's left edge, or above it. */
export type ToolbarPosition = 'side' | 'top';

/**
 * What a 1-shot window opens on: an empty page, the search engine's own home
 * page, or a page of the user's choosing (`oneShotStartUrl`).
 */
export type OneShotStart = 'blank' | 'search' | 'custom';

export interface AppSettings {
  version: number;
  /** `{query}` is replaced with the URL-encoded search text. */
  searchTemplate: string;
  /** Autocomplete endpoint; empty disables remote suggestions. */
  suggestTemplate: string;
  launchAtLogin: boolean;
  /** Applies to every section of every space window. */
  toolbarPosition: ToolbarPosition;
  /** Idle minutes before a backgrounded left tab is unloaded. */
  backgroundTabMinutes: number;
  /** What a 1-shot window opens on. */
  oneShotStart: OneShotStart;
  /** The page `oneShotStart: 'custom'` opens; ignored by the other modes. */
  oneShotStartUrl: string;
  extensions: ExtensionInfo[];
  /** Ids of spaces open in the last session, reopened on the next plain launch. */
  openSpaces: string[];
  managerWindow?: WindowPlacement;
  /** Per-origin permission decisions: origin -> permission name -> allowed. */
  permissions?: Record<string, Record<string, boolean>>;
}

/**
 * One browser profile: a browsing identity, shared by the spaces in it. Each
 * profile owns a Chromium partition, so cookies, logins, and cache are common
 * to its spaces and separate from every other profile's.
 */
export interface Profile {
  id: string;
  name: string;
  order: number;
  /** The Chromium partition holding this profile's cookies, logins, and cache. */
  partition: string;
}

export interface SpaceLink {
  id: string;
  title: string;
  url: string;
  /** Relative path into the icons cache; empty means "fetch a favicon on next display". */
  icon: string;
  /** Manifest background/theme color (CSS) for the launch splash; empty = theme-neutral. */
  background: string;
  /**
   * Same-site navigations from this link's page stay in its section instead
   * of routing to the right one — the section acts like the site's app window
   * (docs/behaviors.md → Navigation routing). Absent means off.
   */
  navigateInPlace?: boolean;
  order: number;
}

export interface Space {
  id: string;
  name: string;
  /** Id of the profile whose browsing data this space's pages use. */
  profileId: string;
  order: number;
  splitRatio: number;
  /** Id of the backdrop color scheme (see color-schemes.ts). */
  colorScheme: string;
  window?: WindowPlacement;
  links: SpaceLink[];
}

export interface SpacesFile {
  version: number;
  profiles: Profile[];
  spaces: Space[];
}

export interface TrailEntry {
  url: string;
  title: string;
  visitedAt: string;
}

export type SectionMode = 'home' | 'web';

export interface SessionSection {
  mode: SectionMode;
  url: string;
  /** Whether the section was visible when saved. A closed right section keeps its trail. */
  open: boolean;
  /** Newest first, capped at 500. */
  trail: TrailEntry[];
}

export interface SessionFile {
  version: number;
  savedAt: string;
  left: SessionSection;
  right: SessionSection;
}

export const TRAIL_CAP = 500;

export function defaultSettings(): AppSettings {
  return {
    version: 1,
    searchTemplate: 'https://www.ecosia.org/search?method=index&q={query}',
    suggestTemplate: 'https://api.qwant.com/v3/suggest?q={query}&version=2',
    launchAtLogin: false,
    toolbarPosition: 'side',
    backgroundTabMinutes: 30,
    oneShotStart: 'blank',
    oneShotStartUrl: '',
    extensions: [],
    openSpaces: []
  };
}

/** Empty of profiles; the store fills in the first one (see SpacesStore.load). */
export function defaultSpacesFile(): SpacesFile {
  return { version: 1, profiles: [], spaces: [] };
}

export function emptySection(): SessionSection {
  return { mode: 'home', url: '', open: false, trail: [] };
}

export function defaultSessionFile(): SessionFile {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    left: { ...emptySection(), open: true },
    right: emptySection()
  };
}
