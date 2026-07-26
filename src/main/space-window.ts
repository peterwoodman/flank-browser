import {
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  Menu,
  MenuItemConstructorOptions,
  clipboard,
  nativeTheme
} from 'electron';
import { Space, SessionFile } from '@shared/types';
import { PageColors, Rect, Side, SectionDto, SpaceStateDto } from '@shared/space-types';
import { Section } from './section';
import { ContentView } from './content-view';
import { spacesStore } from './stores/spaces-store';
import { settingsStore } from './stores/settings-store';
import { loadSession, saveSession } from './stores/session-store';
import { applyRestoredPosition, capturePlacement, windowOptionsFrom } from './placement';
import { chromePreloadPath, loadChromeRoute } from './renderer-url';
import { titleBarOverlayColors, windowIcon } from './manager-window';
import { readManifest } from './manifest-info';
import { newId } from './ids';
import { storeIcon, captureBestFavicon, ensureSpaceIcons } from './favicons';
import { fireAndForget, log } from './log';
import { PermissionPrompt } from './permissions';
import { ScreenSharePrompt } from './screen-share';
import {
  extensionButtons,
  extensionActivation,
  extensionsAddTab,
  extensionsSelectTab
} from './extensions';
import { ExtensionPopup } from './extension-popup';

const SPLIT_STEP = 0.05;
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;
const AUTOSAVE_MS = 30_000;

/**
 * One window per space: a BaseWindow holding a full-window chrome view (the
 * React app rendering title bar, toolbars, home views, and flyouts) plus the
 * pooled content views for browsed pages, positioned into the holes the
 * chrome reports. Content views stack above the chrome; opening a flyout
 * raises the chrome to the top (transparent, light-dismiss) and closing it
 * lowers it back.
 */
export class SpaceWindowController {
  readonly space: Space;
  readonly win: BaseWindow;
  private readonly chromeView: WebContentsView;
  private readonly left: Section;
  private readonly right: Section;
  private rightOpen = false;
  private layoutRects: Record<Side, Rect | null> = { left: null, right: null };
  private readonly attached = new Set<ContentView>();
  private overlayActive = false;
  private pushQueued = false;
  private autosaveTimer: NodeJS.Timeout;
  private chromeReady = false;
  private readonly permissionResolvers = new Map<string, (allow: boolean) => void>();
  private screenShareResolver: ((choice: string | null) => void) | null = null;
  private extensionPopup: ExtensionPopup | null = null;

  onClosed: () => void = () => {};

  constructor(space: Space) {
    this.space = space;

    const opts = windowOptionsFrom(space.window, { width: 1400, height: 900 });
    this.win = new BaseWindow({
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      minWidth: 600,
      minHeight: 400,
      show: false,
      icon: windowIcon,
      title: space.name,
      titleBarStyle: 'hidden',
      ...(process.platform !== 'darwin' ? { titleBarOverlay: titleBarOverlayColors() } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3'
    });
    applyRestoredPosition(this.win, opts);

    this.chromeView = new WebContentsView({
      webPreferences: { preload: chromePreloadPath }
    });
    // Transparent so that, when raised above the pages for a flyout, only the
    // flyout itself paints; the window's backgroundColor is the normal base.
    this.chromeView.setBackgroundColor('#00000000');
    // Loads reset a view's background to the engine default (white/dark), so
    // re-apply after every load or the raised chrome blanks the pages.
    this.chromeView.webContents.on('did-finish-load', () => {
      this.chromeView.setBackgroundColor('#00000000');
    });
    this.win.contentView.addChildView(this.chromeView);
    this.fitChromeView();

    this.left = new Section(space, true);
    this.right = new Section(space, false);
    this.wireSections();

    this.chromeView.webContents.once('did-finish-load', () => {
      this.chromeReady = true;
      if (opts.maximized) this.win.maximize();
      this.win.show();
      if (!opts.maximized) applyRestoredPosition(this.win, opts);
      this.restoreSession();
      this.pushState();
    });
    loadChromeRoute(this.chromeView.webContents, `space/${space.id}`);

    this.win.on('resize', () => this.fitChromeView());
    this.win.on('close', () => {
      this.saveSession();
      this.savePlacement();
    });
    this.win.on('closed', () => {
      clearInterval(this.autosaveTimer);
      for (const resolve of this.permissionResolvers.values()) resolve(false);
      this.permissionResolvers.clear();
      this.resolveScreenShare(null);
      this.left.dispose();
      this.right.dispose();
      this.onClosed();
    });

    // Autosave guards against crashes (docs/behaviors.md → Session restore).
    this.autosaveTimer = setInterval(() => this.saveSession(), AUTOSAVE_MS);

    // Hand-added links get a fallback-fetched icon (live capture is better
    // but needs the page opened once).
    fireAndForget('ensure space icons', this.refreshFavicons());
  }

  async refreshFavicons(): Promise<void> {
    if (await ensureSpaceIcons(this.space)) {
      spacesStore.save();
      this.pushState();
    }
  }

  /**
   * Routing (docs/behaviors.md): the left view is pinned; leaving it — by
   * link or new-window request — lands in the right section. The right view
   * is the free-browsing pane and navigates in place.
   */
  private wireSections(): void {
    for (const section of [this.left, this.right]) {
      section.onViewsChanged = () => {
        this.syncViews();
        this.pushState();
      };
      section.onChanged = () => this.pushState();
    }

    this.left.configureView = (view, key) => {
      view.onChanged = () => this.pushState();
      view.onNavigateAway = (url) => this.openInRight(url);
      view.onNewWindow = (url) => this.openInRight(url);
      view.onPopupCreated = (popup) => this.adoptPopup(popup);
      // Shift+click on the left navigates the left view in place (instead of
      // routing right).
      view.onFlipNavigation = (url) => view.navigate(url);
      view.onSplitNudge = (d) => this.nudgeSplit(d);
      view.onFindRequested = () => this.notifyChrome('space:openFind', 'left');
      view.onFoundInPage = (active, matches) =>
        this.notifyChrome('space:findResult', 'left', active, matches);
      extensionsAddTab(view.webContents, this.win);
      if (key !== 'adhoc') {
        // This tab belongs to a home link: live favicons refresh its tile
        // icon (services on one domain — Gmail vs Calendar — only get
        // distinct icons this way), and its app's manifest background is
        // remembered for the launch splash.
        view.capturesFavicons = true;
        view.onFaviconCaptured = (pageUrl, image) => this.onLinkFavicon(key, pageUrl, image);
        view.onAppBackground = (pageUrl, css) => this.onLinkBackground(key, pageUrl, css);
      }
      this.attachContextMenu(view);
    };

    this.right.configureView = (view) => {
      view.onChanged = () => this.pushState();
      view.onNavigateAway = (url) => view.navigate(url);
      view.onNewWindow = (url) => view.navigate(url);
      view.onPopupCreated = (popup) => this.adoptPopup(popup);
      // Shift+click on the right opens on the left; the right section stays
      // open (unlike "Move page to left").
      view.onFlipNavigation = (url) => this.left.promote(url);
      view.onSplitNudge = (d) => this.nudgeSplit(d);
      view.onFindRequested = () => this.notifyChrome('space:openFind', 'right');
      view.onFoundInPage = (active, matches) =>
        this.notifyChrome('space:findResult', 'right', active, matches);
      extensionsAddTab(view.webContents, this.win);
      this.attachContextMenu(view);
    };
  }

  /** A home-link tab reported its page's favicon; refresh the tile icon.
   * Host-guarded: the tab can be navigated away from its link in place
   * (forms, shift+click) — some other site's icon must not take the tile. */
  private onLinkFavicon(linkId: string, pageUrl: string, image: Buffer): void {
    const link = this.space.links.find((l) => l.id === linkId);
    if (!link || !sameAuthority(link.url, pageUrl)) return;
    if (storeIcon(link, image)) {
      spacesStore.save();
      this.pushState();
    }
  }

  /** A home-link tab read its app's manifest background; remember it for the
   * launch splash. Host-guarded like the favicon. */
  private onLinkBackground(linkId: string, pageUrl: string, background: string): void {
    const link = this.space.links.find((l) => l.id === linkId);
    if (!link || link.background === background || !sameAuthority(link.url, pageUrl)) return;
    link.background = background;
    spacesStore.save();
  }

  /**
   * Content context menu — the engine ships none. Kept minimal: link/image
   * address copying, clipboard editing, and "open in the other view" routed
   * through the same rules as any new-window request.
   */
  private attachContextMenu(view: ContentView): void {
    view.webContents.on('context-menu', (_event, params) => {
      const isLeft = view.isLeft;
      const template: MenuItemConstructorOptions[] = [];

      if (params.linkURL && /^https?:/i.test(params.linkURL)) {
        const url = params.linkURL;
        template.push(
          { label: 'Open link', click: () => view.navigate(url) },
          {
            label: isLeft ? 'Open link in right view' : 'Open link in left view',
            click: () => (isLeft ? this.openInRight(url) : this.left.promote(url))
          },
          { label: 'Copy link address', click: () => clipboard.writeText(url) },
          { type: 'separator' }
        );
      }
      if (params.hasImageContents && params.srcURL) {
        const src = params.srcURL;
        template.push(
          { label: 'Copy image address', click: () => clipboard.writeText(src) },
          { type: 'separator' }
        );
      }
      if (params.isEditable) {
        template.push(
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { role: 'selectAll' },
          { type: 'separator' }
        );
      } else if (params.selectionText.trim()) {
        template.push({ role: 'copy' }, { type: 'separator' });
      }
      template.push(
        { label: 'Reload', click: () => view.reload() },
        { label: 'Copy page address', click: () => clipboard.writeText(view.currentUrl()) }
      );

      Menu.buildFromTemplate(template).popup({ window: this.win });
    });
  }

  private section(side: Side): Section {
    return side === 'left' ? this.left : this.right;
  }

  /**
   * A page opened a real popup window (docs/behaviors.md → Navigation
   * routing). Flank ties it to this space window and labels it with the
   * origin: a popup has no address bar, and these windows are exactly where
   * credentials get typed, so the site asking must be visible.
   */
  private adoptPopup(popup: BrowserWindow): void {
    // BrowserWindow accepts any BaseWindow parent at runtime; the typing is
    // stricter than the implementation.
    popup.setParentWindow(this.win as unknown as BrowserWindow);
    popup.setAutoHideMenuBar(true);
    popup.setMenuBarVisibility(false);

    const wc = popup.webContents;
    const showOrigin = (): void => {
      let host = '';
      try {
        host = new URL(wc.getURL()).host;
      } catch {
        /* about:blank until the popup's first navigation */
      }
      const title = wc.getTitle();
      popup.setTitle(host ? `${title || 'Flank'} — ${host}` : title || 'Flank');
    };
    popup.on('page-title-updated', (event) => {
      event.preventDefault();
      showOrigin();
    });
    wc.on('did-navigate', showOrigin);
    showOrigin();

    // Password managers should reach the sign-in form inside the popup.
    extensionsAddTab(wc, popup);

    // Links out of the popup follow Flank's routing; nested popups (some
    // providers chain them) stay popups.
    wc.setWindowOpenHandler((details) => {
      if (details.disposition === 'new-window') return { action: 'allow' };
      if (/^https?:/i.test(details.url)) this.openInRight(details.url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (nested) => this.adoptPopup(nested));
  }

  // --- View attachment & layout ---

  private fitChromeView(): void {
    const bounds = this.win.getContentBounds();
    this.chromeView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  }

  /** Attaches/positions the active view per section; detaches the rest (kept alive off-window). */
  private syncViews(): void {
    const wanted = new Map<ContentView, Rect | null>();
    if (this.left.mode === 'web' && this.left.activeView) {
      wanted.set(this.left.activeView, this.layoutRects.left);
    }
    if (this.rightOpen && this.right.mode === 'web' && this.right.activeView) {
      wanted.set(this.right.activeView, this.layoutRects.right);
    }

    for (const view of [...this.attached]) {
      if (!wanted.has(view)) {
        this.win.contentView.removeChildView(view.view);
        this.attached.delete(view);
      }
    }

    for (const [view, rect] of wanted) {
      if (!this.attached.has(view)) {
        // Content views sit above the chrome unless an overlay is up.
        const index = this.overlayActive ? 0 : undefined;
        this.win.contentView.addChildView(view.view, index);
        this.attached.add(view);
        extensionsSelectTab(view.webContents); // now the section's active tab
      }
      if (rect) view.view.setBounds(rect);
      // Splash and crash panels paint in the chrome's hole under the view,
      // so the view hides while either is up.
      view.view.setVisible(!!rect && !view.crashed && !view.splash);
    }
  }

  /** The chrome reported where a section's web content should display. */
  setLayout(side: Side, rect: Rect | null): void {
    this.layoutRects[side] = rect;
    this.syncViews();
  }

  /**
   * Flyout/overlay mode: the chrome must draw above the pages (its background
   * is transparent, so only the flyout is visible). Any click outside is the
   * chrome's to dismiss.
   */
  setOverlay(active: boolean): void {
    if (this.overlayActive === active) return;
    this.overlayActive = active;
    if (active) {
      this.win.contentView.addChildView(this.chromeView); // move to top
    } else {
      this.win.contentView.addChildView(this.chromeView, 0); // back under the pages
    }
  }

  // --- Section actions (invoked from chrome IPC) ---

  openLink(side: Side, linkId: string): void {
    const link = this.space.links.find((l) => l.id === linkId);
    if (link) this.section(side).openLink(link);
  }

  navigateAdhoc(side: Side, url: string): void {
    this.section(side).navigateAdhoc(url);
  }

  goHome(side: Side): void {
    this.section(side).showHome();
  }

  returnFromHome(side: Side): void {
    const returned = this.section(side).returnFromHome();
    // Right home with nothing to return to: ✕ closes the section.
    if (!returned && side === 'right') this.closeRightSection();
  }

  refresh(side: Side): void {
    this.section(side).activeView?.reload();
  }

  goBack(side: Side): void {
    this.section(side).activeView?.goBackInEngine();
  }

  openRight(): void {
    this.openRightSection();
    this.right.showHome();
  }

  /** "Move page to left": left keeps its trail with this URL on top; right closes. */
  promoteToLeft(): void {
    const url = this.right.activeView?.currentUrl();
    if (!url) return;
    this.closeRightSection();
    this.left.promote(url);
  }

  closeRightSection(): void {
    if (!this.rightOpen) return;
    this.rightOpen = false;
    this.right.reset();
    this.layoutRects.right = null;
    this.syncViews();
    this.pushState();
  }

  private openRightSection(): void {
    if (this.rightOpen) return;
    this.rightOpen = true;
    this.syncViews();
    this.pushState();
  }

  private openInRight(url: string): void {
    this.openRightSection();
    // Replacing the right view's current page keeps the replaced page
    // recoverable through the right view's trail.
    this.right.navigateAdhoc(url);
  }

  // --- Split ---

  setSplitRatio(ratio: number): void {
    const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
    this.space.splitRatio = Math.round(clamped * 1000) / 1000;
    spacesStore.save();
    this.pushState();
  }

  nudgeSplit(direction: -1 | 1): void {
    if (!this.rightOpen) return;
    this.setSplitRatio(this.space.splitRatio + direction * SPLIT_STEP);
  }

  /** The section's currently shown web view, if any. */
  sectionView(side: Side): ContentView | null {
    return this.section(side).activeView;
  }

  /** True if the given webContents belongs to one of this window's pages. */
  containsWebContents(webContentsId: number): boolean {
    return [...this.left.allViews(), ...this.right.allViews()].some(
      (v) => v.webContents.id === webContentsId
    );
  }

  /** Fire-and-forget event to this window's chrome renderer. */
  notifyChrome(channel: string, ...args: unknown[]): void {
    if (!this.chromeReady || this.win.isDestroyed()) return;
    this.chromeView.webContents.send(`flank:${channel}`, ...args);
  }

  // --- Find in page ---

  find(side: Side, text: string, forward: boolean, findNext: boolean): void {
    this.sectionView(side)?.findInPage(text, { forward, findNext });
  }

  stopFind(side: Side): void {
    this.sectionView(side)?.stopFind();
  }

  // --- Permissions ---

  /** Shows the chrome's permission dialog; resolves with the user's choice. */
  showPermissionPrompt(prompt: PermissionPrompt): Promise<boolean> {
    return new Promise((resolve) => {
      const id = newId();
      this.permissionResolvers.set(id, resolve);
      this.notifyChrome('space:permissionPrompt', { id, ...prompt });
    });
  }

  resolvePermission(id: string, allow: boolean): void {
    const resolve = this.permissionResolvers.get(id);
    this.permissionResolvers.delete(id);
    resolve?.(allow);
  }

  /**
   * Shows the screen-share picker; resolves with the chosen source (or kind,
   * where the system portal picks) and null when the user declines. A second
   * request while the dialog is open is declined rather than replacing it,
   * which would leave the first page waiting forever.
   */
  showScreenSharePrompt(prompt: ScreenSharePrompt): Promise<string | null> {
    if (this.screenShareResolver) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.screenShareResolver = resolve;
      this.notifyChrome('space:screenSharePrompt', prompt);
    });
  }

  resolveScreenShare(choice: string | null): void {
    const resolve = this.screenShareResolver;
    this.screenShareResolver = null;
    resolve?.(choice);
  }

  // --- Extensions ---

  /**
   * An extension's toolbar button was clicked: open its popup anchored to the
   * button — beside it, or below it when the toolbar sits on top — or fall
   * back to its options page in this section's view (docs/behaviors.md →
   * Extensions). Link-outs from the popup route like any new-window request
   * from that section.
   */
  activateExtension(side: Side, settingsId: string, anchor: Rect): void {
    const activation = extensionActivation(settingsId);
    if (!activation) {
      log(`extension ${settingsId} has no popup or options page`);
      return;
    }

    if (activation.kind === 'options') {
      this.sectionView(side)?.navigate(activation.url, { suppressTrail: true });
      return;
    }

    this.extensionPopup?.close();
    const placement = settingsStore.current.toolbarPosition === 'top' ? 'below' : 'right';
    const popup = new ExtensionPopup(this.win, activation.url, anchor, placement, (url) => {
      if (side === 'left') this.openInRight(url);
      else this.sectionView('right')?.navigate(url);
    });
    popup.onClosed = () => {
      if (this.extensionPopup === popup) this.extensionPopup = null;
    };
    this.extensionPopup = popup;
  }

  /** chrome.tabs.create lands here: same routing as a new-window request. */
  openTabForExtension(url: string): [Electron.WebContents, BaseWindow] | null {
    this.openInRight(url);
    const view = this.sectionView('right');
    return view ? [view.webContents, this.win] : null;
  }

  // --- Adaptive colors ---

  /**
   * The chrome computed the window's resolved theme colors (page colors after
   * contrast adjustment, or its own defaults); tint the native caption
   * buttons to match (docs/ui.md → Adaptive colors).
   */
  setChromeColors(colors: PageColors | null): void {
    if (process.platform === 'darwin') return; // no overlay buttons to tint
    try {
      const fallback = titleBarOverlayColors();
      this.win.setTitleBarOverlay({
        color: colors?.bg || fallback.color,
        symbolColor: colors?.fg || fallback.symbolColor
      });
    } catch {
      // Overlay tinting is cosmetic; some platforms/versions lack support.
    }
  }

  /**
   * Pin the current page to the space's home grid. The manifest's short_name
   * is a cleaner tile label than the route-varying document title, and its
   * background color feeds the launch splash. The tile icon is captured live
   * from the page (best quality); the fallback fetch pipeline covers a miss.
   */
  async pinCurrentPage(side: Side): Promise<void> {
    const view = this.section(side).activeView;
    const url = view?.currentUrl();
    if (!view || !url) return;

    const manifest = await readManifest(view.webContents);
    const title = manifest.name ?? (view.pageTitle || url);
    const link = {
      id: newId(),
      title,
      url,
      icon: '',
      background: manifest.backgroundColor ?? '',
      order:
        this.space.links.length === 0
          ? 0
          : Math.max(...this.space.links.map((l) => l.order)) + 1
    };
    const image = await captureBestFavicon(view, manifest.iconUrls);
    if (image) storeIcon(link, image);

    this.space.links.push(link);
    spacesStore.save();
    this.pushState();
    if (!image) fireAndForget('pin icon fallback', this.refreshFavicons());
  }

  // --- Trail ---

  trailNavigate(side: Side, index: number): void {
    this.section(side).activeView?.trailNavigate(index);
  }

  trailDelete(side: Side, index: number): void {
    this.section(side).activeView?.trailDelete(index);
  }

  trailClear(side: Side): void {
    this.section(side).activeView?.trailClear();
  }

  // --- Session & placement ---

  private restoreSession(): void {
    const session = loadSession(this.space.id);
    this.left.restoreSession(session.left, true);
    if (session.right.open) {
      this.openRightSection();
      this.right.restoreSession(session.right, true);
    } else {
      // Closed at save time: keep the trail available without reopening.
      this.right.restoreSession(session.right, false);
    }
  }

  saveSession(): void {
    if (!this.chromeReady) return; // don't overwrite a session that wasn't restored yet
    const file: SessionFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      left: this.left.captureSession(true),
      right: this.right.captureSession(this.rightOpen)
    };
    saveSession(this.space.id, file);
  }

  private savePlacement(): void {
    const placement = capturePlacement(this.win, this.space.window);
    if (placement) {
      this.space.window = placement;
      spacesStore.save();
    }
  }

  focus(): void {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  close(): void {
    this.win.close();
  }

  // --- State snapshots for the chrome ---

  /** Batches state pushes within a tick; every mutation ends with one snapshot. */
  pushState(): void {
    if (this.pushQueued || !this.chromeReady) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (this.win.isDestroyed()) return;
      this.syncViews(); // visibility depends on splash/crash state
      const dto = this.buildState();
      this.chromeView.webContents.send('flank:space:state', dto);
      this.applyWindowTitle(dto);
    });
  }

  buildState(): SpaceStateDto {
    return {
      spaceId: this.space.id,
      name: this.space.name,
      links: [...this.space.links].sort((a, b) => a.order - b.order),
      splitRatio: this.space.splitRatio,
      rightOpen: this.rightOpen,
      left: this.sectionDto('left'),
      right: this.sectionDto('right'),
      extensions: extensionButtons(),
      toolbarPosition: settingsStore.current.toolbarPosition
    };
  }

  private sectionDto(side: Side): SectionDto {
    const section = this.section(side);
    const view = section.activeView;
    const url = view?.currentUrl() ?? '';
    return {
      side,
      open: side === 'left' || this.rightOpen,
      mode: section.mode,
      url,
      pageTitle: view?.pageTitle ?? '',
      canGoBack: view?.canGoBack ?? false,
      showReturnButton: side === 'right' || section.canReturnFromHome,
      returnCloses: side === 'right' && !section.canReturnFromHome,
      showAddressBar: section.mode === 'web' && !this.isFromHomeLink(url),
      trail: view ? [...view.trail] : [],
      loading: view?.loading ?? false,
      crashed: view?.crashed ?? false,
      colors: view?.colors ?? null,
      splash: view?.splash ?? null
    };
  }

  /**
   * The address bar hides when the page is one of the space's home links
   * (docs/ui.md). Matching is by host — case-insensitive, ignoring `www.` —
   * so redirects and SPA routes within a pinned site still count.
   */
  private isFromHomeLink(url: string): boolean {
    const host = comparableHost(url);
    if (host.length === 0) return true; // blank/parked: no bar either
    return this.space.links.some((l) => comparableHost(l.url) === host);
  }

  /** Window title tracks the left section's active page (docs/ui.md). */
  private applyWindowTitle(dto: SpaceStateDto): void {
    const pageTitle = dto.left.mode === 'web' ? dto.left.pageTitle : '';
    this.win.setTitle(pageTitle ? `${this.space.name} - ${pageTitle}` : this.space.name);
  }
}

/** Same scheme+host+port — the guard for live-captured link metadata. */
function sameAuthority(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host.toLowerCase() === ub.host.toLowerCase();
  } catch {
    return false;
  }
}

function comparableHost(url: string): string {
  if (!url.startsWith('http')) return '';
  try {
    const host = new URL(url).host.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}
