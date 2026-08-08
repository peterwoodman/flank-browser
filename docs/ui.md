# Flank — UI Specification

Theme: Flank follows the OS light/dark setting; there is no in-app theme
switch.

Adaptive chrome: each web view's toolbar and address bar take their page's
colors — the site's `theme-color` meta tag, falling back to the computed body
background/text, with the foreground adjusted for contrast. Colors are not
sampled once at load (a page's real colors settle asynchronously as dark
stylesheets load or SPAs swap their `theme-color`); instead the page reports
its colors whenever they change, so the two sections showing the same page
converge on the same value rather than each capturing a different transient
state. The window title bar and the window's dark/light theme follow the
**left** section's active page; showing home resets to defaults. Pages that
declare no CSS `color-scheme` get one injected to match the detected colors, so
the engine renders scrollbars and form controls in the page's colors instead of
the system theme's.

> **Windows and Linux:** the tint reaches the native caption
> (minimize/maximize/close) buttons too, through the window controls overlay.
> **macOS:** the standard traffic lights are not tintable, so they stay as
> the system draws them.

Backdrop: chrome canvases that would otherwise read as flat panels — the
Manager window and a section's home view — carry a wash over the theme
background: light lifting off the top edge, an accent veil throughout, and the
accent pooling at the bottom. It runs top to bottom with no variation across
the width, so the native caption-button strip, which can only take one flat
color, can match it instead of showing as a patch. The wash is anchored to the
window rather than to each surface, so the title bar and both sections form one
continuous image rather than each restarting the gradient. In a space window it
covers the title bar only while the left section is home — with a page there,
the title bar wears that page's adaptive color — and a section showing a page
has no wash of its own.

Color scheme: each space picks the accent its wash is mixed from, from a fixed
palette — Azure (the default), Lagoon, Fern, Amber, Ember, Rose, Iris,
Graphite — so its windows are recognizable at a glance. A scheme is only that
accent: light and dark variants of one hue, since the base, the glow, and the
strength of the veil still follow the OS theme. Nothing else in the chrome is
recolored; buttons, selection, and focus keep the theme accent. The Manager
window is not a space and keeps the theme accent for its own wash.

Motion: chrome surfaces use Fluent-style motion. Flyouts, menus, and
dropdowns enter with a short fade + slide from their anchor (~190 ms,
decelerating); dialogs and their dimmed backdrop fade in with a slight
scale-down (~250 ms); control hover/press states transition (~80 ms) and
pressed tiles compress slightly; adaptive chrome color changes ease
(~200 ms) instead of flashing. Controls use the platform arrow cursor, not
the web pointer hand. Motion is disabled when the OS reduced-motion setting
is on.

## Launch and activation

There is no system tray or background residency; windows are the only UI.

- **Launching Flank** (Start menu, pinned icon) reopens the spaces that
  were open in the last session, with the **Manager window** — the front door
  and launcher — behind them; with none to restore the Manager opens
  in front. If Flank is already running, a second launch focuses an open window
  instead (single instance).
- **`--space <name or id>`** as a command-line argument opens that
  space directly (names are matched case-insensitively; quoted names with
  spaces work). This enables pinned per-space shortcuts, and it also
  routes into the running instance.
- **The Manager stays open behind the spaces** — a space window simply opens
  in front of it, and Flank never minimizes or otherwise rearranges it on its
  own — so the hub is always one window away, and closing the last space
  window brings it forward rather than leaving you with nothing. It is a real
  window, not a hidden one, so the desktop lists it and treats it like any
  other: that is what keeps leaving Flank predictable, with no guessing about
  who closed a window. Closing the Manager itself while a space is open takes
  the hub away until the next space opens.
- **The Spaces button** (grid icon) belongs to the **left** section — at the
  far end of its toolbar when it shows a page, and in the bottom-left corner of
  its home view. It brings the Manager back up. Spaces are switched through the
  Manager rather than from a menu inside the space window, so there is one place
  where every space lives.
- **Closing the last window exits Flank** — including the desktop's "close all
  windows", which reaches the background Manager along with the space windows.
  Sessions are saved on every window close (and autosaved), so reopening a space
  restores its pages.

## Manager window

A single window (at most one instance) that doubles as the app's launcher, so
it is styled like the space windows (same title bar treatment) rather
than like a settings page. It remembers its own size/position. Default size
660×560. The app version sits in small muted print in the bottom-right corner
of the window, below whichever view is showing — the one place a build
identifies itself, since there is no About dialog.

- **Space grid** (the main view) — one tile (132×132) per space
  showing a montage of up to four home-link favicons (falling back to the
  space's initial letter), the name, and a green dot when its window is
  open (refreshed whenever the Manager regains focus). Each tile is tinted with
  its space's color scheme — flat rather than the full wash, which reads as
  noise at tile size. Click a tile to
  open/focus the space. Right-click for Open / Edit space / Delete / Move up
  / Move down — Delete asks for confirmation, removes the space's session
  file and its entry everywhere, and never touches the profile's browsing data,
  which its other spaces share. A trailing "＋ New space" tile creates one
  (name prompt) in that profile, with the default color scheme.
  - **Edit space** opens a dialog holding the space's name and its color
    scheme: one swatch per scheme in the palette, each painted with the wash it
    produces over the current theme rather than as a bare color chip. Saving
    applies both at once, and an open window for that space repaints
    immediately — wash and caption buttons — with no restart.
- **Profiles** — the grid is one row of tiles per profile (`behaviors.md` →
  Profiles), each separated from the one above by a rule and labelled with the
  profile's name; clicking the name renames it. With a single profile there is
  no rule and no label: the launcher is just its spaces, and profiles cost
  nothing to whoever never adds one. Each row ends in its own "＋ New space"
  tile, so a new space is always created in a named profile rather than a
  default one.
  - **＋ Add profile** sits at the bottom of the canvas — the position and style
    the home view's "Add link" has — pushed there while the tiles don't reach
    it. It asks for a name and appends an empty row.
  - **Remove profile** appears as a tile beside "＋ New space", only on a
    profile holding no spaces and only while another profile exists (a space has
    to have somewhere to browse from). It confirms first, and takes that
    profile's cookies, logins, and cache with it.
  - **Dragging a space tile onto another profile** copies it there, after a
    confirmation naming both. The copy keeps the name, color, and pinned links,
    but browses as its new profile — so it starts signed out. Spaces are copied
    rather than moved: which profile a space browses as decides which logins it
    sees, and moving one would silently change the pages it shows.
- **Settings** — behind the gear button in the title bar (the gear becomes a
  back arrow while open): search engine URL template, search suggestions URL
  template, launch-at-login toggle, toolbar position (side or top of each
  section), background tab timeout (minutes), how many background tabs are
  kept loaded past that timeout, and extension management (add unpacked
  folder, import from another browser, enable/disable, remove).
  - **Import from another browser…** opens a dialog that scans the machine's
    other Chromium browsers on open ("Looking for installed browsers…") and
    lists what it finds: icon, name, and the browser, profile, and version it
    came from. Each row has a checkbox; ones Flank already has are shown
    dimmed and can't be selected. The list scrolls once it outgrows the
    window. Importing copies the selected extensions and returns to settings,
    where they appear in the list — active after the next restart, like any
    extension change. With nothing found, the dialog says so rather than
    showing an empty list, naming the browsers it searched.

## Space window

One window per space; its title bar shows the space icon and the window title (a
normal-height title bar with no extra controls). The title tracks the **left**
section's active page — `space name - page title` — and falls back to just the
space name on the home view. Windows appear in the taskbar normally and stack
like any multi-window app. Closing the window saves the session. Default size
1400×900; size/position/maximized state are remembered per space.

A space window can also own **popup windows** — small framed windows a page
opened for a sign-in, consent, or payment flow (docs/behaviors.md →
Navigation routing). They float above their space window, close with it, and
are titled `page title — host` so the site asking for credentials is
identifiable without an address bar.

### Layout

```
┌───────────────────────────────────────────────┐
│  Title bar: <Space name>            [⊞]   │
├───────────────────────┬─┬─────────────────────┤
│  Left section         │║│  Right section      │
│  (Home view or        │║│  (optional,         │
│   Web view)           │║│   Home or Web view) │
│                       │║│                     │
└───────────────────────┴─┴─────────────────────┘
                         ▲ SplitBar (drag to resize, 50/50 default)
```

- The left section is always present.
- The right section appears when a link opens a new page, or when the user
  clicks "Open right view" in the left toolbar. It is removed with the
  toolbar's "Close view" button; the remaining section expands to full width.
- The split ratio is remembered per space; dragging clamps to 15–85%.
  Sections are resized only by dragging the splitter or with `Shift+Left`/
  `Shift+Right` (each tap moves the splitter 5% of the window width, same
  clamp) — the width does not change automatically based on which section the
  pointer is over.

### Home view

A launcher-style page, no browser chrome, over the backdrop wash described
above:

- **Search/URL box** centered near the top. Enter a URL to navigate; anything
  that isn't URL-shaped goes to the default search engine. While typing, a
  dropdown suggests matching home links and engine completions (see
  `behaviors.md` → Search suggestions).
- **Link grid** below: icons + titles, like a mobile app launcher. Activating
  a link navigates this section to web view (see `behaviors.md` for routing).
- Grid management: right-click a tile for Edit / Remove; a **＋ Add link**
  button below the grid — pushed to the bottom of the canvas while the links
  don't fill it — opens a small dialog (URL, title, a **Navigate in place**
  checkbox — see `behaviors.md` → Navigation routing; icon auto-fetched from
  favicon), centered over **this section** and never obscured by the other
  section's page; tiles reorder via drag & drop.
- An **✕ button** in the top-right returns to the page view this section was
  showing before going home. On the left it only appears when there is a page
  to return to (hidden on fresh sections, after the tab was evicted, or after
  the section was closed and its views unloaded). On the **right** section it
  is always shown: with no page to return to, it closes the right section.
- The **1-shot window** and **Spaces** buttons sit in the bottom-left corner of
  the left section's home view, the same pair that ends its page toolbar.

### Web view (WebSection)

A strip of icon buttons — the section's **toolbar** — then the browser view
filling the rest, with no tabs. The toolbar runs down the section's left edge
or across its top, following the Manager's "Toolbar position" setting: it
applies to every section of every space window and takes effect immediately,
with no restart.

An address/search bar shows across the top of the section when the page is
**not** one of the space's home links — searches, promoted pages, and other
unpinned excursions, in either section. Pages on a home link's host (redirects
and SPA routes included) keep the minimal, bar-less chrome. The rule is
identical for both sections, so pinning the current page always hides the bar.

The toolbar's **Address bar** button overrides that default for its section:
it flips whatever is showing now — reveal the bar on a pinned site, or hide it
on an unpinned one — and the override holds through navigation until the
section is closed or a different page is picked from home (returning from home
to the same page keeps it). Without a press it changes nothing; the home-link
rule stays in charge.

Toolbar buttons, in order — top to bottom on the side, left to right on top:

| Button | Placement variant | Action |
|---|---|---|
| Open right view | **left** section only; hidden while the right section is already open | Opens the right section (home view) |
| Close view | **right** section only | Closes this section; the left section expands |
| Move page to left | **right** section only | Moves this page into the left section without reloading it, and closes the right section; the left section's trail continues beneath the moved page's own (`behaviors.md` → Sections lifecycle) |
| Back | both; visible only while the browser can go back (and the view shows an http(s) page) | Steps back through the browser engine's history — unlike the trail, this reaches SPA route changes (pushState), which the trail collapses into one entry |
| Home | both | Switches this section to the home view |
| Refresh | both | Reloads the current page |
| Address bar | both | Shows/hides the section's address bar, overriding the home-link default until the section closes or a different page is picked from home |
| Trail | both; hidden unless the view has visited more than the current page | Expands the trail flyout (history of this view) |
| Extension icons | both | One icon per enabled extension, rendered grayscale to match the monochrome toolbar glyphs. Clicking opens the extension's popup in a small window anchored to the button — beside it, or below it when the toolbar is on top; extensions without a popup open their options page instead |
| 1-shot window | **left** section only; at the far end of the toolbar beside Spaces, and also on the home view | Opens a 1-shot window in this space's profile (see below) |
| Spaces | **left** section only; pushed to the far end of the toolbar (bottom on the side, right on top), and also on the home view | Opens (or focuses) the Manager window |

Each section has its own toolbar; buttons act on that section's view only. The
trailing pair — 1-shot window and Spaces — are the exception: only on the left,
pushed to the toolbar's far end, and shown on both the page toolbar and the home
view (where they sit in the bottom-left corner regardless of the toolbar's
position); they open a window rather than acting on the view. Flyouts open from
the toolbar edge: beside it when it is on the side, below it when on top.

While a page is loading, a thin indeterminate progress bar sits at the top of
the section's content area, tinted with the page's adaptive colors. It appears
when a document navigation starts and clears on the first of several completion
signals — navigation completed, the page's DOM ready / load event, a download
starting, or a crash — with a watchdog timeout as a final backstop so it can
never spin indefinitely. Same-document route changes (SPA
`pushState`, `#fragment`) don't trigger it. It is indeterminate rather than a
filling bar because the engine reports navigation lifecycle events but no
load-progress percentage, and it watches for several completion signals
because some navigations — downloads, streamed responses, navigations
superseded elsewhere — never report completion at all.

When a home link is launched (or restored) in the left section, a PWA-style
splash covers the view while its page loads: the link's icon and name centered
on the app's manifest `background_color` (a theme-neutral canvas when the app
declares none). It clears as soon as the page is ready (the same signals that
clear the load bar).

When a page is not there to show, a panel takes the view's place in the same
hole, centered, with the action that answers it (`behaviors.md` → When a page
doesn't arrive):

- **A crashed renderer** — "This page crashed", with Reload.
- **A navigation that failed** — the host and what happened to it in plain
  words, with **Try again**; or, when a certificate was refused, what is wrong
  with it and **Continue anyway**, noted as trusting the host until Flank
  quits.
- **A page that stopped responding** — **Wait** or **End page**.

#### Trail flyout

An expandable panel anchored to the Trail button listing this view's history,
newest first: title, URL, time. Clicking an entry navigates the view to it.
Each entry has an ✕ affordance to remove it individually. A "Clear trail"
action sits at the bottom. The trail persists across restarts (see
`data-model.md`).

#### Address bar

A bar across the top of a section, styled like the toolbar (adaptive page
colors included). Shown whenever the current page isn't from a home link —
matching is by host, case-insensitive, ignoring a `www.` prefix — or whenever
the toolbar's Address bar toggle says so (above).

- **Address/search box** — shows the current URL; type a URL or search terms
  and Enter navigates this view in place (same URL-vs-search rules as the
  home search box). The text follows navigation unless the box is focused.
  While typing, a dropdown suggests matching home links, this view's trail
  entries, and engine completions (see `behaviors.md` → Search suggestions).
- **Pin to home** button — adds the current page to this space's home
  grid (icon and title pre-filled from the page's web app manifest when it has
  one, else the live favicon and document title — see `behaviors.md` → Favicons).
  Hidden when the page is already on a home link's host — on a bar the toggle
  revealed over a pinned site, there is nothing left to pin.

## 1-shot window

A plain browser window for the errand that doesn't belong in a space: check a
link someone sent, sign in to something once, look one thing up. Opened from the
**1-shot window** button beside Spaces — in the left toolbar or on the home view
— and it browses in the profile of the window that opened it, so it is the same
identity, cookies and logins included, as the space it came from.

```
┌───────────────────────────────────────────────┐
│  Title bar: 1-shot - <page title>          │
├─┬─────────────────────────────────────────────┤
│▣│  Address bar                                │
│↻├─────────────────────────────────────────────┤
│ │  Page                                       │
└─┴─────────────────────────────────────────────┘
```

The title bar reads `1-shot - page title`, falling back to `1-shot` before a
page has one — the same shape as a space window's title, with `1-shot` standing
in for the space name.

It is the space window's web view with everything space-specific taken out:

- **No home** — no home view, no Home button, nowhere to return to. The window
  starts on a page and stays on pages.
- **The address bar is always there**, with no *Pin to home* button: there is no
  home grid to pin to, and nothing to hide the bar for.
- **No trail**, so no Trail button and no flyout — this window keeps no history
  of where it has been (`behaviors.md` → 1-shot windows).
- **One pane**: no split, no right section, and so none of the buttons that
  open, close, or move a page between sections.
- The toolbar keeps **Back**, **Refresh**, and the **extension icons** —
  extensions are what make signing in here work — and follows the same toolbar
  position setting as a space window. Adaptive page colors, the load bar, the
  panels for a page that crashed, failed, or stopped responding, find-in-page,
  downloads, the sign-in, certificate, permission and screen-share dialogs, and
  popup windows all behave as they do in a space.

What it opens on is a setting (Manager → Settings → *1-shot window opens on*):
an empty page, the search engine's own home page, or a page of the user's
choosing. Default 1100×800; nothing about a 1-shot window is remembered — not
its size, not its position, not what it was showing. Closing it discards it, and
launching Flank never brings one back. Any number can be open at once, and each
is independent of the window that opened it (which can close first).

## Keyboard and pointer shortcuts

| Shortcut | Action |
|---|---|
| `F5` / `Ctrl+R` | Refresh focused view |
| `Alt+Left` | Back through the trail in the focused view (intercepted by a content script; walks the trail, not engine history) |
| `Shift+Left` / `Shift+Right` | Move the section splitter 5% left/right per tap (only when the right section is open; ignored while editing text or with an active selection) |
| `Shift+click` on a link | Flip the target section: the link opens on the left from either view (see `behaviors.md` → Navigation routing) |
| `Ctrl+F` | Find in page |
| `Ctrl+scroll` / `Ctrl+±` | Zoom the focused view (not persisted) |
| `Escape` | Close open flyout |

Deliberately absent: `Ctrl+T` (no tabs) and `Ctrl+L` (no always-present
address bar).

Shortcuts must work wherever focus sits, and while browsing that is the page,
not Flank's chrome. `Alt+Left` and `Shift+click` are therefore intercepted by
the content script — the engine's own handling of them would use engine
history and open a real OS window. `Shift+Left`/`Shift+Right` are handled from
both sides (the chrome view when a Flank control has focus, the content script
when the page does), and both skip the keys while a text field is being
edited.
