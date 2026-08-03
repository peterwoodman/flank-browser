import { BaseWindow, MenuItemConstructorOptions, Session } from 'electron';
import { Space, SessionFile } from '@shared/types';
import { Rect, Side, SectionDto, SpaceStateDto } from '@shared/space-types';
import { ChromeWindow } from './chrome-window';
import { Section } from './section';
import { ContentView } from './content-view';
import { spacesStore } from './stores/spaces-store';
import { settingsStore } from './stores/settings-store';
import { loadSession, saveSession } from './stores/session-store';
import { capturePlacement } from './placement';
import { readManifest } from './manifest-info';
import { newId } from './ids';
import { storeIcon, captureBestFavicon, ensureSpaceIcons } from './favicons';
import { fireAndForget } from './log';
import { extensionButtons, extensionsAddTab, extensionsSelectTab } from './extensions';

const SPLIT_STEP = 0.05;
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;
const AUTOSAVE_MS = 30_000;

/**
 * One window per space: the two sections (home view or web page each) and the
 * space's own rules — pinned-left navigation routing, keep-alive tabs, the
 * home grid, the trail, and session restore. The window shell itself is
 * `ChromeWindow`.
 */
export class SpaceWindowController extends ChromeWindow {
  readonly space: Space;
  private readonly left: Section;
  private readonly right: Section;
  private rightOpen = false;
  private readonly autosaveTimer: NodeJS.Timeout;

  constructor(space: Space, ses: Session) {
    super({
      id: space.id,
      session: ses,
      route: `space/${space.id}`,
      title: space.name,
      defaultSize: { width: 1400, height: 900 },
      placement: space.window,
      captionScheme: space.colorScheme
    });
    this.space = space;

    this.left = new Section(space, true, ses);
    this.right = new Section(space, false, ses);
    this.wireSections();

    // Autosave guards against crashes (docs/behaviors.md → Session restore).
    this.autosaveTimer = setInterval(() => this.saveSession(), AUTOSAVE_MS);

    // Hand-added links get a fallback-fetched icon (live capture is better
    // but needs the page opened once).
    fireAndForget('ensure space icons', this.refreshFavicons());
  }

  protected override get captionScheme(): string {
    return this.space.colorScheme;
  }

  protected override onChromeReady(): void {
    this.restoreSession();
  }

  protected override onWindowClose(): void {
    this.saveSession();
    this.savePlacement();
  }

  protected override onWindowClosed(): void {
    clearInterval(this.autosaveTimer);
    this.left.dispose();
    this.right.dispose();
  }

  async refreshFavicons(): Promise<void> {
    if (await ensureSpaceIcons(this.space)) {
      spacesStore.save();
      this.pushState();
    }
  }

  private wireSections(): void {
    for (const section of [this.left, this.right]) {
      section.onViewsChanged = () => {
        this.syncViews();
        this.pushState();
      };
      section.onChanged = () => this.pushState();
      section.configureView = (view) => this.prepareView(view);
    }
  }

  /**
   * Wires a new page into this window. Both sections share one set of
   * callbacks, each resolving against the section holding the view at the
   * time it fires rather than the one that created it — a page can move
   * between them (docs/behaviors.md → Sections lifecycle).
   */
  private prepareView(view: ContentView): void {
    view.onChanged = () => this.pushState();
    view.onNavigateAway = (url) => this.routeAway(view, url);
    view.onNewWindow = (url) => this.routeAway(view, url);
    view.onPopupCreated = (popup) => this.adoptPopup(popup);
    // Shift+click flips the target section, so the link opens on the left
    // either way: in place when the view is already the left one.
    view.onFlipNavigation = (url) =>
      this.sideOf(view) === 'left' ? view.navigate(url) : this.left.promote(url);
    view.onSplitNudge = (d) => this.nudgeSplit(d);
    view.onFindRequested = () => this.notifyChrome('space:openFind', this.sideOf(view));
    view.onFoundInPage = (active, matches) =>
      this.notifyChrome('space:findResult', this.sideOf(view), active, matches);
    // Only fire on a home link's tab: live favicons refresh its tile icon
    // (services on one domain — Gmail vs Calendar — only get distinct icons
    // this way), and its app's manifest background feeds the launch splash.
    view.onFaviconCaptured = (pageUrl, image) => this.onLinkFavicon(view, pageUrl, image);
    view.onAppBackground = (pageUrl, css) => this.onLinkBackground(view, pageUrl, css);
    extensionsAddTab(view.webContents, this.win);
    this.adoptView(view);
  }

  /**
   * Routing (docs/behaviors.md): a user navigation leaving the pinned left
   * view, or a page asking for a tab, lands in the right section. The right
   * view is the free-browsing pane and navigates in place.
   */
  private routeAway(view: ContentView, url: string): void {
    if (this.sideOf(view) === 'left') this.openInRight(url);
    else view.navigate(url);
  }

  /** Which section is showing this view now. */
  private sideOf(view: ContentView): Side {
    return this.left.owns(view) ? 'left' : 'right';
  }

  /** A home-link tab reported its page's favicon; refresh the tile icon.
   * Host-guarded: the tab can be navigated away from its link in place
   * (forms, shift+click) — some other site's icon must not take the tile. */
  private onLinkFavicon(view: ContentView, pageUrl: string, image: Buffer): void {
    const link = this.space.links.find((l) => l.id === view.linkId);
    if (!link || !sameAuthority(link.url, pageUrl)) return;
    if (storeIcon(link, image)) {
      spacesStore.save();
      this.pushState();
    }
  }

  /** A home-link tab read its app's manifest background; remember it for the
   * launch splash. Host-guarded like the favicon. */
  private onLinkBackground(view: ContentView, pageUrl: string, background: string): void {
    const link = this.space.links.find((l) => l.id === view.linkId);
    if (!link || link.background === background || !sameAuthority(link.url, pageUrl)) return;
    link.background = background;
    spacesStore.save();
  }

  /** The other view is where a link can also be opened from. */
  protected override linkMenuItems(
    view: ContentView,
    url: string
  ): MenuItemConstructorOptions[] {
    const isLeft = this.sideOf(view) === 'left';
    return [
      {
        label: isLeft ? 'Open link in right view' : 'Open link in left view',
        click: () => (isLeft ? this.openInRight(url) : this.left.promote(url))
      }
    ];
  }

  private section(side: Side): Section {
    return side === 'left' ? this.left : this.right;
  }

  /** The active view of each open section. */
  protected override wantedViews(): Map<ContentView, Rect | null> {
    const wanted = new Map<ContentView, Rect | null>();
    if (this.left.mode === 'web' && this.left.activeView) {
      wanted.set(this.left.activeView, this.layoutRects.left);
    }
    if (this.rightOpen && this.right.mode === 'web' && this.right.activeView) {
      wanted.set(this.right.activeView, this.layoutRects.right);
    }
    return wanted;
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

  openRight(): void {
    this.openRightSection();
    this.right.showHome();
  }

  /**
   * "Move page to left": the right's live view moves into the left section and
   * the right closes. The page itself is handed over rather than reloaded, so
   * it keeps its document, scroll position, and playing media; the left's
   * trail continues beneath it.
   */
  promoteToLeft(): void {
    const view = this.right.activeView;
    if (!view || !view.currentUrl()) return;
    this.right.release(view);
    this.left.takeOver(view);
    // The view never leaves the window, so syncViews sees it as already
    // attached and says nothing; the extension host still has to hear that
    // the left section's active tab changed.
    extensionsSelectTab(view.webContents);
    this.closeRightSection();
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
  override sectionView(side: Side): ContentView | null {
    return this.section(side).activeView;
  }

  /** True if the given webContents belongs to one of this window's pages. */
  override containsWebContents(webContentsId: number): boolean {
    return [...this.left.allViews(), ...this.right.allViews()].some(
      (v) => v.webContents.id === webContentsId
    );
  }

  // --- Extensions ---

  /**
   * A URL the chrome asks to open (a popup link-out, or an extension popup's):
   * routed like any new-window request from that section.
   */
  protected override routeFromChrome(side: Side, url: string): void {
    if (side === 'left') this.openInRight(url);
    else this.sectionView('right')?.navigate(url);
  }

  /** chrome.tabs.create lands here: same routing as a new-window request. */
  override openTabForExtension(url: string): [Electron.WebContents, BaseWindow] | null {
    this.openInRight(url);
    const view = this.sectionView('right');
    return view ? [view.webContents, this.win] : null;
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

  /**
   * The toolbar's address-bar toggle: flips whatever is showing now and holds
   * that as the section's override (docs/ui.md → Web view). The override is
   * cleared by the section, not here — when it closes or a different page is
   * picked from home.
   */
  toggleAddressBar(side: Side): void {
    const section = this.section(side);
    if (section.mode !== 'web') return;
    const url = section.activeView?.currentUrl() ?? '';
    const shownNow = section.addressBarOverride ?? !this.isFromHomeLink(url);
    section.addressBarOverride = !shownNow;
    this.pushState();
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

  // --- State snapshots for the chrome ---

  override buildState(): SpaceStateDto {
    return {
      spaceId: this.space.id,
      name: this.space.name,
      colorScheme: this.space.colorScheme,
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
    const fromHomeLink = this.isFromHomeLink(url);
    return {
      side,
      open: side === 'left' || this.rightOpen,
      mode: section.mode,
      url,
      pageTitle: view?.pageTitle ?? '',
      canGoBack: view?.canGoBack ?? false,
      showReturnButton: side === 'right' || section.canReturnFromHome,
      returnCloses: side === 'right' && !section.canReturnFromHome,
      showAddressBar: section.mode === 'web' && (section.addressBarOverride ?? !fromHomeLink),
      showPinButton: !fromHomeLink,
      trail: view ? [...view.trail] : [],
      loading: view?.loading ?? false,
      crashed: view?.crashed ?? false,
      unresponsive: view?.unresponsive ?? false,
      loadError: view?.loadError ?? null,
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
  protected override onStatePushed(): void {
    const pageTitle = this.left.mode === 'web' ? (this.left.activeView?.pageTitle ?? '') : '';
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
