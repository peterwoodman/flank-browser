/// <reference lib="dom" />
import { ipcRenderer } from 'electron';

/**
 * Instrumentation for web content views (docs/behaviors.md, docs/ui.md).
 * Runs before page scripts in every browsed page. Messages go to the main
 * process, which routes them to the owning view by sender.
 */

function post(message: string): void {
  ipcRenderer.send('flank:content', message);
}

// Form submissions must stay in the pinned left view (POST data cannot be
// transplanted to another view); navigations shortly after one stay in place.
document.addEventListener('submit', () => post('formsubmit'), true);

// The engine exposes no "user initiated" flag on navigation events, so the
// page reports input gestures and the host treats a navigation right after
// one as user-initiated
// (docs/behaviors.md → Navigation routing).
window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button === 0) post('gesture');
  },
  true
);
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter') post('gesture');
  },
  true
);

window.addEventListener(
  'keydown',
  (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      post('back');
      return;
    }
    // Shift+Left/Right nudge the splitter (docs/ui.md). Skip while editing
    // or with an active selection so shift+arrow text selection still works.
    if (
      e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      const el = document.activeElement as HTMLElement | null;
      const editable =
        el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      const sel = window.getSelection && window.getSelection();
      if (editable || (sel && !sel.isCollapsed)) return;
      e.preventDefault();
      post(e.key === 'ArrowLeft' ? 'split:left' : 'split:right');
    }
  },
  true
);

// Shift+click flips the target section (docs/behaviors.md). The engine's
// native shift+click would open a new OS window and navigation events carry
// no modifier state, so the click is intercepted here and the host routes
// the URL itself.
window.addEventListener(
  'click',
  (e) => {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.button !== 0) return;
    const path = (e.composedPath ? e.composedPath() : [e.target]) as Array<EventTarget | null>;
    const link = path.find(
      (n): n is HTMLAnchorElement =>
        !!n && (n as HTMLElement).tagName === 'A' && !!(n as HTMLAnchorElement).href
    );
    if (!link || !/^https?:/i.test(link.href)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    post('shiftnav:' + link.href);
  },
  true
);

// Adaptive chrome colors (docs/ui.md): the toolbar and address bar mirror the
// page. A page's colors settle asynchronously (dark stylesheets loading,
// SPAs swapping theme-color), so sampling once at load raced — the page
// reports whenever its colors change instead; all panes converge on the
// same settled value. Deduped so unchanged states cost nothing.
(() => {
  let lastColors = '';
  const report = (): void => {
    try {
      const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      const themeColor = meta && meta.content ? meta.content : '';
      const body = document.body ? getComputedStyle(document.body) : null;
      const root = getComputedStyle(document.documentElement);
      let bg = body ? body.backgroundColor : '';
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = root.backgroundColor;
      const payload = JSON.stringify({ meta: themeColor, bg, fg: body ? body.color : root.color });
      if (payload === lastColors) return;
      lastColors = payload;
      post('colors:' + payload);
    } catch {
      /* cosmetic only */
    }
  };
  let colorTimer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(colorTimer);
    colorTimer = setTimeout(report, 100);
  };
  const start = (): void => {
    report();
    const obs = new MutationObserver(schedule);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    // theme-color <meta> lives in <head> and is often added/updated late.
    obs.observe(document.head || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['content']
    });
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
    } catch {
      /* older engines */
    }
    addEventListener('load', schedule, { once: true });
    // External CSS can repaint without any DOM mutation; nudge a couple times.
    setTimeout(schedule, 600);
    setTimeout(schedule, 2000);
  };
  if (document.body) start();
  else addEventListener('DOMContentLoaded', start, { once: true });
})();

// Ctrl+scroll zoom (docs/ui.md → keyboard/pointer): the engine doesn't wire
// it by default; Ctrl+± and pinch are handled host-side.
window.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    post(e.deltaY < 0 ? 'zoom:in' : 'zoom:out');
  },
  { passive: false, capture: true }
);

// Load indicator (docs/ui.md): some navigations never report completion
// (downloads, streamed responses); the page also reports when its DOM is
// ready and when it finishes loading, so the host clears the bar on the
// first signal.
addEventListener('DOMContentLoaded', () => post('loaded'), { once: true });
addEventListener('load', () => post('loaded'), { once: true });
