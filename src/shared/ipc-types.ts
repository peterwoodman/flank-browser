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
