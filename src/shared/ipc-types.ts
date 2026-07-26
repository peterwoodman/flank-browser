import type { AppSettings } from './types';

/** One tile in the Manager's space grid. */
export interface SpaceSummary {
  id: string;
  name: string;
  open: boolean;
  /** flank-icon:// URLs for the favicon montage (up to 4); empty = show the initial letter. */
  icons: string[];
}

export interface ManagerState {
  spaces: SpaceSummary[];
  settings: AppSettings;
}

/** One extension found in another Chromium browser, offered for import. */
export interface ImportableExtensionDto {
  /** The browser's extension id; also the folder name Flank imports it to. */
  extensionId: string;
  name: string;
  version: string;
  /** Inline data: URL for the extension's icon; empty if it has none. */
  icon: string;
  /** Where it was found, e.g. "Google Chrome · Personal". */
  source: string;
  /** Already in Flank's extension list, so it can't be selected again. */
  alreadyAdded: boolean;
}

export interface BrowserScanDto {
  /** Display names of the browsers found installed, for the empty-state message. */
  browsers: string[];
  extensions: ImportableExtensionDto[];
}

export interface ImportResultDto {
  imported: number;
  /** Names of extensions that could not be copied. */
  errors: string[];
}
