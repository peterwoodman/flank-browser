import { SpaceLink, TrailEntry } from '@shared/types';
import { SuggestionDto } from '@shared/space-types';
import { settingsStore } from './stores/settings-store';
import { isValidTemplate } from './navigation-input';

const MAX_LOCAL = 3;
const MAX_TOTAL = 8;
const FETCH_TIMEOUT_MS = 4000;

// One in-flight request per input box: a new query cancels the previous one.
const inflight = new Map<string, AbortController>();

/**
 * Builds the dropdown for a search/address box: local matches first (the
 * space's pinned links, then this view's trail), engine completions below,
 * deduped, capped at eight rows (docs/behaviors.md → Search suggestions).
 */
export async function buildSuggestions(
  boxKey: string,
  text: string,
  links: SpaceLink[] | null,
  trail: TrailEntry[] | null
): Promise<SuggestionDto[]> {
  text = text.trim();
  const results: SuggestionDto[] = [];
  if (text.length === 0) return results;

  const seenUrls = new Set<string>();
  const matches = (title: string, url: string): boolean =>
    title.toLowerCase().includes(text.toLowerCase()) ||
    url.toLowerCase().includes(text.toLowerCase());

  if (links) {
    for (const link of links.filter((l) => matches(l.title, l.url)).slice(0, MAX_LOCAL)) {
      seenUrls.add(link.url.toLowerCase());
      results.push({
        text: link.title.trim() ? link.title : link.url,
        url: link.url,
        linkId: link.id,
        detail: link.url,
        kind: 'link'
      });
    }
  }

  if (trail) {
    const trailMatches = trail.filter(
      (t) => matches(t.title, t.url) && !seenUrls.has(t.url.toLowerCase())
    );
    for (const entry of trailMatches.slice(0, MAX_LOCAL)) {
      seenUrls.add(entry.url.toLowerCase());
      results.push({
        text: entry.title.trim() ? entry.title : entry.url,
        url: entry.url,
        linkId: null,
        detail: entry.url,
        kind: 'trail'
      });
    }
  }

  const remote = await fetchEngineSuggestions(boxKey, text, MAX_TOTAL - results.length);
  const seenTexts = new Set(results.map((r) => r.text.toLowerCase()));
  for (const s of remote) {
    if (seenTexts.has(s.toLowerCase())) continue;
    seenTexts.add(s.toLowerCase());
    results.push({ text: s, url: null, linkId: null, detail: '', kind: 'search' });
  }

  return results;
}

/**
 * Fetches engine completions from the configured suggest endpoint. Empty on
 * any failure. Parses the three response shapes that cover common engines:
 * - Qwant v3:    {"status":"success","data":{"items":[{"value":"…"},…]}}
 * - OpenSearch:  ["query",["s1","s2",…]] (Google, Wikipedia, …)
 * - DuckDuckGo:  [{"phrase":"…"},…]
 */
async function fetchEngineSuggestions(boxKey: string, query: string, max: number): Promise<string[]> {
  // Validated on the way in too; a hand-edited settings.json must not point this
  // fetch — which runs in the host process — at something that isn't a web URL.
  const template = settingsStore.current.suggestTemplate;
  if (!isValidTemplate(template) || !query.trim() || max <= 0) return [];

  inflight.get(boxKey)?.abort();
  const controller = new AbortController();
  inflight.set(boxKey, controller);

  try {
    const url = template.replace('{query}', encodeURIComponent(query.trim()));
    const response = await fetch(url, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    });
    if (!response.ok) return [];
    return parse(await response.json(), max);
  } catch {
    return [];
  } finally {
    if (inflight.get(boxKey) === controller) inflight.delete(boxKey);
  }
}

function parse(root: unknown, max: number): string[] {
  const results: string[] = [];

  if (root && typeof root === 'object' && !Array.isArray(root)) {
    // Qwant v3
    const items = (root as { data?: { items?: unknown } }).data?.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const value = (item as { value?: unknown }).value;
        if (typeof value === 'string') results.push(value);
      }
    }
  } else if (Array.isArray(root) && root.length >= 2 && Array.isArray(root[1])) {
    // OpenSearch
    for (const item of root[1]) {
      if (typeof item === 'string') results.push(item);
    }
  } else if (Array.isArray(root)) {
    // DuckDuckGo
    for (const item of root) {
      const phrase = (item as { phrase?: unknown })?.phrase;
      if (typeof phrase === 'string') results.push(phrase);
    }
  }

  return [...new Set(results)].slice(0, max);
}
