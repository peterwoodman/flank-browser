import { contextBridge } from 'electron';

/**
 * Smooths two edges of the extension API surface that make otherwise working
 * extensions fail on load rather than degrade (docs/architecture.md →
 * Extensions).
 *
 * 1. Chrome exposes no `browser` global at all. Electron does, and it carries
 *    only the extension APIs Electron implements natively — `electron-chrome-
 *    extensions` fills in the rest (`windows`, `contextMenus`, `cookies`,
 *    `notifications`, …) onto `chrome` alone. An extension that prefers
 *    `browser` whenever it exists therefore lands on a namespace with holes in
 *    it. Removing it puts such extensions back on the `chrome` path they ship
 *    for Chrome; nothing loses capability, since everything Electron's
 *    `browser` offered is on `chrome` too, and a Chrome Web Store extension
 *    cannot depend on `browser` or it would not run in Chrome either.
 *
 * 2. `chrome.webRequest` is present but nearly empty: Electron implements no
 *    extension-facing webRequest, and the library supplies only
 *    `onHeadersReceived`. Extensions guard with `if (chrome.webRequest)`,
 *    which passes, and then throw on the event they wanted. Inert events keep
 *    that a no-op instead of a crash — the listeners simply never fire, which
 *    is the degradation the docs already describe for ad blockers.
 *
 * Both matter most in a service worker, where a top-level throw fails the
 * worker's registration outright and takes the whole extension down with it.
 */
function patchExtensionApis(): void {
  delete (globalThis as { browser?: unknown }).browser;

  const webRequest = (globalThis as { chrome?: { webRequest?: Record<string, unknown> } }).chrome
    ?.webRequest;
  if (!webRequest) return;

  const events = [
    'onBeforeRequest',
    'onBeforeSendHeaders',
    'onSendHeaders',
    'onHeadersReceived',
    'onAuthRequired',
    'onBeforeRedirect',
    'onResponseStarted',
    'onCompleted',
    'onErrorOccurred'
  ];
  for (const name of events) {
    if (webRequest[name]) continue;
    webRequest[name] = {
      addListener: () => {},
      removeListener: () => {},
      hasListener: () => false
    };
  }
}

// Registered for every frame in the session as well as for workers, so an
// extension's own pages (popups, options) get the same namespace its worker
// does. Everything else — ordinary web content — is left alone.
const isExtensionContext =
  process.type === 'service-worker' || location.protocol === 'chrome-extension:';

// Electron installs the extension globals after preloads run, so touching them
// directly here would find nothing. executeInMainWorld defers to the point
// where they exist — the same hook electron-chrome-extensions builds `chrome`
// from, and registration order puts this after that.
if (isExtensionContext) {
  if ('executeInMainWorld' in contextBridge) {
    contextBridge.executeInMainWorld({ func: patchExtensionApis });
  } else {
    patchExtensionApis();
  }
}
