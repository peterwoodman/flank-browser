import { createContext, useContext } from 'react';

/**
 * Content views stack above the chrome view; while any flyout, dropdown, or
 * drag needs to draw (or receive pointer events) over the pages, the chrome
 * must be raised to the top. This context counts overlapping requests and
 * tells the main process on 0↔1 transitions.
 */
export interface OverlayController {
  acquire: () => void;
  release: () => void;
}

export const OverlayContext = createContext<OverlayController>({
  acquire: () => {},
  release: () => {}
});

export function useOverlay(): OverlayController {
  return useContext(OverlayContext);
}
