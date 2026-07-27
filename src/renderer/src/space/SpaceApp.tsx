import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpaceStateDto, SectionDto } from '@shared/space-types';
import { invoke, on, send } from '../ipc';
import { washVars } from '../wash';
import { OverlayContext, OverlayController } from './overlay';
import { HomeView } from './HomeView';
import { WebChrome } from './WebChrome';
import { ScreenShareDialog, ScreenSharePromptDto } from './ScreenShareDialog';
import { resolveChromeColors } from './colors';
import './space.css';

interface DownloadNotice {
  id: string;
  filename: string;
  state: 'started' | 'completed' | 'failed';
}

interface PermissionPromptDto {
  id: string;
  origin: string;
  permission: string;
  description: string;
}

/**
 * A space window's chrome: title bar, the two sections (home or web chrome),
 * and the split bar. Pure view of the main process's state snapshots.
 */
export function SpaceApp({ windowId: spaceId }: { windowId: string }): React.JSX.Element {
  const [state, setState] = useState<SpaceStateDto | null>(null);
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const overlayCount = useRef(0);

  const overlay = useMemo<OverlayController>(
    () => ({
      acquire: () => {
        if (++overlayCount.current === 1) send('space:overlay', spaceId, true);
      },
      release: () => {
        if (--overlayCount.current === 0) send('space:overlay', spaceId, false);
      }
    }),
    [spaceId]
  );

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
  const leftColors = resolveChromeColors(
    state?.left.mode === 'web' ? state.left.colors : null
  );
  useEffect(() => {
    document.documentElement.style.colorScheme = leftColors
      ? leftColors.dark
        ? 'dark'
        : 'light'
      : '';
    send('space:chromeColors', spaceId, leftColors ? { bg: leftColors.bg, fg: leftColors.fg } : null);
  }, [spaceId, leftColors?.bg, leftColors?.fg, leftColors?.dark]);

  // Download toast (start/done); terminal states linger briefly then clear.
  const [downloads, setDownloads] = useState<DownloadNotice[]>([]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const off = on('space:download', (...args) => {
      const notice = args[0] as DownloadNotice;
      setDownloads((prev) => [...prev.filter((d) => d.id !== notice.id), notice]);
      if (notice.state !== 'started') {
        timers.push(
          setTimeout(
            () => setDownloads((prev) => prev.filter((d) => d.id !== notice.id)),
            4000
          )
        );
      }
    });
    return () => {
      off();
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  // Permission prompts arrive one at a time (serialized in main); each holds
  // the overlay so the dialog paints above the page that asked.
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPromptDto | null>(null);
  useEffect(() => {
    return on('space:permissionPrompt', (...args) => {
      setPermissionPrompt(args[0] as PermissionPromptDto);
    });
  }, []);
  useEffect(() => {
    if (!permissionPrompt) return;
    overlay.acquire();
    return () => overlay.release();
  }, [permissionPrompt, overlay]);

  const answerPermission = (allow: boolean): void => {
    if (!permissionPrompt) return;
    send('permission:respond', spaceId, permissionPrompt.id, allow);
    setPermissionPrompt(null);
  };

  // Screen sharing: main sends the sources it could enumerate (none where the
  // desktop portal picks) and waits for one answer per request.
  const [sharePrompt, setSharePrompt] = useState<ScreenSharePromptDto | null>(null);
  useEffect(() => {
    return on('space:screenSharePrompt', (...args) => {
      setSharePrompt(args[0] as ScreenSharePromptDto);
    });
  }, []);

  const answerScreenShare = (choice: string | null): void => {
    send('screenShare:respond', spaceId, choice);
    setSharePrompt(null);
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
  const title =
    state.left.mode === 'web' && state.left.pageTitle
      ? `${state.name} - ${state.left.pageTitle}`
      : state.name;

  const rootVars = leftColors
    ? ({ '--chrome-bg': leftColors.bg, '--chrome-fg': leftColors.fg } as React.CSSProperties)
    : undefined;

  return (
    <OverlayContext.Provider value={overlay}>
      {/* The space's color scheme feeds the backdrop wash (docs/ui.md). */}
      <div className="space-root" style={washVars(state.colorScheme)}>
        <header
          className={state.left.mode === 'home' ? 'titlebar titlebar-wash' : 'titlebar'}
          style={rootVars}
        >
          <span className="titlebar-title">{title}</span>
          {downloads.length > 0 && (
            <span className="download-pill">
              {downloads[downloads.length - 1].state === 'started'
                ? `Downloading ${downloads[downloads.length - 1].filename}…`
                : downloads[downloads.length - 1].state === 'completed'
                  ? `Downloaded ${downloads[downloads.length - 1].filename}`
                  : `Download failed: ${downloads[downloads.length - 1].filename}`}
            </span>
          )}
        </header>
        <div ref={sectionsRef} className="sections" style={{ gridTemplateColumns: columns }}>
          <SectionPane spaceId={spaceId} state={state} section={state.left} />
          {state.rightOpen && (
            <div className="splitbar" onPointerDown={startSplitDrag}>
              <div className="splitbar-grip" />
            </div>
          )}
          {state.rightOpen && <SectionPane spaceId={spaceId} state={state} section={state.right} />}
        </div>
        {permissionPrompt && (
          <div className="overlay overlay-dim">
            <div className="modal permission-dialog">
              <p>
                <strong>{permissionPrompt.origin}</strong> wants to use {permissionPrompt.description}.
              </p>
              <div className="modal-buttons">
                <button className="button primary" onClick={() => answerPermission(true)}>
                  Allow
                </button>
                <button className="button" onClick={() => answerPermission(false)}>
                  Block
                </button>
              </div>
            </div>
          </div>
        )}
        {sharePrompt && <ScreenShareDialog prompt={sharePrompt} onAnswer={answerScreenShare} />}
      </div>
    </OverlayContext.Provider>
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
  const resolved = section.mode === 'web' ? resolveChromeColors(section.colors) : null;
  const colorVars = resolved
    ? ({ '--chrome-bg': resolved.bg, '--chrome-fg': resolved.fg } as React.CSSProperties)
    : undefined;

  return (
    <div className="section" style={colorVars}>
      {section.mode === 'home' ? (
        <HomeView spaceId={spaceId} section={section} links={state.links} />
      ) : (
        <WebChrome
          spaceId={spaceId}
          section={section}
          rightOpen={state.rightOpen}
          extensions={state.extensions}
          toolbarPosition={state.toolbarPosition}
          layoutKey={`${state.splitRatio}:${section.showAddressBar}:${state.rightOpen}:${state.toolbarPosition}`}
        />
      )}
    </div>
  );
}
