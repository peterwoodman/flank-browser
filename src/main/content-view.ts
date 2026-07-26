import { BrowserWindow, WebContentsView, ipcMain } from 'electron';
import { TrailEntry, TRAIL_CAP } from '@shared/types';
import { PageColors, SplashDto } from '@shared/space-types';
import { flankSession } from './browser-session';
import { contentPreloadPath } from './renderer-url';
import { readManifest } from './manifest-info';
import { captureBestFavicon } from './favicons';
import { log, logError, fireAndForget } from './log';

const FORM_SUBMIT_WINDOW_MS = 3000;
const GESTURE_WINDOW_MS = 2500;
const LOADING_WATCHDOG_MS = 20000;

const viewsByWebContentsId = new Map<number, ContentView>();

/** Routes content-preload messages to the owning view. Register once. */
export function registerContentMessageRouting(): void {
  ipcMain.on('flank:content', (event, message: string) => {
    viewsByWebContentsId.get(event.sender.id)?.onContentMessage(String(message));
  });
}

/**
 * One browsed page: a WebContentsView plus Flank's per-view state — trail,
 * page title/colors, load/crash state, and the left view's routing rules
 * (docs/behaviors.md → Navigation routing).
 */
export class ContentView {
  readonly view: WebContentsView;
  readonly isLeft: boolean;

  trail: TrailEntry[] = []; // newest first
  private trailPosition = 0; // index of the currently displayed entry

  pageTitle = '';
  colors: PageColors | null = null;
  splash: SplashDto | null = null;
  loading = false;
  crashed = false;

  private hostNavigationPending = false;
  private suppressTrailAppend = false;
  private lastFormSubmit = 0;
  private lastUserGesture = 0; // last click/Enter reported by the content preload
  private loadingWatchdog: NodeJS.Timeout | null = null;
  private lastFaviconSource: string | null = null; // last URL a favicon was captured for
  /** Favicon URLs the engine reported for the current page, newest event wins. */
  latestFaviconUrls: string[] = [];
  /** Set on left home-link tabs only: live favicons refresh the link's tile icon. */
  capturesFavicons = false;

  /** Any state observed by the chrome changed; owner pushes a fresh snapshot. */
  onChanged: () => void = () => {};
  /** Left view only: a user navigation that leaves the pinned page. */
  onNavigateAway: (url: string) => void = () => {};
  onNewWindow: (url: string) => void = () => {};
  /** The page opened a real popup window (auth flows); owner adopts it. */
  onPopupCreated: (popup: BrowserWindow) => void = () => {};
  /** Shift+click on an in-page link: open in the flipped target section. */
  onFlipNavigation: (url: string) => void = () => {};
  onSplitNudge: (direction: -1 | 1) => void = () => {};
  /** Ctrl+F / F3 pressed while this view is focused; chrome opens the find bar. */
  onFindRequested: () => void = () => {};
  /** findInPage progress for the chrome's find bar. */
  onFoundInPage: (activeMatch: number, matches: number) => void = () => {};
  /** Left home-link tabs: a fresh page favicon was captured (page URL, image bytes). */
  onFaviconCaptured: (pageUrl: string, image: Buffer) => void = () => {};

  constructor(isLeft: boolean) {
    this.isLeft = isLeft;
    this.view = new WebContentsView({
      webPreferences: {
        session: flankSession(),
        preload: contentPreloadPath,
        sandbox: true,
        contextIsolation: true
      }
    });

    const wc = this.view.webContents;
    viewsByWebContentsId.set(wc.id, this);

    // "Open this page somewhere" requests become in-app navigations, routed
    // by the owning section/window (docs/behaviors.md → Navigation routing).
    // A sized popup is not that: sign-in flows hand their result back through
    // the live `window.opener`, so the window has to be real and the opener
    // link intact. Denying one returns null to the page, which auth libraries
    // read as "a popup blocker ate it" and abandon the sign-in.
    wc.setWindowOpenHandler((details) => {
      if (details.disposition === 'new-window') return { action: 'allow' };
      if (/^https?:/i.test(details.url)) this.onNewWindow(details.url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (popup) => this.onPopupCreated(popup));

    if (isLeft) {
      wc.on('will-navigate', (event) => {
        // Only user-initiated jumps to a new document leave the pinned view;
        // script navigations (redirect bounces, SSO hops, SPA boot) are the
        // launched page doing its own thing and stay put (docs/behaviors.md).
        // The engine exposes no user-gesture flag here, so a recent
        // click/Enter reported by the content preload stands in for one.
        // Host navigations don't raise will-navigate; redirects, reloads,
        // and back/forward don't either.
        // hostNavigationPending is a belt-and-braces guard; it is cleared as
        // soon as the host navigation *starts* (below), so a user click made
        // while that navigation is still loading routes normally.
        if (this.hostNavigationPending) return;
        const url = event.url;
        if (!/^https?:/i.test(url)) return;
        if (url === wc.getURL()) return;
        if (Date.now() - this.lastFormSubmit < FORM_SUBMIT_WINDOW_MS) return;
        if (Date.now() - this.lastUserGesture > GESTURE_WINDOW_MS) return;

        event.preventDefault();
        this.setLoading(false);
        this.onNavigateAway(url);
      });
    }

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // The host navigation is underway; from here on, will-navigate events
      // are the user's own and must go through routing.
      this.hostNavigationPending = false;
      this.setLoading(true);
    });

    // Recording at completion collapses redirect chains to the final URL.
    wc.on('did-navigate', (_event, url) => {
      this.hostNavigationPending = false;
      this.setLoading(false);

      if (!url.startsWith('http')) {
        this.suppressTrailAppend = false;
        this.onChanged();
        return;
      }

      this.setPageTitle(wc.getTitle());

      // Left section: the manifest background feeds the home link's splash.
      if (this.isLeft) {
        fireAndForget('launch metadata', this.updateLaunchMetadata(url));
      }

      if (this.suppressTrailAppend) {
        this.suppressTrailAppend = false;
        this.onChanged();
        return;
      }

      if (this.trail.length > 0 && this.trail[0].url === url) {
        this.trail[0].visitedAt = new Date().toISOString(); // consecutive duplicate
      } else {
        this.trail.unshift({ url, title: wc.getTitle(), visitedAt: new Date().toISOString() });
        if (this.trail.length > TRAIL_CAP) this.trail.length = TRAIL_CAP;
      }
      this.trailPosition = 0;
      this.onChanged();
    });

    // Same-document navigation (#fragment, pushState): update the newest
    // entry rather than appending.
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      if (this.trail.length > 0 && url.startsWith('http')) this.trail[0].url = url;
      this.onChanged();
    });

    wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      this.hostNavigationPending = false;
      this.suppressTrailAppend = false;
      this.setLoading(false);
      if (code !== -3) log(`navigation failed: ${description} (${code})`); // -3 = aborted
    });

    wc.on('page-title-updated', (_event, title) => {
      if (this.trail.length > 0 && this.trail[0].url === wc.getURL()) {
        this.trail[0].title = title;
      }
      this.setPageTitle(title);
    });

    wc.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      logError('renderer crashed', new Error(details.reason));
      this.crashed = true;
      this.setLoading(false);
    });

    wc.on('page-favicon-updated', (_event, urls) => {
      this.latestFaviconUrls = urls;
      if (!this.capturesFavicons) return;
      // Once per page: sites with badge favicons (unread counts) re-fire this
      // constantly, and each capture costs a probe + downloads.
      const source = wc.getURL();
      if (source === this.lastFaviconSource || !source.startsWith('http')) return;
      this.lastFaviconSource = source;
      fireAndForget(
        'favicon capture',
        captureBestFavicon(this).then((image) => {
          if (image) this.onFaviconCaptured(source, image);
        })
      );
    });

    wc.on('found-in-page', (_event, result) => {
      this.onFoundInPage(result.activeMatchOrdinal, result.matches);
    });

    // Zoom accelerators (Ctrl+± / Ctrl+0) and the find bar shortcut fire
    // before the page can swallow them. Ctrl+wheel zoom comes from the
    // content preload; pinch zoom is enabled below.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt) return;
      if (input.key === '=' || input.key === '+') {
        this.zoomBy(0.5);
        event.preventDefault();
      } else if (input.key === '-') {
        this.zoomBy(-0.5);
        event.preventDefault();
      } else if (input.key === '0') {
        wc.setZoomLevel(0);
        event.preventDefault();
      } else if (input.key.toLowerCase() === 'f') {
        this.onFindRequested();
        event.preventDefault();
      }
    });

    wc.once('dom-ready', () => {
      fireAndForget('pinch zoom limits', wc.setVisualZoomLevelLimits(1, 3));
    });
  }

  private zoomBy(delta: number): void {
    const level = Math.min(4, Math.max(-3, this.webContents.getZoomLevel() + delta));
    this.webContents.setZoomLevel(level);
  }

  findInPage(text: string, options: { forward: boolean; findNext: boolean }): void {
    if (!text) return;
    this.webContents.findInPage(text, {
      forward: options.forward,
      findNext: options.findNext
    });
  }

  stopFind(): void {
    this.webContents.stopFindInPage('clearSelection');
  }

  get webContents() {
    return this.view.webContents;
  }

  /** The engine's own back stack (reaches SPA route changes the trail collapses). */
  get canGoBack(): boolean {
    return (
      !this.webContents.isDestroyed() &&
      this.webContents.navigationHistory.canGoBack() &&
      this.currentUrl().length > 0
    );
  }

  currentUrl(): string {
    if (this.webContents.isDestroyed()) return '';
    const url = this.webContents.getURL();
    return url.startsWith('http') ? url : '';
  }

  navigate(url: string, options?: { suppressTrail?: boolean }): void {
    this.hostNavigationPending = true;
    this.suppressTrailAppend = options?.suppressTrail ?? false;
    this.crashed = false;
    // ERR_ABORTED (-3) is routine: in-flight redirects and replaced
    // navigations reject the promise without anything being wrong.
    fireAndForget(
      'navigate',
      this.webContents.loadURL(url).catch((err) => {
        if ((err as { errno?: number })?.errno !== -3) throw err;
      })
    );
  }

  /**
   * Unloads the page so a hidden section stops playing media and doing work
   * (hiding alone keeps it alive). The trail is kept.
   */
  park(): void {
    this.pageTitle = '';
    this.colors = null;
    this.splash = null;
    this.navigate('about:blank', { suppressTrail: true });
  }

  /** Releases the underlying browser (evicted tab / closing window). */
  destroy(): void {
    if (this.loadingWatchdog) clearTimeout(this.loadingWatchdog);
    viewsByWebContentsId.delete(this.webContents.id);
    this.webContents.close();
  }

  reload(): void {
    this.crashed = false;
    this.webContents.reload();
    this.onChanged();
  }

  goBackInEngine(): void {
    if (this.canGoBack) this.webContents.navigationHistory.goBack();
  }

  goBackInTrail(): void {
    const target = this.trailPosition + 1;
    if (target >= this.trail.length) return;
    this.trailPosition = target;
    this.navigate(this.trail[target].url, { suppressTrail: true });
  }

  trailNavigate(index: number): void {
    if (index < 0 || index >= this.trail.length) return;
    this.trailPosition = index;
    this.navigate(this.trail[index].url, { suppressTrail: true });
  }

  trailDelete(index: number): void {
    if (index < 0 || index >= this.trail.length) return;
    this.trail.splice(index, 1);
    this.trailPosition = Math.min(this.trailPosition, Math.max(0, this.trail.length - 1));
    this.onChanged();
  }

  trailClear(): void {
    this.trail = [];
    this.trailPosition = 0;
    this.onChanged();
  }

  setTrail(trail: TrailEntry[]): void {
    this.trail = trail;
    this.trailPosition = 0;
  }

  showSplash(splash: SplashDto): void {
    this.splash = splash;
    this.onChanged();
  }

  /** Messages from the content preload (see src/preload/content.ts). */
  onContentMessage(message: string): void {
    if (message.startsWith('shiftnav:')) {
      this.onFlipNavigation(message.slice('shiftnav:'.length));
      return;
    }
    if (message.startsWith('colors:')) {
      this.applyColors(message.slice('colors:'.length));
      return;
    }
    switch (message) {
      case 'formsubmit':
        this.lastFormSubmit = Date.now();
        break;
      case 'gesture':
        this.lastUserGesture = Date.now();
        break;
      case 'back':
        this.goBackInTrail();
        break;
      case 'split:left':
        this.onSplitNudge(-1);
        break;
      case 'split:right':
        this.onSplitNudge(1);
        break;
      case 'loaded':
        this.setLoading(false);
        break;
      case 'zoom:in':
        this.zoomBy(0.5);
        break;
      case 'zoom:out':
        this.zoomBy(-0.5);
        break;
    }
  }

  private applyColors(json: string): void {
    try {
      const parsed = JSON.parse(json) as { meta?: string; bg?: string; fg?: string };
      // theme-color is the site's intended chrome color; fall back to the
      // computed page background. Contrast adjustment happens in the chrome
      // renderer, which has CSS color parsing for free.
      const bg = parsed.meta || parsed.bg || '';
      const fg = parsed.fg || '';
      if (!bg) return;
      this.colors = { bg, fg };

      // Chromium colors scrollbars/form controls from the page's color-scheme;
      // pages that don't declare one get ours injected (docs/ui.md). Dark
      // detection also happens page-side to keep color math in one place.
      fireAndForget(
        'color-scheme inject',
        this.webContents.executeJavaScript(
          `(() => {
            if (getComputedStyle(document.documentElement).colorScheme !== 'normal') return;
            const probe = document.createElement('div');
            probe.style.color = ${JSON.stringify(bg)};
            document.documentElement.appendChild(probe);
            const rgb = getComputedStyle(probe).color.match(/\\d+(\\.\\d+)?/g);
            probe.remove();
            if (!rgb) return;
            const [r, g, b] = rgb.map(Number);
            const dark = (r * 299 + g * 587 + b * 114) / 1000 < 128;
            document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
          })()`,
          false
        )
      );

      this.onChanged();
    } catch {
      // Color handling is cosmetic; never let it break navigation.
    }
  }

  private setPageTitle(title: string): void {
    const resolved = (title ?? '').trim();
    if (resolved === this.pageTitle) return;
    this.pageTitle = resolved;
    this.onChanged();
  }

  /**
   * Load bar with a watchdog: some navigations miss every completion signal
   * (e.g. documents that stream forever), so the bar can never spin
   * indefinitely (docs/ui.md). Clearing also reveals the page under a splash.
   */
  setLoading(loading: boolean): void {
    if (this.loadingWatchdog) {
      clearTimeout(this.loadingWatchdog);
      this.loadingWatchdog = null;
    }
    if (loading) {
      this.loadingWatchdog = setTimeout(() => this.setLoading(false), LOADING_WATCHDOG_MS);
    } else {
      this.splash = null; // page is ready — reveal it
    }
    if (this.loading === loading) return;
    this.loading = loading;
    this.onChanged();
  }

  /** Left section: after a page settles, capture the app's manifest
   * background color for the home link's launch splash. */
  private async updateLaunchMetadata(pageUrl: string): Promise<void> {
    const manifest = await readManifest(this.webContents);
    if (manifest.backgroundColor) this.onAppBackground(pageUrl, manifest.backgroundColor);
  }

  /** Left section, home-link tabs: manifest background captured for the splash. */
  onAppBackground: (pageUrl: string, cssColor: string) => void = () => {};
}
