import { BrowserWindow, BaseWindow } from 'electron';
import { WindowPlacement } from '@shared/types';
import { canPositionWindows } from './linux-platform';

/**
 * Placements captured from minimized windows report off-screen positions and
 * a title-bar-sized rect; implausible bounds are ignored on restore in favor
 * of defaults.
 */
export function isSane(p: WindowPlacement | undefined | null): p is WindowPlacement {
  return !!p && p.width >= 300 && p.height >= 200 && p.x > -10000 && p.y > -10000;
}

/**
 * Never captures from a minimized window (returns null). `previous` is the
 * placement already on file: where the app cannot place its own windows the
 * reported position is whatever the compositor chose, so the stored
 * coordinates are kept rather than overwritten with it (sizes are still
 * reported correctly, and remain worth saving).
 */
export function capturePlacement(
  win: BrowserWindow | BaseWindow,
  previous?: WindowPlacement | null
): WindowPlacement | null {
  if (win.isMinimized()) return null;
  const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const keep = !canPositionWindows() && isSane(previous) ? previous : null;
  const placement: WindowPlacement = {
    x: keep ? keep.x : b.x,
    y: keep ? keep.y : b.y,
    width: b.width,
    height: b.height,
    maximized: win.isMaximized()
  };
  return isSane(placement) ? placement : null;
}

export function windowOptionsFrom(
  saved: WindowPlacement | undefined | null,
  defaults: { width: number; height: number }
): { x?: number; y?: number; width: number; height: number; maximized: boolean } {
  if (isSane(saved)) {
    return { x: saved.x, y: saved.y, width: saved.width, height: saved.height, maximized: saved.maximized };
  }
  return { width: defaults.width, height: defaults.height, maximized: false };
}

/**
 * Re-asserts a restored position. X11 window managers may place a window
 * themselves when it is first mapped, ignoring the position passed in the
 * creation options, so this is called again once the window is shown.
 * Harmless on Windows/macOS; skipped where positioning is unsupported.
 * No-op without a saved position.
 */
export function applyRestoredPosition(
  win: BrowserWindow | BaseWindow,
  opts: { x?: number; y?: number }
): void {
  if (!canPositionWindows()) return;
  if (opts.x !== undefined && opts.y !== undefined) win.setPosition(opts.x, opts.y);
}
