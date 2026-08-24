import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceLink } from '@shared/types';
import type {
  ExtensionButtonDto,
  LoadErrorDto,
  SectionDto,
  Side,
  SuggestionDto
} from '@shared/space-types';
import type { ToolbarPosition } from '@shared/types';
import { invoke, on, send } from '../ipc';
import { SuggestInput } from './SuggestInput';
import { FindBar } from './FindBar';
import { TrailFlyout } from './TrailFlyout';
import { SpaceMenu } from './SpaceMenu';
import {
  AddressBarIcon,
  BackIcon,
  CloseIcon,
  GridIcon,
  MenuIcon,
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
 * things a space has — the menu, the other section, pinning, the Manager —
 * where a 1-shot window's pane is only ever the page it is on (docs/ui.md).
 */
export type WebChromeKind = 'space' | 'oneshot';

/**
 * A section's chrome (docs/ui.md → Space window): the icon toolbar (down the
 * section's left edge, or across its top — a setting), the contextual address
 * bar, and the content hole the browser view is positioned into by the main
 * process. Splash/crash overlays paint in the hole while the view itself is
 * hidden; with no page at all the hole carries the backdrop instead.
 */
export function WebChrome({
  windowId,
  kind = 'space',
  section,
  rightOpen,
  links = [],
  extensions,
  toolbarPosition,
  layoutKey
}: {
  windowId: string;
  kind?: WebChromeKind;
  section: SectionDto;
  rightOpen: boolean;
  /** The space's pinned links, for the menu; a 1-shot window has none. */
  links?: SpaceLink[];
  extensions: ExtensionButtonDto[];
  toolbarPosition: ToolbarPosition;
  layoutKey: string;
}): React.JSX.Element {
  const side = section.side;
  const inSpace = kind === 'space';
  const hasPage = section.hasPage;
  const holeRef = useRef<HTMLDivElement>(null);
  const [trailOpen, setTrailOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // A section with no page has nothing to show but the menu, so it opens
  // itself; a page arriving closes it. In between it is dismissable like any
  // flyout — the empty backdrop is a legitimate thing to be looking at.
  useEffect(() => {
    setMenuOpen(!hasPage);
  }, [hasPage]);

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

  const classes = ['web-chrome'];
  if (toolbarPosition === 'top') classes.push('toolbar-top');
  if (!hasPage) classes.push('empty');

  return (
    <div className={classes.join(' ')}>
      <div className="toolbar">
        {inSpace && (
          <button
            className="icon-button"
            title="Space menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
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
        {side === 'right' && hasPage && (
          <button
            className="icon-button"
            title="Un-Flank"
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
        {hasPage && (
          <button
            className="icon-button"
            title="Refresh"
            onClick={() => void invoke('section:refresh', windowId, side)}
          >
            <RefreshIcon />
          </button>
        )}
        {inSpace && hasPage && (
          <button
            className="icon-button"
            title={section.showAddressBar ? 'Hide address bar' : 'Show address bar'}
            onClick={() => void invoke('section:toggleAddressBar', windowId, side)}
          >
            <AddressBarIcon />
          </button>
        )}
        {section.trail.length > 1 && (
          <button className="icon-button" title="Trail" onClick={() => setTrailOpen(true)}>
            <TrailIcon />
          </button>
        )}
       {inSpace && side === 'left' && !rightOpen && (
          <button
            className="icon-button"
            title="Flank"
            onClick={() => void invoke('section:openRight', windowId)}
          >
            <OpenRightIcon />
          </button>
        )}
        {hasPage && extensions.length > 0 && <div className="toolbar-separator" />}
        {hasPage &&
          extensions.map((ext) => (
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
            {inSpace && section.showPinButton && (
              <button
                className="icon-button"
                title="Pin to menu"
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
          {/* No page here: the backdrop takes the hole, with the menu over it. */}
          {!hasPage && <div className="section-empty" />}
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
          {section.unresponsive && !section.crashed && (
            <div className="page-panel">
              <span className="page-panel-title">This page is not responding</span>
              <p>
                <b>{hostOf(section.url)}</b> has stopped answering. It may finish what it is doing
                if you give it longer.
              </p>
              <div className="page-panel-buttons">
                <button
                  className="button"
                  onClick={() => void invoke('section:keepWaiting', windowId, side)}
                >
                  Wait
                </button>
                <button
                  className="button danger"
                  onClick={() => void invoke('section:killPage', windowId, side)}
                >
                  End page
                </button>
              </div>
            </div>
          )}
          {section.loadError && !section.crashed && !section.unresponsive && (
            <div className="page-panel">
              <span className="page-panel-title">
                {section.loadError.certificate
                  ? 'This connection is not private'
                  : 'This page could not be opened'}
              </span>
              <p>{describeLoadError(section.loadError)}</p>
              <div className="page-panel-buttons">
                {section.loadError.certificate ? (
                  <button
                    className="button"
                    onClick={() => void invoke('section:proceedCert', windowId, side)}
                  >
                    Continue anyway
                  </button>
                ) : (
                  <button
                    className="button"
                    onClick={() => void invoke('section:refresh', windowId, side)}
                  >
                    Try again
                  </button>
                )}
              </div>
              {section.loadError.certificate && (
                <span className="page-panel-note">
                  This host stays trusted until Flank quits. Only continue somewhere you know.
                </span>
              )}
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

      {inSpace && menuOpen && (
        <SpaceMenu spaceId={windowId} side={side} links={links} onClose={closeMenu} />
      )}
    </div>
  );
}

/** Puts the engine's error code for a failed navigation into plain words. */
function describeLoadError(error: LoadErrorDto): string {
  if (error.certificate) {
    return `The certificate ${error.host} presented ${certReason(error.code)}, so Flank cannot tell whether the site is the one it claims to be.`;
  }
  if (error.code === 'ERR_INTERNET_DISCONNECTED') {
    return 'This computer is not connected to a network.';
  }
  return `${error.host} ${reachReason(error.code)}.`;
}

/** The middle of "The certificate example.com presented …". */
function certReason(code: string): string {
  switch (code) {
    case 'ERR_CERT_DATE_INVALID':
      return 'has expired, or is not valid yet';
    case 'ERR_CERT_AUTHORITY_INVALID':
      return 'comes from an authority Flank does not trust, as a self-signed one does';
    case 'ERR_CERT_COMMON_NAME_INVALID':
      return 'was issued for a different address';
    case 'ERR_CERT_REVOKED':
      return 'was withdrawn by the authority that issued it';
    case 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM':
      return 'is signed with an algorithm no longer considered safe';
    case 'ERR_CERT_INVALID':
      return 'could not be read';
    default:
      return `failed the engine check ${code}`;
  }
}

/** The middle of "example.com …". */
function reachReason(code: string): string {
  switch (code) {
    case 'ERR_CONNECTION_REFUSED':
      return 'refused the connection — nothing is listening on that address and port';
    case 'ERR_NAME_NOT_RESOLVED':
      return 'has no address: the name could not be looked up';
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT':
      return 'took too long to answer';
    case 'ERR_CONNECTION_RESET':
    case 'ERR_CONNECTION_CLOSED':
    case 'ERR_CONNECTION_ABORTED':
      return 'closed the connection before answering';
    case 'ERR_EMPTY_RESPONSE':
      return 'answered with nothing at all';
    case 'ERR_ADDRESS_UNREACHABLE':
      return 'could not be reached from this network';
    case 'ERR_SSL_PROTOCOL_ERROR':
    case 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH':
      return 'and Flank could not agree on how to secure the connection';
    case 'ERR_TOO_MANY_REDIRECTS':
      return 'redirected the request round in circles';
    case 'ERR_BLOCKED_BY_CLIENT':
      return 'was blocked by an extension';
    case 'ERR_INVALID_AUTH_CREDENTIALS':
      return 'did not accept the sign-in';
    case 'ERR_NETWORK_CHANGED':
      return 'was interrupted when the network changed';
    default:
      return `could not be reached (${code})`;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'This page';
  }
}
