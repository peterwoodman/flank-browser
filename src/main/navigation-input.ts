/**
 * Turns free-form search box input into a navigable URL:
 * URL-shaped input navigates directly, anything else becomes a search.
 */
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

  return searchTemplate.replace('{query}', encodeURIComponent(input));
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
