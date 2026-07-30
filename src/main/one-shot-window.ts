import { BaseWindow, Session } from 'electron';
import { OneShotStateDto, Rect, SectionDto, Side } from '@shared/space-types';
import { ChromeWindow } from './chrome-window';
import { ContentView } from './content-view';
import { settingsStore } from './stores/settings-store';
import { isWebUrl } from './navigation-input';
import { extensionButtons, extensionsAddTab } from './extensions';

/** Stands in for a space's name in the title bar; there is no space here. */
const WINDOW_TITLE = '1-shot';

/**
 * A 1-shot window (docs/ui.md → 1-shot window): one free-browsing page in the
 * profile of the window that opened it, with an address bar and nothing else —
 * no home, no trail, nothing remembered when it closes. For the errand that
 * doesn't belong in a space.
 */
export class OneShotWindowController extends ChromeWindow {
  private readonly view: ContentView;

  constructor(id: string, ses: Session, startUrl: string) {
    super({
      id,
      session: ses,
      route: `oneshot/${id}`,
      title: WINDOW_TITLE,
      defaultSize: { width: 1100, height: 800 }
    });

    this.view = new ContentView(ses);
    // Free browsing: every navigation loads here, and none is recorded.
    this.view.pinned = false;
    this.view.recordsTrail = false;
    this.view.onChanged = () => this.pushState();
    this.view.onNewWindow = (url) => this.view.navigate(url);
    this.view.onFlipNavigation = (url) => this.view.navigate(url);
    this.view.onPopupCreated = (popup) => this.adoptPopup(popup);
    this.view.onFindRequested = () => this.notifyChrome('space:openFind', 'left');
    this.view.onFoundInPage = (active, matches) =>
      this.notifyChrome('space:findResult', 'left', active, matches);
    extensionsAddTab(this.view.webContents, this.win);
    this.adoptView(this.view);

    this.view.navigate(startUrl);
  }

  protected override onWindowClosed(): void {
    this.closeExtensionPopup();
    this.view.destroy();
  }

  protected override wantedViews(): Map<ContentView, Rect | null> {
    return new Map([[this.view, this.layoutRects.left]]);
  }

  /** One pane, answered for either side: the toolbar only ever asks for left. */
  override sectionView(_side: Side): ContentView {
    return this.view;
  }

  override containsWebContents(webContentsId: number): boolean {
    return this.view.webContents.id === webContentsId;
  }

  /** Nowhere else to send it: the errand continues in this same page. */
  protected override routeFromChrome(_side: Side, url: string): void {
    this.view.navigate(url);
  }

  override openTabForExtension(url: string): [Electron.WebContents, BaseWindow] | null {
    this.view.navigate(url);
    return [this.view.webContents, this.win];
  }

  override buildState(): OneShotStateDto {
    return {
      windowId: this.id,
      pane: this.paneDto(),
      extensions: extensionButtons(),
      toolbarPosition: settingsStore.current.toolbarPosition
    };
  }

  private paneDto(): SectionDto {
    return {
      side: 'left',
      open: true,
      mode: 'web',
      url: this.view.currentUrl(),
      pageTitle: this.view.pageTitle,
      canGoBack: this.view.canGoBack,
      showReturnButton: false,
      returnCloses: false,
      // No home to hide it for, and no pinning it away: this window is
      // always somewhere it can say out loud.
      showAddressBar: true,
      trail: [],
      loading: this.view.loading,
      crashed: this.view.crashed,
      unresponsive: this.view.unresponsive,
      loadError: this.view.loadError,
      colors: this.view.colors,
      splash: null
    };
  }

  protected override onStatePushed(): void {
    const title = this.view.pageTitle;
    this.win.setTitle(title ? `${WINDOW_TITLE} - ${title}` : WINDOW_TITLE);
  }
}

/**
 * Where a new 1-shot window starts (docs/data-model.md → settings): an empty
 * page, the search engine's own home page, or one the user named. A custom
 * page that isn't `http(s)` — hand-edited settings — falls back to blank
 * rather than becoming a way to point a window at a local file.
 */
export function oneShotStartUrl(): string {
  const settings = settingsStore.current;
  if (settings.oneShotStart === 'custom') {
    return isWebUrl(settings.oneShotStartUrl) ? settings.oneShotStartUrl : 'about:blank';
  }
  if (settings.oneShotStart === 'search') {
    try {
      return new URL(settings.searchTemplate).origin + '/';
    } catch {
      return 'about:blank';
    }
  }
  return 'about:blank';
}
