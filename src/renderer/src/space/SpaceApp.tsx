import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceStateDto, SectionDto } from '@shared/space-types';
import { invoke, on, send } from '../ipc';
import { washVars } from '../wash';
import { useOverlayController } from './overlay';
import { WindowShell } from './WindowShell';
import { WebChrome } from './WebChrome';
import { RouteChoice, RouteChoiceAnswer, RoutePromptDto } from './RouteChoice';
import { resolveChromeColors } from './colors';
import './space.css';

/**
 * A space window's chrome: title bar, the two sections, and the split bar.
 * Pure view of the main process's state snapshots.
 */
export function SpaceApp({ windowId: spaceId }: { windowId: string }): React.JSX.Element {
  const [state, setState] = useState<SpaceStateDto | null>(null);
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const overlay = useOverlayController(spaceId);

  useEffect(() => {
    const off = on('space:state', (dto) => setState(dto as SpaceStateDto));
    void invoke<SpaceStateDto | null>('space:init', spaceId).then((s) => {
      if (s) setState((prev) => prev ?? s);
    });
    return off;
  }, [spaceId]);

  // Window theme follows the left section's active page (docs/ui.md →
  // Adaptive chrome): dark/light for the chrome's own controls, and the
  // resolved colors go to main to tint the native caption buttons.
  const leftColors = resolveChromeColors(state?.left.hasPage ? state.left.colors : null);
  useEffect(() => {
    document.documentElement.style.colorScheme = leftColors
      ? leftColors.dark
        ? 'dark'
        : 'light'
      : '';
    send('space:chromeColors', spaceId, leftColors ? { bg: leftColors.bg, fg: leftColors.fg } : null);
  }, [spaceId, leftColors?.bg, leftColors?.fg, leftColors?.dark]);

  // Where a link should open, asked when one would open the right section
  // (docs/behaviors.md → Which section, when it isn't obvious). One at a time:
  // main asks again rather than queueing.
  const [routePrompt, setRoutePrompt] = useState<RoutePromptDto | null>(null);
  useEffect(() => {
    return on('space:routePrompt', (...args) => setRoutePrompt(args[0] as RoutePromptDto));
  }, []);

  const answerRoute = (choice: RouteChoiceAnswer): void => {
    if (!routePrompt) return;
    send('route:respond', spaceId, routePrompt.id, choice);
    setRoutePrompt(null);
  };

  // Shift+Left/Right nudge the splitter when the chrome holds focus (the
  // content preload covers the web views). Skipped while editing text or
  // with an active selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      e.preventDefault();
      void invoke('split:nudge', spaceId, e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spaceId]);

  const startSplitDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const bar = e.currentTarget;
      const sections = sectionsRef.current;
      if (!sections) return;
      bar.setPointerCapture(e.pointerId);
      overlay.acquire();
      let ratio = state?.splitRatio ?? 0.5;

      const onMove = (ev: PointerEvent): void => {
        const rect = sections.getBoundingClientRect();
        if (rect.width <= 0) return;
        ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.x) / rect.width));
        setLiveRatio(ratio);
      };
      const onUp = (): void => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onUp);
        overlay.release();
        setLiveRatio(null);
        void invoke('split:set', spaceId, ratio);
      };
      bar.addEventListener('pointermove', onMove);
      bar.addEventListener('pointerup', onUp);
    },
    [overlay, spaceId, state?.splitRatio]
  );

  if (!state) return <div />;

  const ratio = liveRatio ?? state.splitRatio;
  const columns = state.rightOpen
    ? `minmax(200px, ${ratio}fr) 6px minmax(200px, ${1 - ratio}fr)`
    : 'minmax(0, 1fr)';
  const title = state.left.pageTitle ? `${state.name} - ${state.left.pageTitle}` : state.name;

  return (
    <WindowShell
      windowId={spaceId}
      overlay={overlay}
      title={title}
      // The title bar joins the backdrop wash while the left section holds no
      // page, and wears the page's adaptive color with one there.
      titlebarClassName={state.left.hasPage ? 'titlebar' : 'titlebar titlebar-wash'}
      titlebarStyle={
        leftColors
          ? ({ '--chrome-bg': leftColors.bg, '--chrome-fg': leftColors.fg } as React.CSSProperties)
          : undefined
      }
      /* The space's color scheme feeds the backdrop wash (docs/ui.md). */
      rootStyle={washVars(state.colorScheme)}
    >
      <div ref={sectionsRef} className="sections" style={{ gridTemplateColumns: columns }}>
        <SectionPane spaceId={spaceId} state={state} section={state.left} />
        {state.rightOpen && (
          <div className="splitbar" onPointerDown={startSplitDrag}>
            <div className="splitbar-grip" />
          </div>
        )}
        {state.rightOpen && <SectionPane spaceId={spaceId} state={state} section={state.right} />}
      </div>
      {routePrompt && <RouteChoice prompt={routePrompt} onAnswer={answerRoute} />}
    </WindowShell>
  );
}

function SectionPane({
  spaceId,
  state,
  section
}: {
  spaceId: string;
  state: SpaceStateDto;
  section: SectionDto;
}): React.JSX.Element {
  const resolved = section.hasPage ? resolveChromeColors(section.colors) : null;
  const colorVars = resolved
    ? ({ '--chrome-bg': resolved.bg, '--chrome-fg': resolved.fg } as React.CSSProperties)
    : undefined;

  return (
    <div className="section" style={colorVars}>
      <WebChrome
        windowId={spaceId}
        section={section}
        rightOpen={state.rightOpen}
        links={state.links}
        extensions={state.extensions}
        toolbarPosition={state.toolbarPosition}
        layoutKey={`${state.splitRatio}:${section.showAddressBar}:${state.rightOpen}:${state.toolbarPosition}`}
      />
    </div>
  );
}
