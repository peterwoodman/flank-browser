import { app } from 'electron';

/**
 * Certificate errors (docs/behaviors.md → Certificate errors): the engine
 * refuses a site whose certificate it cannot verify and reports nothing to the
 * page, which would leave an empty view. Flank shows an interstitial instead
 * and lets the user proceed for hosts they know — a self-hosted service on an
 * expired or self-signed certificate is the case this exists for.
 *
 * The hook is app-wide rather than a session preparer because Electron offers
 * no per-session equivalent, and a decision about a host is not a decision
 * about the profile viewing it. Allowances are held in memory only: trusting a
 * bad certificate forever is a decision no one revisits, so it lapses when
 * Flank quits.
 */

const allowedHosts = new Set<string>();

export function installCertificateHandler(): void {
  app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
    if (!allowedHosts.has(hostOf(url))) {
      callback(false);
      return;
    }
    event.preventDefault();
    callback(true);
  });
}

/** The user chose to continue past this host's certificate for the rest of the run. */
export function allowCertificateHost(host: string): void {
  if (host) allowedHosts.add(host);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
