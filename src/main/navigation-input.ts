import { defaultSettings } from '@shared/types';

/**
 * Turns free-form search box input into a navigable URL, and holds the scheme
 * rules the rest of the app applies to URLs handed to it from elsewhere (pages,
 * the content preload, settings).
 */

/** The only schemes Flank navigates a view to. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Whether a page's `window.open` may become a real window. The engine refuses
 * to let a page navigate itself to `file:` and other privileged schemes, but a
 * window the host opens on the page's behalf is a host navigation and skips
 * that check — so the scheme is tested here instead. A blank target is the
 * auth-popup case: the page opens an empty window and writes into it through
 * the opener.
 */
export function isPopupTarget(url: string): boolean {
  const target = url.trim();
  return target === '' || target === 'about:blank' || isWebUrl(target);
}

/**
 * A search or suggest template is usable only as an `http(s)` URL carrying a
 * `{query}` slot. Both are navigated to or fetched by the host with the user's
 * typed text in them, so a `file:` template would turn a search box into a
 * local file reader. Plain `http:` stays allowed for self-hosted engines on a
 * LAN, which have no certificate to offer.
 */
export function isValidTemplate(template: string): boolean {
  if (!template.includes('{query}')) return false;
  try {
    const { protocol } = new URL(template.replace('{query}', 'q'));
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function toUrl(input: string, searchTemplate: string): string {
  input = input.trim();

  try {
    const uri = new URL(input);
    if (uri.protocol === 'http:' || uri.protocol === 'https:') return uri.toString();
  } catch {
    /* not an absolute URL */
  }

  if (looksLikeDomain(input)) {
    try {
      return new URL('https://' + input).toString();
    } catch {
      /* fall through to search */
    }
  }

  // A template that got past settings validation (hand-edited settings.json)
  // must not become the navigation target.
  const template = isValidTemplate(searchTemplate)
    ? searchTemplate
    : defaultSettings().searchTemplate;
  return template.replace('{query}', encodeURIComponent(input));
}

/** Matches inputs like "example.com" or "example.com/path" but not "how to cook". */
function looksLikeDomain(input: string): boolean {
  if (input.length === 0 || input.includes(' ')) return false;

  const host = input.split('/', 1)[0];
  const lastDot = host.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === host.length - 1) {
    const lower = host.toLowerCase();
    return lower === 'localhost' || lower.startsWith('localhost:');
  }

  // The TLD part must be alphabetic (allows a trailing :port).
  const tld = host.slice(lastDot + 1).split(':', 1)[0];
  return tld.length >= 2 && /^[a-zA-Z]+$/.test(tld);
}
