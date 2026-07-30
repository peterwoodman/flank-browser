import {
  BaseWindow,
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  Session,
  WebContentsView,
  clipboard,
  dialog,
  nativeTheme
} from 'electron';
import { WindowPlacement } from '@shared/types';
import {
  ClientCertDto,
  OneShotStateDto,
  PageColors,
  Rect,
  Side,
  SpaceStateDto
} from '@shared/space-types';
import { ContentView } from './content-view';
import { settingsStore } from './stores/settings-store';
import { applyRestoredPosition, windowOptionsFrom } from './placement';
import { chromePreloadPath, loadChromeRoute } from './renderer-url';
import { isPopupTarget, isWebUrl } from './navigation-input';
import { titleBarOverlayColors, windowIcon } from './manager-window';
import { newId } from './ids';
import { log } from './log';
import { AuthAnswer, AuthPrompt } from './http-auth';
import { PermissionPrompt } from './permissions';
import { ScreenSharePrompt } from './screen-share';
import { extensionActivation, extensionsAddTab, extensionsSelectTab } from './extensions';
import { ExtensionPopup } from './extension-popup';

export interface ChromeWindowOptions {
  /** Identifies this window in IPC from its chrome (a space id, or a fresh id). */
  id: string;
  /** The profile partition every page in this window browses as. */
  session: Session;
  /** Chrome route to load: `space/<id>`, `oneshot/<id>`. */
  route: string;
  title: string;
  defaultSize: { width: number; height: number };
  /** Saved bounds to restore, where this window type remembers them. */
  placement?: WindowPlacement;
  /**
   * Backdrop scheme for the initial caption strip. Passed rather than read
   * from `captionScheme`, which a subclass answers from state it cannot have
   * set yet while this constructor runs.
   */
  captionScheme?: string;
}

/**
 * A browsing window: a `BaseWindow` holding a full-window React chrome view
 * plus the content views for browsed pages, positioned into the "holes" the
 * chrome reports over IPC (docs/architecture.md → Window/view model).
 *
 * Everything here is what a browsing window needs whichever chrome it wears —
 * the transparent chrome view and its z-order, content-view attachment,
 * permission and screen-share dialogs, popup adoption, the content context
 * menu, extension popups, and caption tinting. What the window *holds* is the
 * subclass's business: a space window's two sections, or a 1-shot window's
 * single page.
 */
export abstract class ChromeWindow {
  readonly id: string;
  readonly win: BaseWindow;
  readonly session: Session;
  protected readonly chromeView: WebContentsView;
  protected layoutRects: Record<Side, Rect | null> = { left: null, right: null };
  protected readonly attached = new Set<ContentView>();
  protected overlayActive = false;
  protected chromeReady = false;
  /** Settles when the chrome can be sent messages, or when the window is gone. */
  private readonly chromeReadyWait: Promise<void>;
  private releaseChromeWait: () => void = () => {};
  private pushQueued = false;
  private readonly permissionResolvers = new Map<string, (allow: boolean) => void>();
  private readonly authResolvers = new Map<string, (answer: AuthAnswer | null) => void>();
  private readonly clientCertResolvers = new Map<string, (fingerprint: string | null) => void>();
  private screenShareResolver: ((choice: string | null) => void) | null = null;
  /** Last colors the chrome reported for the window's leading page; null on home. */
  protected chromeColors: PageColors | null = null;
  private extensionPopup: ExtensionPopup | null = null;

  onClosed: () => void = () => {};

  constructor(opts: ChromeWindowOptions) {
    this.id = opts.id;
    this.session = opts.session;
    this.chromeReadyWait = new Promise((resolve) => (this.releaseChromeWait = resolve));

    const placement = windowOptionsFrom(opts.placement, opts.defaultSize);
    this.win = new BaseWindow({
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      minWidth: 600,
      minHeight: 400,
      show: false,
      icon: windowIcon,
      title: opts.title,
      titleBarStyle: 'hidden',
      ...(process.platform !== 'darwin'
        ? { titleBarOverlay: titleBarOverlayColors(opts.captionScheme) }
        : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3'
    });
    applyRestoredPosition(this.win, placement);

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

    // Fires a tick or more later, so the subclass is fully constructed by the
    // time its hooks are asked for state.
    this.chromeView.webContents.once('did-finish-load', () => {
      this.chromeReady = true;
      this.releaseChromeWait();
      if (placement.maximized) this.win.maximize();
      this.win.show();
      if (!placement.maximized) applyRestoredPosition(this.win, placement);
      this.onChromeReady();
      this.pushState();
    });
    loadChromeRoute(this.chromeView.webContents, opts.route);

    this.win.on('resize', () => this.fitChromeView());
    this.win.on('close', () => this.onWindowClose());
    this.win.on('closed', () => {
      this.releaseChromeWait(); // nothing may wait on a chrome that will never load
      for (const resolve of this.permissionResolvers.values()) resolve(false);
      this.permissionResolvers.clear();
      for (const resolve of this.authResolvers.values()) resolve(null);
      this.authResolvers.clear();
      for (const resolve of this.clientCertResolvers.values()) resolve(null);
      this.clientCertResolvers.clear();
      this.resolveScreenShare(null);
      this.onWindowClosed();
      this.onClosed();
    });
  }

  // --- Subclass contract ---

  /** The chrome finished loading and can be sent state. */
  protected onChromeReady(): void {}
  /** The window is closing and can still be read (save state here). */
  protected onWindowClose(): void {}
  /** The window is gone; release pages. */
  protected onWindowClosed(): void {}

  /** The views this window wants on screen, each with the rect it occupies. */
  protected abstract wantedViews(): Map<ContentView, Rect | null>;
  /** The snapshot this window's chrome renders from. */
  abstract buildState(): SpaceStateDto | OneShotStateDto;
  /** True if the given webContents is one of this window's pages. */
  abstract containsWebContents(webContentsId: number): boolean;
  /** The view a toolbar acts on. A 1-shot window has one, under `left`. */
  abstract sectionView(side: Side): ContentView | null;
  /** `chrome.tabs.create` lands here: routed like any new-window request. */
  abstract openTabForExtension(url: string): [Electron.WebContents, BaseWindow] | null;
  /**
   * A URL the chrome (rather than a page) asks to open: a link out of an
   * adopted popup or an extension popup. Routed by this window's own rules.
   */
  protected abstract routeFromChrome(side: Side, url: string): void;
  /** Extra context-menu items for a link, above "Copy link address". */
  protected linkMenuItems(_view: ContentView, _url: string): MenuItemConstructorOptions[] {
    return [];
  }
  /**
   * Backdrop scheme the caption strip falls back to without page colors. Read
   * only after construction, so a subclass may answer it from its own state.
   */
  protected get captionScheme(): string | undefined {
    return undefined;
  }

  // --- View attachment & layout ---

  private fitChromeView(): void {
    const bounds = this.win.getContentBounds();
    this.chromeView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  }

  /** Attaches/positions the wanted views; detaches the rest (kept alive off-window). */
  protected syncViews(): void {
    const wanted = this.wantedViews();

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
        extensionsSelectTab(view.webContents); // now the window's active tab
      }
      if (rect) view.view.setBounds(rect);
      // Splash, crash, failure, and unresponsive panels paint in the chrome's
      // hole under the view, so the view hides while any of them is up.
      view.view.setVisible(
        !!rect && !view.crashed && !view.splash && !view.loadError && !view.unresponsive
      );
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

  // --- Page actions the chrome drives ---

  refresh(side: Side): void {
    this.sectionView(side)?.reload();
  }

  goBack(side: Side): void {
    this.sectionView(side)?.goBackInEngine();
  }

  /** The certificate panel's "Continue anyway". */
  proceedThroughCertificate(side: Side): void {
    this.sectionView(side)?.proceedThroughCertificate();
  }

  /** The unresponsive panel's two answers. */
  keepWaiting(side: Side): void {
    this.sectionView(side)?.keepWaiting();
  }

  killPage(side: Side): void {
    this.sectionView(side)?.killPage();
  }

  find(side: Side, text: string, forward: boolean, findNext: boolean): void {
    this.sectionView(side)?.findInPage(text, { forward, findNext });
  }

  stopFind(side: Side): void {
    this.sectionView(side)?.stopFind();
  }

  focus(): void {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  close(): void {
    this.win.close();
  }

  /** Fire-and-forget event to this window's chrome renderer. */
  notifyChrome(channel: string, ...args: unknown[]): void {
    if (!this.chromeReady || this.win.isDestroyed()) return;
    this.chromeView.webContents.send(`flank:${channel}`, ...args);
  }

  // --- State snapshots for the chrome ---

  /** Batches state pushes within a tick; every mutation ends with one snapshot. */
  pushState(): void {
    if (this.pushQueued || !this.chromeReady) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (this.win.isDestroyed()) return;
      this.syncViews(); // view visibility depends on splash/crash state
      this.chromeView.webContents.send('flank:space:state', this.buildState());
      this.onStatePushed();
    });
  }

  /** A snapshot went out; refresh anything painted outside it (the title). */
  protected onStatePushed(): void {}

  // --- Adaptive colors ---

  /**
   * The chrome computed the window's resolved theme colors (page colors after
   * contrast adjustment, or its own defaults); tint the native caption
   * buttons to match (docs/ui.md → Adaptive colors).
   */
  setChromeColors(colors: PageColors | null): void {
    this.chromeColors = colors;
    this.applyCaptionColors();
  }

  /**
   * Re-tints the caption buttons after the backdrop scheme changed. The chrome
   * only reports colors when the page's change, so this can't wait for the
   * next report.
   */
  refreshCaptionColors(): void {
    this.applyCaptionColors();
  }

  private applyCaptionColors(): void {
    if (process.platform === 'darwin') return; // no overlay buttons to tint
    try {
      const wash = titleBarOverlayColors(this.captionScheme);
      this.win.setTitleBarOverlay({
        color: this.chromeColors?.bg || wash.color,
        symbolColor: this.chromeColors?.fg || wash.symbolColor
      });
    } catch {
      // Overlay tinting is cosmetic; some platforms/versions lack support.
    }
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

  // --- HTTP authentication ---

  /**
   * Shows the sign-in dialog for a server's authentication challenge;
   * resolves with the credentials, or null if the user declined. Unlike
   * permissions these are not serialized app-wide: a challenge blocks the
   * request that met it, so a second one is a second page genuinely waiting.
   */
  async showAuthPrompt(prompt: AuthPrompt): Promise<AuthAnswer | null> {
    // A 1-shot window starts loading before its chrome does, so a challenge
    // can arrive with nowhere to show it yet. The request behind it is waiting
    // regardless, so the dialog waits for the chrome rather than being lost.
    await this.chromeReadyWait;
    if (this.win.isDestroyed()) return null;
    return new Promise((resolve) => {
      const id = newId();
      this.authResolvers.set(id, resolve);
      this.notifyChrome('space:authPrompt', { id, ...prompt });
    });
  }

  resolveAuth(id: string, answer: AuthAnswer | null): void {
    const resolve = this.authResolvers.get(id);
    this.authResolvers.delete(id);
    resolve?.(answer);
  }

  // --- Client certificates ---

  /** Asks which certificate to identify with; resolves to a fingerprint or null. */
  async showClientCertPrompt(certificates: ClientCertDto[]): Promise<string | null> {
    await this.chromeReadyWait;
    if (this.win.isDestroyed()) return null;
    return new Promise((resolve) => {
      const id = newId();
      this.clientCertResolvers.set(id, resolve);
      this.notifyChrome('space:clientCertPrompt', { id, certificates });
    });
  }

  resolveClientCert(id: string, fingerprint: string | null): void {
    const resolve = this.clientCertResolvers.get(id);
    this.clientCertResolvers.delete(id);
    resolve?.(fingerprint);
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

  // --- Popups ---

  /**
   * A page opened a real popup window (docs/behaviors.md → Navigation
   * routing). Flank ties it to this window and labels it with the origin: a
   * popup has no address bar, and these windows are exactly where credentials
   * get typed, so the site asking must be visible.
   */
  protected adoptPopup(popup: BrowserWindow): void {
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

    // Links out of the popup follow this window's routing; nested popups (some
    // providers chain them) stay popups.
    wc.setWindowOpenHandler((details) => {
      if (details.disposition === 'new-window') {
        return isPopupTarget(details.url) ? { action: 'allow' } : { action: 'deny' };
      }
      if (isWebUrl(details.url)) this.routeFromChrome('left', details.url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (nested) => this.adoptPopup(nested));
  }

  // --- Content context menu ---

  /** The wiring every window type gives a page of its own. */
  protected adoptView(view: ContentView): void {
    this.attachContextMenu(view);
    view.onConfirmLeave = () => this.confirmLeave();
  }

  /**
   * A page with unsaved work asked to stay. The engine wants the answer before
   * this returns — there is no waiting for a React dialog and no cancelling
   * the navigation afterwards — so this is the one prompt Flank asks with the
   * platform's own message box.
   */
  private confirmLeave(): boolean {
    const choice = dialog.showMessageBoxSync(this.win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: 'Leave this page?',
      message: 'Leave this page?',
      detail: 'Changes you have made may not be saved.'
    });
    return choice === 0;
  }

  /**
   * Content context menu — the engine ships none. Kept minimal: link/image
   * address copying, clipboard editing, and whatever "open it over there"
   * items this window type offers.
   */
  protected attachContextMenu(view: ContentView): void {
    view.webContents.on('context-menu', (_event, params) => {
      const template: MenuItemConstructorOptions[] = [];

      if (params.linkURL && /^https?:/i.test(params.linkURL)) {
        const url = params.linkURL;
        template.push(
          { label: 'Open link', click: () => view.navigate(url) },
          ...this.linkMenuItems(view, url),
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

  // --- Extensions ---

  /**
   * An extension's toolbar button was clicked: open its popup anchored to the
   * button — beside it, or below it when the toolbar sits on top — or fall
   * back to its options page in that view (docs/behaviors.md → Extensions).
   * Link-outs from the popup route like any new-window request.
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
    const popup = new ExtensionPopup(
      this.win,
      this.session,
      activation.url,
      anchor,
      placement,
      (url) => this.routeFromChrome(side, url)
    );
    popup.onClosed = () => {
      if (this.extensionPopup === popup) this.extensionPopup = null;
    };
    this.extensionPopup = popup;
  }

  protected closeExtensionPopup(): void {
    this.extensionPopup?.close();
  }
}
