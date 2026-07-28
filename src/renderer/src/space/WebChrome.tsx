import { useEffect, useRef, useState } from 'react';
import type { ExtensionButtonDto, SectionDto, Side, SuggestionDto } from '@shared/space-types';
import type { ToolbarPosition } from '@shared/types';
import { invoke, on, send } from '../ipc';
import { SuggestInput } from './SuggestInput';
import { FindBar } from './FindBar';
import { TrailFlyout } from './TrailFlyout';
import {
  BackIcon,
  CloseIcon,
  GridIcon,
  HomeIcon,
  OneShotIcon,
  OpenRightIcon,
  PinIcon,
  PromoteIcon,
  PuzzleIcon,
  RefreshIcon,
  TrailIcon
} from '../components/Icons';

/**
 * Which window this chrome is a pane of. A space window's pane can reach the
 * things a space has — home, the other section, pinning, the Manager — where a
 * 1-shot window's pane is only ever the page it is on (docs/ui.md).
 */
export type WebChromeKind = 'space' | 'oneshot';

/**
 * A web view's chrome (docs/ui.md → Web view): the icon toolbar (down the
 * section's left edge, or across its top — a setting), the contextual address
 * bar, and the content hole the browser view is positioned into by the main
 * process. Splash/crash overlays paint in the hole while the view itself is
 * hidden.
 */
export function WebChrome({
  windowId,
  kind = 'space',
  section,
  rightOpen,
  extensions,
  toolbarPosition,
  layoutKey
}: {
  windowId: string;
  kind?: WebChromeKind;
  section: SectionDto;
  rightOpen: boolean;
  extensions: ExtensionButtonDto[];
  toolbarPosition: ToolbarPosition;
  layoutKey: string;
}): React.JSX.Element {
  const side = section.side;
  const inSpace = kind === 'space';
  const holeRef = useRef<HTMLDivElement>(null);
  const [trailOpen, setTrailOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  // Ctrl+F in the page arrives from the main process (the shortcut lands in
  // the focused content view, not the chrome).
  useEffect(() => {
    return on('space:openFind', (...args) => {
      if ((args[0] as Side) === side) setFindOpen(true);
    });
  }, [side]);

  // Report where the browser view belongs; re-report on any layout-affecting
  // change (split ratio, address bar visibility, window size via RO).
  useEffect(() => {
    const el = holeRef.current;
    if (!el) return;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      send('space:layout', windowId, side, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      send('space:layout', windowId, side, null);
    };
  }, [windowId, side, layoutKey]);

  const addressSubmit = (text: string, suggestion: SuggestionDto | null): void => {
    void invoke('section:addressSubmit', windowId, side, text, suggestion?.url ?? null);
  };

  return (
    <div className={toolbarPosition === 'top' ? 'web-chrome toolbar-top' : 'web-chrome'}>
      <div className="toolbar">
        {inSpace && side === 'left' && !rightOpen && (
          <button
            className="icon-button"
            title="Open right view"
            onClick={() => void invoke('section:openRight', windowId)}
          >
            <OpenRightIcon />
          </button>
        )}
        {side === 'right' && (
          <button
            className="icon-button"
            title="Close view"
            onClick={() => void invoke('section:closeRight', windowId)}
          >
            <CloseIcon />
          </button>
        )}
        {side === 'right' && (
          <button
            className="icon-button"
            title="Move page to left"
            onClick={() => void invoke('section:promote', windowId)}
          >
            <PromoteIcon />
          </button>
        )}
        {section.canGoBack && (
          <button
            className="icon-button"
            title="Back"
            onClick={() => void invoke('section:back', windowId, side)}
          >
            <BackIcon />
          </button>
        )}
        {inSpace && (
          <button
            className="icon-button"
            title="Home"
            onClick={() => void invoke('section:goHome', windowId, side)}
          >
            <HomeIcon />
          </button>
        )}
        <button
          className="icon-button"
          title="Refresh"
          onClick={() => void invoke('section:refresh', windowId, side)}
        >
          <RefreshIcon />
        </button>
        {section.trail.length > 1 && (
          <button className="icon-button" title="Trail" onClick={() => setTrailOpen(true)}>
            <TrailIcon />
          </button>
        )}
        {extensions.length > 0 && <div className="toolbar-separator" />}
        {extensions.map((ext) => (
          <button
            key={ext.id}
            className="icon-button ext-button"
            title={ext.name}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              void invoke('ext:activate', windowId, side, ext.id, {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height)
              });
            }}
          >
            {ext.icon ? <img className="ext-icon" src={ext.icon} alt="" /> : <PuzzleIcon />}
          </button>
        ))}
        <div className="toolbar-spacer" />
        {inSpace && side === 'left' && (
          <>
            <button
              className="icon-button"
              title="1-shot window"
              onClick={() => void invoke('oneshot:open', windowId)}
            >
              <OneShotIcon />
            </button>
            <button
              className="icon-button"
              title="Spaces"
              onClick={() => void invoke('manager:open')}
            >
              <GridIcon />
            </button>
          </>
        )}
      </div>

      <div className="web-main">
        {section.showAddressBar && (
          <div className="topbar">
            <SuggestInput
              windowId={windowId}
              side={side}
              includeTrail
              value={section.url}
              placeholder="Search or enter address"
              raiseOverlay
              onSubmit={addressSubmit}
            />
            {inSpace && (
              <button
                className="icon-button"
                title="Pin to home"
                onClick={() => void invoke('section:pin', windowId, side)}
              >
                <PinIcon />
              </button>
            )}
          </div>
        )}

        {findOpen && <FindBar windowId={windowId} side={side} onClose={() => setFindOpen(false)} />}

        <div className="loadbar-lane">{section.loading && <div className="loadbar" />}</div>

        <div ref={holeRef} className="content-hole">
          {section.splash && (
            <div
              className="splash"
              style={section.splash.background ? { background: section.splash.background } : undefined}
            >
              {section.splash.icon && <img src={section.splash.icon} alt="" />}
              <span>{section.splash.title}</span>
            </div>
          )}
          {section.crashed && (
            <div className="crash-panel">
              <span>This page crashed.</span>
              <button
                className="button"
                onClick={() => void invoke('section:refresh', windowId, side)}
              >
                Reload
              </button>
            </div>
          )}
        </div>
      </div>

      {trailOpen && (
        <TrailFlyout
          windowId={windowId}
          side={side}
          trail={section.trail}
          onClose={() => setTrailOpen(false)}
        />
      )}
    </div>
  );
}
