# Flank — Behaviors

Rules for navigation, sections, trails, and browser features. UI layout is in
`ui.md`; persistence formats are in `data-model.md`.

## Navigation routing

The core idea: **the page you launch stays put in its section; leaving that
page opens the right section.** Opening a link from home fills the same
section with that page (a single-page web app can occupy the full window
alone). Only when a link inside that page navigates away does the right
section come into play. Origin does not matter: any user-initiated full
navigation leaves the pinned page, so SPAs stay in one pane while opened
links land in the other.

| Trigger | Result |
|---|---|
| Home grid link activated / search submitted | Navigates the **same** section from home to web view. The right section does not open. |
| In-page link in the **left** web view causing a full top-level navigation | Opens in the **right** section (opening it if closed; replacing its current page if already open — the right view's trail keeps the replaced page recoverable). The left view stays pinned on its current page. |
| SPA route changes, `#fragment` / pushState, reloads, redirects, back/forward, form submissions, and script-initiated navigations (redirect bounces, SSO hops) | Stay in place — these are the launched page doing its own thing, not leaving it. |
| In-page link in the **right** web view | Navigates the right view in place. The right view is the free-browsing pane. |
| Page requests a new tab (`target=_blank`, plain `window.open`) | From the left view: opens in the **right** section. From the right view: navigates the right view in place. No OS window is created. |
| Page requests a sized popup (`window.open` with window features — sign-in, consent, and payment flows) | Opens as a real popup window belonging to the space window, titled with the page's origin since a popup has no address bar. Links out of it follow the rules above. |
| **Shift+click** on an in-page link | Flips the target section — the link opens on the **left** either way: from the left view it navigates the left view in place (instead of routing right); from the right view it opens in the left view (the right section stays open, unlike "Move page to left"). |
| Trail entry clicked, Home/toolbar actions | Explicit Flank UI actions always act on their own view in place. |

Form-submission detection: a content script reports `submit` events; any
navigation within ~3 seconds of one is treated as a form navigation and stays
in place. (POST data cannot be transplanted to another view, and this keeps
logins working.)

URL-vs-search detection for search/address boxes: input that parses as a URL
(has a scheme, or is domain-shaped like `example.com/path`) navigates
directly; anything else is substituted into the `searchTemplate` from
settings.

Popup requests are the one case that becomes a real window, because sign-in
flows need a live opener: the provider hands the credential back through
`window.opener` (or a channel keyed to it), and a page whose `window.open`
returns nothing is read by auth libraries as a blocked popup, abandoning the
sign-in. Tab-style requests carry no such requirement and stay in-app.

Telling a user's navigation from a script's is the crux of the rules above,
and the engine does not say which is which: `will-navigate` carries no
user-initiated flag. The content preload therefore reports input gestures
(primary-button `pointerdown`, `Enter`), and a navigation within ~2.5 s of one
counts as user-initiated and routes; anything else is treated as a script
navigation and stays in place. Flank's own `loadURL` calls never raise
`will-navigate`, so they are never mistaken for either. Shift+click likewise
has to be caught in the page (`preventDefault` on `http(s)` anchors, then post
the URL to the host), because the engine's native shift+click opens a new OS
window.

## Left-view tabs (keep-alive)

Each home grid link behaves like a tab in the left section. Opening a link
creates a live web view for it; going Home and opening another link keeps the
previous one loaded in the background. Activating the same link again resumes
the page exactly where it was — scroll position, playing state, SPA state —
with no reload.

- Backgrounded tabs are evicted (fully unloaded) after a configurable idle
  period (`backgroundTabMinutes` in settings, default 30). Reopening an
  evicted link reloads the page.
- Each tab has its own trail.
- Searches from the home view share a single ad-hoc tab; a new search
  replaces its page.
- This applies to the **left** section only. The right view is one
  free-browsing pane and is unloaded when the section closes.
- Session restore brings back the active left page; background tabs reload
  on demand when their links are next activated.

## Sections lifecycle

- The window always has a left section. The right section exists only when
  opened (by routing above or the toolbar button).
- **Close view** (right toolbar) closes the right section; the left expands.
- **Move page to left** (right toolbar) navigates the left view to the right
  view's current page, then closes the right section. The left view keeps
  its existing trail with the promoted URL appended on top (a normal
  in-place navigation of whatever the left is currently showing).
- Closing the right section keeps its trail in the session file, so
  reopening the space later can restore it — but opening a *fresh* right
  view via "Open right view" starts at home with the previous right trail
  still intact.
- A hidden or closed view must actually stop: closing the right section
  unloads its page (navigates to a blank page internally, keeping the
  trail), otherwise media would keep playing invisibly.
- Split ratio changes (by dragging) are saved per space.

## Trail (per-view history)

The trail replaces conventional back/forward UI and browser history.

- Every committed top-level navigation in a view appends an entry (URL,
  title, timestamp) to that view's trail, newest first.
- Redirect chains record only the final URL (entries are recorded at
  navigation completion). Same-document navigations (`#fragment`, pushState)
  update the newest entry's URL rather than appending.
- Consecutive duplicates collapse into one entry (timestamp refreshed).
- Entries are individually deletable from the trail flyout; there is also
  "Clear trail".
- Trails persist across restarts in the session file, capped at 500 entries
  per view (oldest dropped).
- `Alt+Left` walks down the trail (to the older entry below the current one).
- The toolbar **Back** button is different: it steps through the browser
  engine's own history, which is the only way to reach SPA route changes
  (pushState) — the trail records those as an in-place update of the newest
  entry. The button shows only while the engine can go back.

## Session restore

- On window close: save `left`/`right` state (mode, URL, trail) and window
  bounds, then dispose the web views.
- On space open: restore window bounds, restore the left section (home
  or its last URL) and the right section if it was open at close time.
- Window placement is never captured from a minimized window (it reports an
  off-screen position and a title-bar-sized rect), and implausible saved
  bounds (smaller than 300×200 or far off-screen) are ignored on restore in
  favor of the default size.
- Autosave every ~30 s while open guards against crashes.

> **Linux:** restoring a window's position requires an X11 session. Under
> Wayland the protocol reserves placement for the compositor, so it alone
> places windows and only the size is restored.

## Startup

- A plain launch reopens the spaces that were open in the last session
  (`openSpaces` in settings). Closing a single window mid-session removes it
  from that set (you're "done" with it). Closing the *last* window is treated
  as quitting the app, not the space, so it stays remembered — and when several
  windows close together in a rapid burst (the taskbar's "close all windows",
  or a shutdown), the whole burst is remembered so they all reopen, not just the
  last one to close. With nothing to restore, the Manager window opens.
- `--space <name or id>` opens exactly that space instead (no
  session restore of the others).
- Optional "launch at login" setting; at login this restores last session's
  spaces like any plain launch.
- The Manager window remembers its own size/position (in settings).
- Second launches route into the running instance: with `--space` they
  open/focus that space, otherwise they focus an open window (or the
  Manager).

> **Linux:** launch-at-login is an XDG autostart `.desktop` entry the app
> writes itself; Windows and macOS use the OS login-items API.

## Search engine

Defined in settings as a URL template with a `{query}` placeholder. Default
is Qwant (`https://www.qwant.com/?q={query}`). Used by the home view search
box and the sections' address bars.

## Search suggestions

Both free-form entry points show an autocomplete dropdown while typing:

- **Local matches first**: home grid links (pin icon), then — in the address
  bar — this view's trail entries (history icon), up to 3 of each, matched
  case-insensitively against title and URL, deduplicated by URL. Picking one
  navigates directly to its URL; in the home view a link match opens its
  keep-alive tab.
- **Engine completions below** (search icon), fetched from the suggest
  endpoint in settings (`suggestTemplate`, default Qwant's
  `api.qwant.com/v3/suggest`). Requests are debounced (~200 ms), the newest
  query cancels in-flight ones, and the list caps at 8 rows total.
- The suggest endpoint is configured separately from the search template
  (suggest URLs cannot be derived from search URLs). Three response formats
  are recognized: Qwant v3 (`data.items[].value`), OpenSearch arrays
  (Google, Wikipedia), and DuckDuckGo (`[{phrase}]`).
- Privacy: typed text is sent to the suggest endpoint as you type. Clearing
  the template in settings disables remote suggestions; local matches
  remain.

## Favicons (home grid tiles)

- The icon shown on a home tile is the best icon the page offers — captured
  live when a page is pinned and whenever a home-link tab loads, so tiles
  distinguish services that share a domain (e.g. Gmail vs Calendar).
- Sources are tried in order of quality: (1) the site's **web app manifest**
  icons (its own installable app icons, fetched same-origin so cookies apply;
  `any`/unspecified purpose is preferred over padded `maskable`, `monochrome` is
  skipped, largest raster wins); (2) the page's declared `<link>` icons (largest
  raster — `link rel=icon` `sizes`, `apple-touch-icon` counts as 180 px when
  unsized); (3) the engine's own tab-sized favicon as a last resort, which
  upscales blurry. SVG entries are skipped and non-image responses are rejected.
- Pinning also takes the tile's title from the manifest's `short_name`/`name`
  when present (a stable app name), falling back to the document title.
- Capture happens at most once per page per view session (badge favicons
  that update constantly are ignored), and a tab navigated away from its
  link's host cannot overwrite that link's icon.
- Links that have never been opened fall back to fetching the site's own
  `/favicon.ico` (host:port-specific, so LAN services on different ports get
  distinct icons; non-image responses rejected), then a domain-level icon
  service (DuckDuckGo's). Failed sources are attempted once per app run.
- See `data-model.md` for cache layout.

## Extensions

- Essentials only, loaded as unpacked Chromium extensions into the shared
  browser profile.
- Managed in the Manager window (add folder — must contain `manifest.json`;
  enable/disable; remove). The installed set is reconciled with settings
  **once per app session**, on the first web view that initializes —
  extension changes take effect after an app restart.
- Reconciliation tolerates failures: engine-built-in extensions (e.g. the
  PDF viewer) appear alongside user ones and cannot be removed; failures are
  logged and skipped rather than allowed to break view initialization.
- Each enabled extension gets a toolbar icon per section; clicking it opens
  the extension's popup (`action.default_popup`, MV2's `browser_action` also
  recognized) anchored to that button — beside it, or below it when the
  toolbar is on top. The popup is a browser view on the shared profile, so
  extension login state carries over. The popup loads
  on open and unloads on close, like a browser toolbar popup; `window.close`
  and link-outs from the popup are honored. Extensions without a popup fall
  back to opening their options page.

> **Linux:** anchoring a popup to its button requires an X11 session, for the
> same reason window positions do; under Wayland the compositor places the
> popup over its space window.

Extension support is partial and accepted as such: the engine implements only
part of the `chrome.*` surface (`chrome.webRequest` is missing, so content
blockers degrade), and extensions leaning on unimplemented APIs may not work.
See `architecture.md` → Extensions.

## Downloads

The browser engine's default download experience is used as-is: downloads go
to the user's Downloads folder and progress shows in the engine's built-in
download UI. No custom download manager.

## Media, permissions, and dialogs

- Permission prompts (camera, mic, location, notifications, clipboard,
  sensors, autoplay) surface through a simple allow/deny dialog naming the
  requesting host; the choice is remembered per origin (stored by the
  browser profile). Prompts are serialized — one dialog at a time.
- Screen sharing (a page calling `getDisplayMedia`, e.g. presenting in a
  video call) opens a picker of the screens and open windows, each with a
  preview; the page receives the one source chosen and nothing else. The
  answer is never remembered — a capture grant is too broad to hand out again
  without asking. System audio travels with the screen only where the
  platform can capture it.
- JavaScript dialogs, file pickers, print, and context menus use the browser
  engine's defaults. The context menu keeps "Open link in new window"-type
  items, but they route through the new-window handling above.

> **Linux (Wayland):** the compositor, not the app, owns screen capture, so
> nothing can be listed in advance and the desktop's own dialog does the
> choosing. Flank's picker shrinks to the question the system dialog cannot
> answer — which site is asking, and whether it should see a screen or a
> window — and the portal takes it from there. This needs a desktop portal
> with a ScreenCast backend installed (e.g. `xdg-desktop-portal-gnome` under
> GNOME); without one no browser can share a screen on that session.

## Zoom and find

- `Ctrl+scroll` / `Ctrl+±` zoom per view (engine built-in). Zoom is not
  persisted and not displayed.
- `Ctrl+F` uses the engine's find-in-page.
