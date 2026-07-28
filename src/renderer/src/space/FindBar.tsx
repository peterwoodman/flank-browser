import { useEffect, useRef, useState } from 'react';
import type { Side } from '@shared/space-types';
import { on, send } from '../ipc';
import { CloseIcon } from '../components/Icons';

/**
 * Find-in-page bar (Ctrl+F): the engine has the search machinery but no UI.
 * Sits at the top of the section's content area; Enter/Shift+Enter step
 * through matches, Esc closes and clears highlights.
 */
export function FindBar({
  windowId,
  side,
  onClose
}: {
  windowId: string;
  side: Side;
  onClose: () => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ active: number; matches: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    return on('space:findResult', (...args) => {
      const [forSide, active, matches] = args as [Side, number, number];
      if (forSide === side) setResult({ active, matches });
    });
  }, [side]);

  const close = (): void => {
    send('find:stop', windowId, side);
    onClose();
  };

  const query = (value: string): void => {
    setText(value);
    if (value) send('find:query', windowId, side, value, true, false);
    else setResult(null);
  };

  const step = (forward: boolean): void => {
    if (text) send('find:query', windowId, side, text, forward, true);
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="text-input find-input"
        placeholder="Find in page"
        value={text}
        onChange={(e) => query(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step(!e.shiftKey);
          else if (e.key === 'Escape') close();
        }}
      />
      <span className="find-count">
        {text && result ? `${result.matches === 0 ? 0 : result.active}/${result.matches}` : ''}
      </span>
      <button className="icon-button" title="Previous" onClick={() => step(false)}>
        ‹
      </button>
      <button className="icon-button" title="Next" onClick={() => step(true)}>
        ›
      </button>
      <button className="icon-button" title="Close" onClick={close}>
        <CloseIcon />
      </button>
    </div>
  );
}
