import { BaseWindow, BrowserWindow, Session } from 'electron';
import { Rect } from '@shared/space-types';
import { logError } from './log';

/** Until the popup page reports its preferred size. */
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 580;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 48;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
const GAP = 4;

/** Which side of the anchor button the popup opens on. */
export type PopupPlacement = 'right' | 'below';

/**
 * An extension's toolbar popup, hosted in a small frameless child window
 * anchored to its toolbar button (docs/behaviors.md → Extensions). Loads on
 * open and is destroyed on close, like a browser toolbar popup; sizes itself
 * to the page's preferred size. Blur light-dismisses, the page's own
 * `window.close` works natively, and link-outs are routed by the owner.
 */
export class ExtensionPopup {
  private readonly popup: BrowserWindow;
  private readonly parent: BaseWindow;
  private readonly anchor: Rect;
  private readonly placement: PopupPlacement;
  private shown = false;

  onClosed: () => void = () => {};

  constructor(
    parent: BaseWindow,
    ses: Session,
    url: string,
    anchor: Rect,
    placement: PopupPlacement,
    onOpenUrl: (url: string) => void
  ) {
    this.parent = parent;
    this.anchor = anchor;
    this.placement = placement;
    this.popup = new BrowserWindow({
      show: false,
      frame: false,
      // BrowserWindow accepts any BaseWindow parent at runtime; the typing
      // is stricter than the implementation.
      parent: parent as unknown as BrowserWindow,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      resizable: false,
      skipTaskbar: true,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        enablePreferredSizeMode: true
      }
    });

    const wc = this.popup.webContents;

    // "Open vault"-style link-outs: route like any new-window request and
    // dismiss, matching browser toolbar popups.
    wc.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/i.test(target)) {
        onOpenUrl(target);
        this.close();
      }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, target) => {
      if (/^https?:/i.test(target)) {
        event.preventDefault();
        onOpenUrl(target);
        this.close();
      }
    });

    wc.on('preferred-size-changed', (_event, size) => {
      this.fit(size.width, size.height);
      this.reveal();
    });

    this.popup.on('blur', () => this.close());
    this.popup.once('closed', () => this.onClosed());
    const closeWithParent = (): void => this.close();
    parent.once('closed', closeWithParent);
    this.popup.once('closed', () => parent.off('closed', closeWithParent));

    wc.loadURL(url).then(
      // Popups that never report a preferred size still need to appear.
      () => setTimeout(() => this.reveal(), 150),
      (err) => {
        logError('extension popup load', err);
        this.close();
      }
    );
  }

  private reveal(): void {
    if (this.shown || this.popup.isDestroyed()) return;
    this.shown = true;
    this.position();
    this.popup.show();
  }

  private fit(width: number, height: number): void {
    if (this.popup.isDestroyed()) return;
    this.popup.setBounds({
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))),
      height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)))
    });
    if (this.shown) this.position();
  }

  /** Beside or below the anchor button, kept inside the parent window. */
  private position(): void {
    if (this.popup.isDestroyed() || this.parent.isDestroyed()) return;
    const content = this.parent.getContentBounds();
    const size = this.popup.getBounds();
    const [x, y] =
      this.placement === 'below'
        ? [content.x + this.anchor.x, content.y + this.anchor.y + this.anchor.height + GAP]
        : [content.x + this.anchor.x + this.anchor.width + GAP, content.y + this.anchor.y];
    this.popup.setPosition(
      Math.round(clamp(x, content.x + GAP, content.x + content.width - size.width - GAP)),
      Math.round(clamp(y, content.y + GAP, content.y + content.height - size.height - GAP))
    );
  }

  close(): void {
    // destroy() emits 'closed', which invokes onClosed exactly once.
    if (!this.popup.isDestroyed()) this.popup.destroy();
  }
}

/** Low bound wins when the popup is larger than the window it must fit in. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
