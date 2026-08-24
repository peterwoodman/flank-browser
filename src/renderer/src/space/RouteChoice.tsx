import { useEffect, useRef, useState } from 'react';
import { useOverlay } from './overlay';

export interface RoutePromptDto {
  id: string;
  /** The pointer that made the click, in window coordinates. */
  x: number;
  y: number;
}

/** `placeAlways` is "in place, and don't ask again for this site". */
export type RouteChoiceAnswer = 'flank' | 'place' | 'placeAlways' | null;

/**
 * Where a link should open, asked at the pointer that clicked it
 * (docs/behaviors.md → Which section, when it isn't obvious). The page behind
 * it says what was clicked, so the question carries no text of its own — only
 * the two answers, and the option to stop being asked for this site.
 *
 * Dismissing — Escape, or a click anywhere else — answers nothing and drops the
 * click, like walking away from a context menu.
 */
export function RouteChoice({
  prompt,
  onAnswer
}: {
  prompt: RoutePromptDto;
  onAnswer: (choice: RouteChoiceAnswer) => void;
}): React.JSX.Element {
  const overlay = useOverlay();
  const ref = useRef<HTMLDivElement>(null);
  // Names the answer it belongs to, so it applies to that one only: opening
  // this link in the flank leaves nothing to remember.
  const [always, setAlways] = useState(false);

  useEffect(() => {
    overlay.acquire(); // the chrome must draw above the page that was clicked
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onAnswer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      overlay.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicks land near an edge often enough: flip rather than overflow.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${Math.max(0, prompt.x - rect.width)}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(0, prompt.y - rect.height)}px`;
  }, [prompt.x, prompt.y]);

  return (
    <>
      <div className="overlay" onMouseDown={() => onAnswer(null)} />
      <div ref={ref} className="flyout route-choice" style={{ left: prompt.x, top: prompt.y }}>
        <button
          className="button primary"
          autoFocus
          title="Open it in the right section, keeping this page where it is"
          onClick={() => onAnswer('flank')}
        >
          Flank
        </button>
        <button
          className="button"
          title="Load it here, leaving the page this section is on"
          onClick={() => onAnswer(always ? 'placeAlways' : 'place')}
        >
          Open In Place
        </button>
        <label
          className="route-choice-always"
          title="Keep this site's links in the section they are clicked in, without asking again"
        >
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
          />
          Always Open in Place
        </label>
      </div>
    </>
  );
}
