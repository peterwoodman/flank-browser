import { useEffect, useState } from 'react';
import type { OneShotStateDto } from '@shared/space-types';
import { invoke, on, send } from '../ipc';
import { useOverlayController } from './overlay';
import { WindowShell } from './WindowShell';
import { WebChrome } from './WebChrome';
import { resolveChromeColors } from './colors';
import './space.css';

const WINDOW_TITLE = '1-shot';

/**
 * A 1-shot window's chrome (docs/ui.md → 1-shot window): one web pane with its
 * address bar, and none of a space's furniture around it.
 */
export function OneShotApp({ windowId }: { windowId: string }): React.JSX.Element {
  const [state, setState] = useState<OneShotStateDto | null>(null);
  const overlay = useOverlayController(windowId);

  useEffect(() => {
    const off = on('space:state', (dto) => setState(dto as OneShotStateDto));
    void invoke<OneShotStateDto | null>('space:init', windowId).then((s) => {
      if (s) setState((prev) => prev ?? s);
    });
    return off;
  }, [windowId]);

  const colors = resolveChromeColors(state?.pane.colors ?? null);
  useEffect(() => {
    document.documentElement.style.colorScheme = colors ? (colors.dark ? 'dark' : 'light') : '';
    send('space:chromeColors', windowId, colors ? { bg: colors.bg, fg: colors.fg } : null);
  }, [windowId, colors?.bg, colors?.fg, colors?.dark]);

  if (!state) return <div />;

  const colorVars = colors
    ? ({ '--chrome-bg': colors.bg, '--chrome-fg': colors.fg } as React.CSSProperties)
    : undefined;

  return (
    <WindowShell
      windowId={windowId}
      overlay={overlay}
      title={state.pane.pageTitle ? `${WINDOW_TITLE} - ${state.pane.pageTitle}` : WINDOW_TITLE}
      titlebarStyle={colorVars}
    >
      {/* One full-width pane, laid out like a space window with its right
          section closed, so the shared web chrome measures its hole the same. */}
      <div className="sections" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div className="section" style={colorVars}>
          <WebChrome
            windowId={windowId}
            kind="oneshot"
            section={state.pane}
            rightOpen={false}
            extensions={state.extensions}
            toolbarPosition={state.toolbarPosition}
            layoutKey={state.toolbarPosition}
          />
        </div>
      </div>
    </WindowShell>
  );
}
