import { app } from 'electron';
import { prepareEverySession } from './browser-session';

/**
 * Google's sign-in service rejects browsers whose claims are inconsistent
 * ("This browser or app may not be secure"). A UA that says plain Chrome
 * fails their check, because Electron never sends the Sec-CH-UA client-hint
 * headers real Chrome always sends. The stock Electron UA passes — Google
 * routes unrecognized-but-honest browsers to a lite sign-in flow — so these
 * hosts get the unmodified UA while the rest of the web sees Chrome.
 */
const ELECTRON_UA_HOSTS = ['https://accounts.google.com/*', 'https://accounts.youtube.com/*'];

/**
 * Electron's default user agent names the app and Electron itself
 * ("Flank/0.7.0 … Electron/43.2.0" between the Chrome and Safari tokens), and
 * both sites and extensions sniff for it — LastPass reads it as the LastPass
 * desktop app and takes a DOM-bound code path that cannot run in a service
 * worker. A browser should present the browser it embeds, so trim the tail
 * back to what Chrome itself sends — except on the hosts above.
 */
export function installUserAgentPolicy(): void {
  const electronDefault = app.userAgentFallback;
  app.userAgentFallback = electronDefault.replace(
    /\(KHTML, like Gecko\).*$/,
    `(KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`
  );

  prepareEverySession((ses) => {
    ses.webRequest.onBeforeSendHeaders({ urls: ELECTRON_UA_HOSTS }, (details, callback) => {
      details.requestHeaders['User-Agent'] = electronDefault;
      callback({ requestHeaders: details.requestHeaders });
    });
  });
}
