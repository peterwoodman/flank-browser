# Flank — Architecture

How Flank is built. The behavior spec lives in `ui.md`, `behaviors.md`, and
`data-model.md`; this document covers only how that spec maps onto Electron.

## Summary

Flank is a single desktop application that opens one window per space, with
the Manager window as the launcher. Each space window is an Electron
`BaseWindow` hosting a full-window React "chrome" view plus pooled
`WebContentsView`s for browsed pages.

## Technology stack

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript / Node (main), TypeScript / React (chrome UI) |
| Shell framework | Electron (`BaseWindow` + `WebContentsView`) |
| Browser engine | Chromium (bundled with Electron) |
| Build | electron-vite (main/preload/renderer, HMR for the chrome UI) |
| Persistence | JSON files in the `Flank-Electron` userData folder |
| Extensions | `electron-chrome-extensions`, one instance per profile session |
| Packaging | electron-builder (zip/tar.gz, unzip-and-run; no installer) |

## Process model

- **Single instance.** `app.requestSingleInstanceLock` with the `--space`
  argument passed through `additionalData` (Chromium reorders `argv` for
  second instances, so positional parsing there is unreliable). The
  `second-instance` handler routes activation into the running app.
- **Lifetime.** The app exits when its last window closes
  (`window-all-closed` → `app.quit()`). Landing at the Manager after closing a
  space window is *not* an exception to that: `openSpace` keeps the Manager open
  (minimized) behind every space window, so the hub is restored rather than
  recreated, and an empty window list is unambiguously "leave". A hidden window
  would not do — the shell's "close all windows" only reaches windows it lists,
  so Flank would survive it invisibly, with no tray to get back in through. The
  Manager is never recreated on a space window's close, or that same teardown
  would resurrect it. No tray icon or background residency.
- **Processes.** One main process owns all windows, stores, and routing.
  Each `WebContentsView` (chrome UI and pages alike) renders in Chromium
  renderer processes.
- **Browser profiles.** Each Flank profile is one persistent Chromium partition
  (`persist:flank` for the first, `persist:flank-<profileId>` after that), and
  every content view of every space in it uses that partition — so cookies,
  logins, and cache are common to a profile's spaces and invisible between
  profiles. Partitions and the JSON stores share the app's own data folder
  (`Flank-Electron` under the platform's user application data directory;
  `userData` is pointed there, and the engine puts partitions in
  `Partitions/<name>/` beneath it).
  A partition is created on demand, when a profile's first space opens, which
  means nothing session-scoped can be installed once at startup the way it could
  with a single profile: permission, download, screen-share, and extension setup
  is registered as a *preparer* (`browser-session.ts`) and run against every
  session as it appears. Opening a space awaits its profile's extensions before
  the window exists, since a content script that isn't registered before a page
  loads never runs on it. Chrome UI views (Manager and space chrome) stay on the
  default session; they render Flank, not the web.
- **Identity.** Flank presents Chrome's user agent, not Electron's. Electron's
  default names the app and the framework between the Chrome and Safari
  tokens, and both sites and extensions read it: LastPass took it for the
  LastPass *desktop* app and ran a DOM-bound startup path that cannot work in
  a service worker, leaving its vault empty. Flank embeds Chromium, so it says
  so and nothing else.

## Window/view model

Each browsing window is a `BaseWindow` whose content view stacks:

1. **Chrome view** (bottom) — one full-window `WebContentsView` running the
   React app (title bar, toolbars, home views, address bars, flyouts, find
   bar, dialogs). Its background is transparent; the window's
   `backgroundColor` is the visible base.
2. **Content views** (top) — the pooled page views, positioned by the main
   process into "holes" the chrome reports over IPC (each `WebChrome`
   component measures its content area and sends the rect).

There are two kinds of browsing window — a space window and a 1-shot window —
and that stack is all they have in common with each other. The shell holding it
is therefore a base class (`ChromeWindow`): the window and its transparent chrome
view, content-view attachment and the layout holes, the overlay z-order dance,
permission and screen-share dialogs, popup adoption, the content context menu,
extension popups, caption tinting, and batched state pushes. What the window
*holds* is the subclass's: `SpaceWindowController` has two sections and a space's
rules, `OneShotWindowController` has one page and none. A window answers IPC
under an id its chrome carries in every message — a space id for a space window,
its own for a 1-shot one — so every channel about a *page* (layout, the address
bar, find, extensions, prompts) is shared, and only the channels about a *space*
(home links, split, trail, pin) resolve to a space controller.

A content view is a page, not a place. The two rules that differ by side —
whether a user navigation leaving the page routes to the other section, and
whether the page feeds a home link's tile icon and launch splash — are settings
the owning section applies (`pinned`, `linkId`), not facts fixed when the view
is built, and the window's routing callbacks resolve a view's side per event
(`sideOf`) rather than closing over the section that created it. That is what
makes "move page to left" a change of ownership instead of a reload: both
sections' views are already sibling children of the same window on the same
profile session, and layout is only a question of which rect each is given, so
handing the view from one section's tab pool to the other's (`release` /
`takeOver`) and running the next layout pass is the whole move. The view is
never detached in between, so the extension host has to be told the active tab
changed explicitly — the attach path it normally hears about does not run.

Flyouts and overlays over web content invert the stack: the chrome view is
raised to the top (transparent, so only the flyout paints), any outside
click light-dismisses in the chrome, and the chrome is lowered again. This
z-order dance is isolated in the window shell (`setOverlay`).
Transparency must hold through the whole stack: `setBackgroundColor('#00000000')`
is re-applied after every chrome load (loads reset it to the engine default),
and no CSS ancestor of a content hole may paint a background — a child's
`background: transparent` does not punch through its parent's paint, so an
opaque section wrapper would blank the pages whenever the chrome is raised.
Transparency has two traps: a load resets the view's background to the
engine default, so `#00000000` is re-applied on `did-finish-load`; and a
CSS background on any ancestor of a content hole paints *behind* the hole
and blanks the pages when the chrome is raised — chrome surfaces (toolbar,
address bar, home view) each paint their own background, never a shared
section-wide one.

The title bar is `titleBarStyle: 'hidden'` with `titleBarOverlay` (native
caption buttons) on Windows/Linux; the title text renders in the chrome view
and the overlay's symbol color follows the adaptive page colors. With no page to
follow, the strip takes the backdrop wash's color at the top of the window,
which main composites from the space's color scheme using the same base, veil,
and glow numbers as the CSS (`shared/color-schemes.ts`) so the two cannot drift
apart. Since the strip is painted outside the chrome's state snapshots, a scheme
change re-applies it explicitly rather than waiting for the chrome to report
colors it has no reason to re-report.

A space's scheme reaches the CSS as a light and a dark accent set on the chrome
root, and the stylesheet mixes the wash's veil and pool from whichever the OS
theme selects. Those mixes are re-declared in every scope that carries an accent
(the space root, and the Manager's tiles and swatches) rather than once on
`:root`: a custom property's `var()`s resolve in the scope that *declares* it,
so a tint derived on `:root` would keep `:root`'s accent everywhere it
inherited.

```
main process
├── window-manager        – open windows by id, openSpaces memory, burst-close
├── browser-session       – one partition per profile + per-session preparers
├── profiles              – space → profile session, removed-profile cleanup
├── stores/               – settings/spaces/sessions over atomic JsonFile
├── chrome-window         – BaseWindow + chrome view: layout holes, overlay
│                           z-order, prompts, popups, context menu, captions
├── space-window          – a space's two sections, routing, pin, session
│   └── section (×2)      – tab pool (keep-alive per home link + ad-hoc view),
│                           eviction timer, session capture/restore
│       └── content-view  – one WebContentsView: navigation routing, trail,
│                           colors, load/crash state, favicon capture, zoom
├── one-shot-window       – a single free-browsing page, nothing remembered
├── manager-window        – launcher window (BrowserWindow, same React app)
├── extensions            – electron-chrome-extensions per profile + buttons
├── favicons              – live capture + fallback fetch icon cache
├── permissions/downloads – session-level handlers → per-window chrome UI
├── screen-share          – display-media handler + source picker dialog
└── icons-protocol        – flank-icon:// serves cached and extension icons
```

## Preload scripts

- **`chrome.ts`** — the IPC bridge for Flank's own UI (`window.flank`:
  invoke/send/on, all channels namespaced `flank:`). The chrome renderer is
  a pure view of main-process state snapshots (`SpaceStateDto`,
  `OneShotStateDto`).
- **`content.ts`** — page instrumentation: shift+click interception,
  `Alt+Left`, `Shift+←/→` split
  nudges, form-submit reporting, the adaptive color reporter
  (theme-color/computed colors, re-reported on change), DOM-ready/load
  signals for the load bar, and Ctrl+wheel zoom.
- **`extension-compat.ts`** — registered on every profile session for extension
  frames and service workers, patching two holes in the API surface that make
  extensions fail on load rather than degrade (see Extensions below).

## Where the spec's behaviors attach

| Behavior | Electron mechanism |
|---|---|
| Navigation routing (leave the pinned page → right section) | `will-navigate` `preventDefault()` + a programmatic-navigation flag, since the event carries no user-gesture flag |
| New tabs and popups | `setWindowOpenHandler`: `deny` + route per `behaviors.md`, or `allow` for sized popups (`disposition: 'new-window'`) whose target is `http(s)` or blank — a window the host opens is a host navigation, so the engine's own scheme block does not apply to it |
| Page instrumentation (shift+click, gestures, colors) | the content-view preload |
| Extensions | `session.extensions.loadExtension` + `electron-chrome-extensions` |
| Single instance and activation | `requestSingleInstanceLock` + `second-instance` |
| Launch at login | `app.setLoginItemSettings` (Windows/macOS), XDG autostart `.desktop` (Linux) |
| Adaptive title bar | `titleBarOverlay` colors from the chrome's resolved page colors |

## Linux desktop integration

Two things a packaged Linux build must arrange for itself, since the release
is a plain archive with no installer:

- **Identity and icon.** The app writes an XDG desktop entry
  (`~/.local/share/applications/flank.desktop`) and its icon into the user's
  icon theme on every start, re-pointing both if the folder moved. Desktop
  environments pair a window with its launcher by matching the window's
  `app_id` (Wayland) or `WM_CLASS` (X11) against the entry's base name, and
  take the icon from the entry; unmatched windows get a generic icon. All
  three names are held equal to `flank` via `desktopName` in `package.json`,
  which is what Electron derives `app_id` and `WM_CLASS` from. The window
  `icon` option is set too, but it only reaches X11.
- **Display server.** Flank takes the session as it finds it — native Wayland
  under a Wayland session, X11 under an X11 one. The Wayland protocol forbids
  a client from placing its own windows (`setPosition` is a no-op), so there
  the compositor decides where windows and extension popups land: placement
  capture keeps the stored coordinates rather than overwriting them with the
  compositor's, restore applies size only, and popups appear wherever the
  compositor puts them instead of anchored to their toolbar button.
  Asking for XWayland would restore both behaviors, but only if the platform
  is settled before Electron starts its display backend —
  `ELECTRON_OZONE_PLATFORM_HINT=x11`, which Flank trusts for the positioning
  decision. Appending `--ozone-platform=x11` from the main process instead is
  a trap: the browser process has already initialized Wayland while the GPU
  and renderer processes come up on X11, and a window in that split state
  never receives a frame — it exists and reports itself visible, but nothing
  appears on screen (and the GPU process crash-loops).
- **Screen capture.** Under Wayland `desktopCapturer.getSources` does not
  enumerate anything: it opens the compositor's xdg-desktop-portal dialog and
  returns the one source the user allowed there (nothing if they dismissed
  it), one dialog per source type asked for — hence Flank narrowing the
  request to a screen *or* a window before calling it. The session needs a
  portal backend that implements ScreenCast (`xdg-desktop-portal-gnome`,
  `-kde`, `-wlr`, …); the GTK backend alone does not, and then no browser on
  that session can share a screen. `ELECTRON_OZONE_PLATFORM_HINT=x11` avoids
  the portal but is no cure: an XWayland client cannot see the pixels of
  Wayland-native windows, so what it captures is largely blank.

## Browser UI Flank provides itself

Electron hands the embedder a rendering engine, not a browser: the following
are things a user expects from any browser that have no built-in UI here, so
Flank implements them.

- **Find-in-page** — find bar in the chrome view driving
  `webContents.findInPage` (Ctrl+F is caught per focused view via
  `before-input-event`).
- **Context menu** — built from `context-menu` params: link/image address
  copying, clipboard editing, reload, and "open in the other view" routed
  through the new-window rules.
- **Downloads** — default save-to-Downloads behavior kept; a transient pill
  in the title bar reports start/done (chrome-owned space, so it never
  covers pages). No download manager, per the scope rules.
- **Permission prompts** — Electron allows by default, so
  `setPermissionRequestHandler` drives a serialized allow/block dialog with
  per-origin persistence in `settings.json` (the engine has none).
  `setPermissionCheckHandler` answers the silent checks most web APIs make
  before they request, from the same policy and the same stored answers: it is a
  separate default-allow path, and without it `permissions.query` and
  `Notification.permission` would contradict the dialog. A check cannot prompt,
  so undecided answers `false` and the request handler takes over.
- **Screen sharing** — Electron has no picker, and with no handler installed
  every `getDisplayMedia` call simply fails, which sites report as a generic
  "something went wrong". `setDisplayMediaRequestHandler` plus
  `desktopCapturer.getSources` supplies the picker and grants the single
  chosen source; `display-capture` is allowed silently in `permissions.ts`
  because the picker is that request's real consent step. Loopback audio is
  requested alongside the video on Windows only — Electron supports it
  nowhere else. On macOS 15+ `useSystemPicker` hands the whole exchange to
  the OS and the handler never runs.
- **Zoom** — Ctrl+wheel from the content preload, Ctrl+±/0 via
  `before-input-event`, pinch via `setVisualZoomLevelLimits`; per-view zoom
  level in 0.5 steps.

## Extensions

`electron-chrome-extensions` (GPL-3.0 license option) fills the `chrome.*` gaps
Electron leaves (tabs, action popups, storage). It binds to one session, so
there is one instance per profile, keyed by session: content views register as
tabs on their own profile's instance (`webContents.session` selects it), and the
section's visible view is the "active tab". Each profile loads every enabled
settings entry into its partition once, when it is created — Electron partitions
start empty, so this is a load, not a diff — and failures are logged and
skipped. Engine ids are derived from the extension folder, so every profile
agrees on them and the first one to load writes them back to `settings.json`.
An extension's keep-alive bookkeeping is per profile too, since its worker is.

MV3 background service workers are held alive with an explicit keep-alive
task (`serviceWorkers.startWorkerForScope` + `startTask`, re-asserted from
`running-status-changed` if a worker still stops). Chromium idle-kills
extension workers after ~30 s, and — unlike Chrome — Electron does not
revive a dead worker when a runtime message arrives for it, so anything a
content script relays to the background is silently lost once the worker
dies. Bitwarden's SSO/2FA login broke exactly this way: its vault connector
page reports the auth result via a content script minutes after the popup
closed, by which time the worker was gone.

Importing from another browser (`browser-import.ts`) walks a per-platform
table of Chromium user-data directories, reads each one's `Local State` for
its profiles' display names, and enumerates
`<profile>/Extensions/<id>/<version>/`. Copies are taken into
`extensions/<id>/` in the data folder, minus any top-level underscore-prefixed
directory except `_locales` — browsers leave webstore verification data in
`_metadata`, and Chromium refuses to load an unpacked extension that has
reserved names at its root. Icons for the picker travel inline as data URLs,
since `flank-icon://` only serves files under already-configured extensions.

`chrome.windows.create` opens a standalone "popout" window on the calling
profile's session, registered as a tab (Bitwarden finishes SSO logins in one;
Chrome shows these as `type: 'popup'` windows). `chrome.tabs.create` routes
through Flank's new-window rules instead, into a window of that profile — an
extension instance belongs to one profile and its tab must not land in another
one's window.

Toolbar buttons come from each extension's parsed manifest (localized name,
~48 px icon served over `flank-icon://`, grayscale in CSS). Clicking opens
the popup — a small frameless child window on the space's session, anchored
beside the button (below it when the toolbar sits on top) and clamped inside
the window, sized to the page's preferred size, destroyed on
close; blur light-dismisses, `window.close` works natively, link-outs route
like new-window requests. Extensions without a popup fall back to their
options page in the section's view.

Support remains partial (e.g. `chrome.webRequest` is unavailable, so ad
blockers degrade). Flank accepts that: extensions are an essentials-only
feature here, not a compatibility target. What it does not accept is an
extension failing to *load*, which two gaps in the namespace used to cause
and `extension-compat.ts` now closes:

- **No `browser` global.** Chrome defines none. Electron defines one carrying
  only the APIs it implements natively, while `electron-chrome-extensions`
  fills the rest of the surface (`windows`, `contextMenus`, `cookies`, …) onto
  `chrome` alone — so an extension that prefers `browser` whenever it exists
  lands on a namespace full of holes. Deleting it puts such extensions back on
  the `chrome` path they ship for Chrome, and costs nothing: a Web Store
  extension cannot depend on `browser` or it would not run in Chrome either.
- **Inert `chrome.webRequest` events.** The namespace exists but holds only
  `onHeadersReceived`, so a guard like `if (chrome.webRequest)` passes and the
  next line throws. Stub events keep that a no-op — the listeners simply never
  fire, which is the degradation above.

Both matter most inside a service worker, where a top-level throw fails the
worker's registration outright and takes the whole extension down with it.
LastPass hit both. The patches run through `contextBridge.executeInMainWorld`,
because Electron installs the extension globals *after* preloads execute —
touching them at preload top level finds nothing there yet.

## Error handling & resilience

- Renderer crash (`render-process-gone`) → inline crash panel with reload.
- Malformed JSON config → back up the bad file (`*.bad`), start from
  defaults.
- Fire-and-forget tasks funnel exceptions to `debug.log` in the data folder,
  as do uncaught exceptions and unhandled rejections.
- Extension load failures are logged and skipped; they never block startup or
  keep a profile's first window from opening.

## Debugging

- `debug.log` in the data folder is the first stop when something silently
  does nothing.
- `FLANK_DEBUG_PORT=<port>` exposes the Chromium remote-debugging endpoint
  for every view — chrome renderers and pages can be inspected or driven
  over the DevTools protocol (`http://127.0.0.1:<port>/json`).
- `FLANK_DATA_DIR=<path>` relocates the whole data folder, Chromium profile
  included. A demo or a test run then starts from its own spaces instead of
  the real ones; the app is otherwise identical.

## Project layout

```
electron.vite.config.ts  main/preload/renderer builds
electron-builder.yml     packaging targets (win zip, mac zip, linux tar.gz)
src/main/                lifecycle, stores, windows, routing, extensions
src/preload/             chrome.ts, content.ts, extension-compat.ts
src/renderer/            React chrome UI (manager/, space/, components/)
src/shared/              data model + IPC DTO types, backdrop color schemes
resources/               app icons
docs/                    this specification
```
