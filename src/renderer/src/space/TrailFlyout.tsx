import { useEffect } from 'react';
import type { TrailEntry } from '@shared/types';
import { invoke } from '../ipc';
import { useOverlay } from './overlay';
import { CloseIcon } from '../components/Icons';

/**
 * The trail flyout: this view's history, newest first — title, URL, time.
 * Entries are individually deletable; "Clear trail" sits at the bottom
 * (docs/ui.md → Trail flyout).
 */
export function TrailFlyout({
  spaceId,
  side,
  trail,
  onClose
}: {
  spaceId: string;
  side: 'left' | 'right';
  trail: TrailEntry[];
  onClose: () => void;
}): React.JSX.Element {
  const overlay = useOverlay();

  useEffect(() => {
    overlay.acquire();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      overlay.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Fixed light-dismiss scrim; the flyout itself is a sibling so it can
          anchor to this section's .web-chrome instead of the window. */}
      <div className="overlay" onMouseDown={onClose} />
      <div className="flyout trail-flyout">
        <div className="trail-list">
          {trail.length === 0 && <div className="trail-empty">No trail yet.</div>}
          {trail.map((entry, index) => (
            <div key={`${entry.url}:${entry.visitedAt}:${index}`} className="trail-row">
              <button
                className="trail-entry"
                title={entry.url}
                onClick={() => {
                  onClose();
                  void invoke('trail:navigate', spaceId, side, index);
                }}
              >
                <span className="trail-title">{entry.title || entry.url}</span>
                <span className="trail-detail">
                  {shortUrl(entry.url)} · {formatTime(entry.visitedAt)}
                </span>
              </button>
              <button
                className="icon-button trail-delete"
                title="Remove entry"
                onClick={() => void invoke('trail:delete', spaceId, side, index)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
        {trail.length > 0 && (
          <>
            <div className="flyout-separator" />
            <button
              className="flyout-item"
              onClick={() => {
                onClose();
                void invoke('trail:clear', spaceId, side);
              }}
            >
              <span className="flyout-item-text">Clear trail</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
