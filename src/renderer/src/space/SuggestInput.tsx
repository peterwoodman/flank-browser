import { useEffect, useRef, useState } from 'react';
import type { SuggestionDto } from '@shared/space-types';
import { invoke } from '../ipc';
import { useOverlay } from './overlay';
import { SearchIcon, PinIcon, HistoryIcon } from '../components/Icons';

/**
 * A search/address box with the suggestion dropdown (docs/behaviors.md →
 * Search suggestions): local matches first, engine completions below,
 * debounced ~200 ms, newest query wins, 8 rows max.
 */
export function SuggestInput({
  windowId,
  side,
  includeTrail,
  value,
  placeholder,
  clearOnSubmit,
  raiseOverlay,
  autoFocus,
  onSubmit
}: {
  windowId: string;
  side: 'left' | 'right';
  includeTrail: boolean;
  /** Text the box shows when not focused (e.g. the current URL). */
  value?: string;
  placeholder?: string;
  clearOnSubmit?: boolean;
  /** Raise the chrome while the dropdown is open (needed over web content). */
  raiseOverlay?: boolean;
  /** Takes the keyboard on mount, so the space menu can be typed into at once. */
  autoFocus?: boolean;
  onSubmit: (text: string, suggestion: SuggestionDto | null) => void;
}): React.JSX.Element {
  const [text, setText] = useState(value ?? '');
  const [items, setItems] = useState<SuggestionDto[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [focused, setFocused] = useState(false);
  const versionRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlay = useOverlay();

  // The text follows navigation unless the box is focused.
  useEffect(() => {
    if (!focused) setText(value ?? '');
  }, [value, focused]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!raiseOverlay || !open) return;
    overlay.acquire();
    return () => overlay.release();
  }, [open, raiseOverlay, overlay]);

  const close = (): void => {
    versionRef.current++;
    setOpen(false);
    setItems([]);
    setSelected(-1);
  };

  const queryChanged = (next: string): void => {
    setText(next);
    // Debounce: only the newest pending query populates the dropdown.
    const version = ++versionRef.current;
    if (!next.trim()) {
      setOpen(false);
      setItems([]);
      return;
    }
    setTimeout(async () => {
      if (version !== versionRef.current) return;
      const results = await invoke<SuggestionDto[]>(
        'suggest:query',
        windowId,
        side,
        next,
        includeTrail
      );
      if (version !== versionRef.current) return;
      setItems(results);
      setSelected(-1);
      setOpen(results.length > 0);
    }, 200);
  };

  const submit = (suggestion: SuggestionDto | null): void => {
    const query = suggestion ? suggestion.text : text;
    if (!suggestion && !query.trim()) return;
    close();
    if (clearOnSubmit) setText('');
    else inputRef.current?.blur();
    onSubmit(query, suggestion);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' && items.length > 0) {
      e.preventDefault();
      setSelected((s) => (s + 1) % items.length);
      setOpen(true);
    } else if (e.key === 'ArrowUp' && items.length > 0) {
      e.preventDefault();
      setSelected((s) => (s <= 0 ? items.length - 1 : s - 1));
    } else if (e.key === 'Enter') {
      submit(selected >= 0 ? items[selected] : null);
    } else if (e.key === 'Escape') {
      // Dismiss the dropdown first; only a second Escape reaches whatever the
      // box sits in (the space menu closes on it).
      if (open) e.stopPropagation();
      close();
    }
  };

  return (
    <div className="suggest-box">
      <input
        ref={inputRef}
        className="text-input suggest-input"
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => queryChanged(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          // Let a click on a dropdown row land before closing.
          setTimeout(close, 150);
        }}
      />
      {open && (
        <div className="suggest-dropdown">
          {items.map((item, i) => (
            <button
              key={`${item.kind}:${item.text}:${item.url ?? ''}`}
              className={`suggest-row${i === selected ? ' selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(item);
              }}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="suggest-glyph">
                {item.kind === 'link' ? <PinIcon /> : item.kind === 'trail' ? <HistoryIcon /> : <SearchIcon />}
              </span>
              <span className="suggest-text">
                <span className="suggest-title">{item.text}</span>
                {item.detail && <span className="suggest-detail">{item.detail}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
