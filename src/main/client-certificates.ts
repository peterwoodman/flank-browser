import { app, Certificate, Session, WebContents } from 'electron';
import { ClientCertDto } from '@shared/space-types';
import { log, logError } from './log';

/**
 * Client certificates (docs/behaviors.md → Certificate errors): a server may
 * ask the browser to identify *itself* with a certificate — mutual TLS, the
 * strong lock on a self-hosted service. Electron's default is to send the
 * first one in the store without asking, which quietly picks an identity on
 * the user's behalf and, with more than one installed, is as likely to be the
 * wrong one as the right one. Flank asks which to send.
 *
 * The answer is remembered per host for the run so a site's every request
 * doesn't ask again, and per profile, because which identity is presented is
 * exactly what a profile separates.
 */

/** Resolves to the chosen certificate's fingerprint, or null to send none. */
type PickFn = (contents: WebContents, certificates: ClientCertDto[]) => Promise<string | null>;

interface SessionChoices {
  /** Host → fingerprint chosen for it, or null for "send none". */
  chosen: Map<string, string | null>;
  asking: Map<string, Promise<string | null>>;
}

const bySession = new WeakMap<Session, SessionChoices>();

export function installClientCertificateHandler(pickFn: PickFn): void {
  app.on('select-client-certificate', (event, contents, url, list, callback) => {
    // Nothing to ask over (a main-process request), or nothing to choose
    // between: leave the engine's own behavior alone.
    if (!contents || list.length === 0) return;
    event.preventDefault();

    const host = hostOf(url);
    const state = choicesFor(contents.session);

    if (state.chosen.has(host)) {
      send(state.chosen.get(host) ?? null, list, callback);
      return;
    }

    let ask = state.asking.get(host);
    if (!ask) {
      ask = pickFn(contents, list.map(describe)).catch((err) => {
        logError(`client certificate for ${host}`, err);
        return null;
      });
      state.asking.set(host, ask);
      void ask.then(() => state.asking.delete(host));
    }

    void ask.then((fingerprint) => {
      state.chosen.set(host, fingerprint);
      log(
        fingerprint
          ? `client certificate sent to ${host}`
          : `no client certificate sent to ${host}`
      );
      send(fingerprint, list, callback);
    });
  });
}

/**
 * The engine wants one of the certificates it offered, matched back by
 * fingerprint — the chrome only ever saw a description of them. Calling back
 * with nothing declines, which the server answers as it sees fit.
 */
function send(
  fingerprint: string | null,
  list: Certificate[],
  callback: (certificate?: Certificate) => void
): void {
  const certificate = fingerprint ? list.find((c) => c.fingerprint === fingerprint) : undefined;
  callback(certificate);
}

function describe(certificate: Certificate): ClientCertDto {
  return {
    fingerprint: certificate.fingerprint,
    subject: certificate.subject.commonName || certificate.subjectName,
    issuer: certificate.issuer.commonName || certificate.issuerName,
    // Electron reports these in seconds; the chrome shows a date, not a time.
    expiresAt: new Date(certificate.validExpiry * 1000).toISOString()
  };
}

function choicesFor(ses: Session): SessionChoices {
  let state = bySession.get(ses);
  if (!state) {
    state = { chosen: new Map(), asking: new Map() };
    bySession.set(ses, state);
  }
  return state;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
