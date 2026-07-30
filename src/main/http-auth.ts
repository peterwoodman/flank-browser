import { app, Session, WebContents } from 'electron';
import { log, logError } from './log';

/**
 * HTTP authentication (docs/behaviors.md → Media, permissions, and dialogs):
 * the engine's default is to cancel every authentication, which turns a site
 * behind basic auth — the usual guard on a self-hosted service — into a blank
 * page or the server's bare 401. Flank asks for the credentials instead and
 * hands them back to the challenge, proxies included.
 *
 * Flank keeps no credentials of its own. The engine caches what it accepts for
 * the life of its partition and re-sends it without asking again, so this is
 * reached only when nothing is cached or what was cached was refused — and
 * because the cache belongs to the partition, one profile's sign-in never
 * answers another's. Nothing reaches disk: a password store is a different
 * program, and `settings.json` is plain text.
 */

export interface AuthPrompt {
  /** Who is asking: `host:port`, or the proxy's address. */
  address: string;
  /** The server's own label for what it guards; may be empty. */
  realm: string;
  isProxy: boolean;
  /** The last answer came straight back, so it was refused. */
  retry: boolean;
  /** The credentials would travel over plain http. */
  insecure: boolean;
}

export interface AuthAnswer {
  username: string;
  password: string;
}

/** Shows the sign-in dialog in the asking page's window; null to cancel. */
type PromptFn = (contents: WebContents, prompt: AuthPrompt) => Promise<AuthAnswer | null>;

/** The longest server-supplied realm shown; the string is the server's to choose. */
const MAX_REALM = 100;

/**
 * How soon a repeat challenge counts as the last answer being rejected rather
 * than the server asking for something new. Rejection comes back within a
 * round trip; this only decides the wording.
 */
const REFUSED_WINDOW_MS = 15000;

interface SessionAuth {
  /** One dialog per challenge: a page's other requests wait on the same answer. */
  asking: Map<string, Promise<AuthAnswer | null>>;
  /** When each challenge was last answered, for the retry wording. */
  answeredAt: Map<string, number>;
}

/** Kept per partition, so one profile's dialog never answers another's. */
const bySession = new WeakMap<Session, SessionAuth>();

function stateFor(ses: Session): SessionAuth {
  let state = bySession.get(ses);
  if (!state) {
    state = { asking: new Map(), answeredAt: new Map() };
    bySession.set(ses, state);
  }
  return state;
}

export function installAuthHandler(promptFn: PromptFn): void {
  app.on('login', (event, contents, details, authInfo, callback) => {
    // Nothing to show a dialog over, and nobody who asked for it: main-process
    // fetches (favicon probes, search suggestions) go on unauthenticated.
    if (!contents) {
      callback();
      return;
    }
    event.preventDefault();

    const state = stateFor(contents.session);
    const key = challengeKey(authInfo);
    const lastAnswer = state.answeredAt.get(key) ?? 0;
    const prompt: AuthPrompt = {
      address: displayAddress(authInfo),
      realm: authInfo.realm.slice(0, MAX_REALM),
      isProxy: authInfo.isProxy,
      retry: Date.now() - lastAnswer < REFUSED_WINDOW_MS,
      insecure: !authInfo.isProxy && !details.url.startsWith('https:')
    };

    let ask = state.asking.get(key);
    if (!ask) {
      ask = promptFn(contents, prompt).catch((err) => {
        logError(`sign-in for ${prompt.address}`, err);
        return null;
      });
      state.asking.set(key, ask);
      void ask.then(() => state.asking.delete(key));
    }

    void ask.then((answer) => {
      if (!answer) {
        log(`sign-in for ${prompt.address} cancelled`);
        callback();
        return;
      }
      const now = Date.now();
      for (const [seen, at] of state.answeredAt) {
        if (now - at > REFUSED_WINDOW_MS) state.answeredAt.delete(seen);
      }
      state.answeredAt.set(key, now);
      callback(answer.username, answer.password);
    });
  });
}

/**
 * What a challenge is. A realm is the server's own division of one host into
 * separately guarded areas, so it belongs in the key; a proxy's challenge is a
 * different thing from the site's and never shares one.
 */
function challengeKey(authInfo: Electron.AuthInfo): string {
  const kind = authInfo.isProxy ? 'proxy' : 'site';
  return `${kind}|${authInfo.host}|${authInfo.port}|${authInfo.scheme}|${authInfo.realm}`;
}

/** The asking server as a person reads it — the default ports say nothing. */
function displayAddress(authInfo: Electron.AuthInfo): string {
  const { host, port } = authInfo;
  return port && port !== 80 && port !== 443 ? `${host}:${port}` : host;
}
