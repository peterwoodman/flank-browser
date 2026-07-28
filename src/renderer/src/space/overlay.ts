import { createContext, useContext, useMemo, useRef } from 'react';
import { send } from '../ipc';

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

/** The controller a browsing window's chrome provides to everything in it. */
export function useOverlayController(windowId: string): OverlayController {
  const count = useRef(0);
  return useMemo(
    () => ({
      acquire: () => {
        if (++count.current === 1) send('space:overlay', windowId, true);
      },
      release: () => {
        if (--count.current === 0) send('space:overlay', windowId, false);
      }
    }),
    [windowId]
  );
}
