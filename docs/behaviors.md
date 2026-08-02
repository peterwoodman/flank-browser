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
| Page requests a sized popup (`window.open` with window features — sign-in, consent, and payment flows) | Opens as a real popup window belonging to the space window, titled with the page's origin since a popup has no address bar. Only `http(s)` targets and blank ones qualify; anything else is refused. Links out of it follow the rules above. |
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
sign-in. Tab-style requests carry no such requirement and stay in-app. A blank
target counts as a popup because that is how those flows start — the page opens
an empty window and writes into it through the opener — but the scheme is
checked before any window is created: the engine stops a page from navigating
*itself* to `file:`, while a window the host opens on the page's behalf is a
host navigation that would skip the check.

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
- A page moved in from the right takes over the tab it replaces, so it resumes
  on that link like any other (see Sections lifecycle).
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
- **Move page to left** (right toolbar) moves the right view's page into the
  left section, then closes the right section. The page itself moves rather
  than being loaded again on the left, so it keeps its scroll position,
  playing media, typed-in form state, and its own engine back history. From
  there it follows the left section's rules, so a link that leaves it opens
  the right section again.
- A moved page takes over the tab of the page it replaces: move onto a home
  link's page and the moved page *becomes* that link's tab, so going Home and
  activating the link again resumes it, trail and all. The page it replaced is
  unloaded, and stays reachable through the trail beneath the moved page.
  Moving onto the left's home view replaces nothing and makes the moved page
  the ad-hoc page. Other background tabs are untouched.
- Closing the right section keeps its trail in the session file, so
  reopening the space later can restore it — but opening a *fresh* right
  view via "Open right view" starts at home with the previous right trail
  still intact. After a move to the left there is nothing to keep: the trail
  went with the page.
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
  per view (oldest dropped). A 1-shot window's page keeps no trail at all.
- A page moved between sections brings its trail with it, stacked on top of
  the trail of the page it replaced, so the receiving section's history reads
  as one continuation. Its engine history cannot be joined on in the same way
  — replaying entries into a live page would mean reloading it, which is the
  point of moving the page rather than its URL — so **Back** goes on walking
  the moved page's own history.
- `Alt+Left` walks down the trail (to the older entry below the current one).
- The toolbar **Back** button is different: it steps through the browser
  engine's own history, which is the only way to reach SPA route changes
  (pushState) — the trail records those as an in-place update of the newest
  entry. The button shows only while the engine can go back.

## 1-shot windows

A 1-shot window is a single free-browsing page, opened from a space window's
1-shot button (docs/ui.md → 1-shot window). Its rules are the ones the space's
*right* view already follows, minus everything a space provides:

- It browses in the **profile of the window that opened it** — the errand runs as
  the identity you were already browsing as, not a new one. There is no
  ambiguity to resolve: the button reports which window it was pressed in.
- **Every navigation lands in the same page.** In-page links, `target=_blank`,
  plain `window.open`, an extension's `chrome.tabs.create`, shift+click, and
  links out of a popup all load here, because there is no other section to route
  to. Sized popups still become real popup windows, so sign-in flows work.
- **Nothing is recorded.** Visits are not written to a trail (so `Alt+Left` does
  nothing), and no session file is written. The engine's own back stack still
  works, and the toolbar's **Back** button walks it.
- **Nothing is restored.** A 1-shot window is not remembered in `openSpaces`, has
  no saved bounds, and never reopens on launch. Closing it destroys its page.
- It is independent of the window that opened it: closing that space window
  leaves the 1-shot window alone, and closing the 1-shot window changes nothing
  about the space. Like any window, the app exits when the last one closes.

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
  (`openSpaces` in settings), with the Manager behind them. Closing a
  single window mid-session removes it from that set (you're "done" with it).
  Closing the *last* space window keeps it remembered — that ends the session
  rather than saying you're done with the space — and when several
  windows close together in a rapid burst (the taskbar's "close all windows",
  or a shutdown), the whole burst is remembered so they all reopen, not just the
  last one to close. With nothing to restore, the Manager window opens in front.
- `--space <name or id>` opens exactly that space instead (no
  session restore of the others), again with the Manager behind it.
- Optional "launch at login" setting; at login this restores last session's
  spaces like any plain launch.
- The Manager window remembers its own size/position (in settings).
- Second launches route into the running instance: with `--space` they
  open/focus that space, otherwise they focus an open window (or the
  Manager).
- Opening a space leaves the Manager where it is (the space window just opens
  in front; Flank never minimizes it); closing the last space window brings it
  forward. The Manager is only ever *recreated* by a launch or by opening a space, so
  closing every window (Flank's own last-window-closes exit, or the desktop's
  "close all windows") exits rather than bringing the hub back.

> **Linux:** launch-at-login is an XDG autostart `.desktop` entry the app
> writes itself; Windows and macOS use the OS login-items API.

## Profiles

A profile is a browsing identity. Every space belongs to exactly one, and that
profile's browser profile — cookies, logins, storage, cache — is what its pages
browse with, so the spaces in a profile share a signed-in state and see nothing
of any other profile's. It is the same separation two people using one machine
would get from two browser profiles, without a second app or a second data
folder.

- There is always at least one profile; a new install and an upgrade from a
  version without them both start with one named "Default", holding every
  existing space and keeping the browsing data that was already there.
- Profiles are created, renamed, and removed in the Manager (`ui.md` → Manager
  window). Only an empty profile can be removed, and removing it deletes its
  browsing data.
- A profile's storage is created the first time one of its spaces opens, so a
  profile nobody uses costs nothing on disk.
- **Extensions are app-wide**: one list, loaded into every profile. An
  extension's own stored state is not — logins and vaults live in the profile,
  so a password manager is signed in per profile, like it would be in any
  browser's profiles.
- Permission answers, the search engine, and the rest of settings are app-wide.
- `--space <name or id>` searches every profile. Two profiles may hold spaces of
  the same name (that is the point of copying a space into another profile), and
  a name that matches more than once resolves to the first profile holding it —
  the id is unambiguous where it matters.

## Search engine

Defined in settings as a URL template with a `{query}` placeholder. Default
is Ecosia (`https://www.ecosia.org/search?method=index&q={query}`). Used by the
home view search box and the sections' address bars.

A template only counts as usable if it is an `http(s)` URL containing `{query}`
— the typed text ends up in a navigation, so a `file:` template would turn the
search box into a local file reader. Plain `http:` stays allowed for engines
self-hosted on a LAN. An unusable template is refused on entry (the Manager's
field reverts to the kept value), and one that reached settings another way
falls back to the default.

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
  (suggest URLs cannot be derived from search URLs), and is held to the same
  `http(s)`-with-`{query}` rule. Three response formats are recognized: Qwant v3
  (`data.items[].value`), OpenSearch arrays (Google, Wikipedia), and DuckDuckGo
  (`[{phrase}]`).
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
- Icon fetches are made by the app rather than the page, so they answer to the
  app's rules rather than the page's: `http(s)` only, capped at 512 KB, and a
  loopback or private-network address is only fetched when the page (or link)
  asking for it lives on that host itself. A self-hosted app keeps its own icon;
  a public site cannot use a tile to probe what is listening on the machine.
- See `data-model.md` for cache layout.

## Extensions

- Essentials only, loaded as unpacked Chromium extensions.
- Managed in the Manager window (add folder — must contain `manifest.json`;
  enable/disable; remove). The list is app-wide and every profile gets all of
  it, loaded into that profile **once**, when its first space opens — extension
  changes take effect after an app restart.
- **Import from another browser** offers the extensions already installed in
  any Chromium browser on the machine (Chrome, Edge, Brave, Vivaldi, Chromium,
  and their beta/canary channels). Those browsers keep extensions unpacked on
  disk, so an import is a copy: Flank scans their profiles, lists what it
  finds with the browser and profile it came from, and copies each selected
  extension into its own data folder. An extension present in several
  browsers or profiles is offered once, at its newest version.
  - Copying, rather than loading from the browser's own folder, is what keeps
    the import stable: that folder is per-version and the browser deletes it
    when the extension next updates. The copy is Flank's own from then on —
    it does not update, and disabling or removing it in the other browser
    changes nothing here.
  - Extension ids are preserved, because a browser writes the extension's
    public key into the manifest when it unpacks it and Chromium derives the
    id from that key rather than the folder path. Anything keyed to the id —
    OAuth redirect URIs, allowlists — therefore still matches.
  - What does *not* come across is the extension's own stored state: logins,
    settings, and vaults live in the source browser's profile, not in the
    extension folder. An imported extension starts signed out.
  - Browser-bundled extensions (a PDF viewer, a web store connector) are
    listed alongside real ones when they exist on disk. They are harmless to
    skip, and Flank does not try to guess which are which.
- Reconciliation tolerates failures: engine-built-in extensions (e.g. the
  PDF viewer) appear alongside user ones and cannot be removed; failures are
  logged and skipped rather than allowed to break view initialization.
- Each enabled extension gets a toolbar icon per section; clicking it opens
  the extension's popup (`action.default_popup`, MV2's `browser_action` also
  recognized) anchored to that button — beside it, or below it when the
  toolbar is on top. The popup is a browser view on the space's profile, so
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

## When a page doesn't arrive

A navigation that fails leaves the engine showing nothing and saying nothing,
so Flank puts a panel in the view's place (`ui.md` → Web view) rather than
letting a blank rectangle stand for an answer. Every case below is also
written to `debug.log`.

- **The site could not be reached** — connection refused, name not resolved,
  timed out, connection reset, too many redirects, blocked by an extension,
  and the rest. The panel names the host, says which of those happened in
  plain words, and offers **Try again**, which re-navigates to the address
  that failed. Toolbar Refresh does the same thing on a failed page, since
  there is no loaded page to reload.
- **The certificate is not acceptable** — the panel says what is wrong with it
  (expired, self-signed, issued for another address) and offers **Continue
  anyway** instead of a retry. Continuing trusts that **host** for the rest of
  the run, in every window and profile, and loads the refused address. The
  allowance is held in memory only: a certificate trusted forever is a decision
  no one revisits, so quitting Flank forgets it. A self-hosted service on an
  expired or self-signed certificate is the case this exists for; a public site
  failing this way is worth a second thought, which is why the panel says so
  rather than offering a one-click bypass.
- **The page stopped responding** — a runaway script or a blocked main thread.
  The panel offers **Wait**, which puts it away and lets the page carry on, and
  **End page**, which ends the renderer (a hung one cannot be asked to close
  politely) and lands in the crash panel, where Reload starts the page over.
  If the page answers again on its own, the panel goes by itself.
- **The renderer crashed** — the crash panel, with Reload.

An aborted navigation is not a failure and shows nothing: in-flight redirects,
a navigation replaced by another, and a link that turned out to be a download
all end that way.

## Leaving a page with unsaved work

A page whose `beforeunload` handler asks to cancel a navigation gets a
**Leave / Stay** confirmation naming the risk to unsaved changes. This is the
one prompt Flank asks with the platform's own message box rather than its
chrome: the engine wants the answer synchronously and cancels the navigation
if nothing answers, which is how the navigation would otherwise appear to do
nothing at all.

The question is asked when a navigation would unload the page. Closing a
window does not ask — the engine does not consult a page's `beforeunload` for
the views Flank browses in — and neither does Flank unloading a page itself,
whether parking a hidden section or evicting an idle background tab. Those are
Flank's own housekeeping, not the user leaving, and there is no answer to
"stay" that Flank could act on.

## Media, permissions, and dialogs

- Permission prompts (camera, mic, location, notifications, clipboard,
  sensors, autoplay) surface through a simple allow/deny dialog naming the
  requesting host; the choice is remembered per origin in settings — app-wide,
  not per profile — since the engine keeps no such memory of its own. Prompts
  are serialized — one dialog at a time.
- Web APIs generally test a permission silently before asking for it, and that
  test is answered from the same remembered decisions: undecided reads as no, so
  the page goes on to ask and the dialog appears. This is what keeps
  `navigator.permissions.query` and `Notification.permission` from reporting a
  capability as granted that was never granted, or that was refused.
- Permissions Flank has no dialog for are refused rather than granted quietly.
  The exceptions are engine plumbing a dialog could not sensibly describe:
  fullscreen, storage persistence, background sync, wake lock, and the DRM
  handshake protected video needs before it will play.
- A server's HTTP authentication challenge (basic auth, and the same from a
  proxy) opens a sign-in dialog naming who is asking — the challenging host
  and its realm, which need not be the address on screen, since a subresource
  or a proxy can be the one asking — and warns when the connection is plain
  `http`, where the credentials would cross the network readable. Cancelling
  leaves the request unauthenticated, which is what the site sees as a refused
  sign-in. Requests the browser makes with no page behind them (favicon
  probes, search suggestions) are never authenticated and raise no dialog.
- A server asking the browser to identify *itself* with a certificate (mutual
  TLS) opens a picker of the certificates installed on the machine, each with
  its subject, issuer, and expiry, and a **Send none** answer — which is a real
  answer the server may accept or refuse, not a way of dodging the question.
  The choice is remembered per host for the run, and per profile, since which
  identity is presented is exactly what a profile separates. Left to itself the
  engine sends the first certificate in the store without asking, which with
  more than one installed is as likely to be the wrong identity as the right
  one.
- Flank remembers no credentials. The engine caches what a server accepts for
  the life of the profile's partition and re-sends it without asking, so the
  dialog appears only when nothing is cached or what was cached was refused —
  and a sign-in in one profile is never offered to another. Nothing is written
  to disk; quitting forgets it all.
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
