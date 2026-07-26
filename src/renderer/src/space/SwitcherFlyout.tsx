import { useEffect, useState } from 'react';
import type { SwitcherSpaceDto } from '@shared/space-types';
import { invoke } from '../ipc';
import { useOverlay } from './overlay';
import { CheckIcon, WindowIcon, SettingsIcon } from '../components/Icons';

/**
 * The space switcher flyout (bottom-left of the left section): all spaces —
 * checkmark = this window, window marker = open elsewhere — plus
 * "Manage spaces…". Rebuilt per open so names/order/open-state are current.
 */
export function SwitcherFlyout({
  spaceId,
  onClose
}: {
  spaceId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [spaces, setSpaces] = useState<SwitcherSpaceDto[]>([]);
  const overlay = useOverlay();

  useEffect(() => {
    overlay.acquire();
    void invoke<SwitcherSpaceDto[]>('switcher:list', spaceId).then(setSpaces);
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
    <div className="overlay" onMouseDown={onClose}>
      <div className="flyout switcher-flyout" onMouseDown={(e) => e.stopPropagation()}>
        {spaces.map((s) => (
          <button
            key={s.id}
            className="flyout-item"
            onClick={() => {
              onClose();
              void invoke('switcher:open', spaceId, s.id);
            }}
          >
            <span className="flyout-item-glyph">
              {s.isCurrent ? <CheckIcon /> : s.isOpen ? <WindowIcon /> : null}
            </span>
            <span className="flyout-item-text">{s.name}</span>
          </button>
        ))}
        <div className="flyout-separator" />
        <button
          className="flyout-item"
          onClick={() => {
            onClose();
            void invoke('manager:open');
          }}
        >
          <span className="flyout-item-glyph">
            <SettingsIcon />
          </span>
          <span className="flyout-item-text">Manage spaces…</span>
        </button>
      </div>
    </div>
  );
}
