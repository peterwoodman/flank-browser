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
| Extensions | `electron-chrome-extensions` on the shared session |
| Packaging | electron-builder (zip/tar.gz, unzip-and-run; no installer) |

## Process model

- **Single instance.** `app.requestSingleInstanceLock` with the `--space`
  argument passed through `additionalData` (Chromium reorders `argv` for
  second instances, so positional parsing there is unreliable). The
  `second-instance` handler routes activation into the running app.
- **Lifetime.** The app exits when its last window closes
  (`window-all-closed` → `app.quit()`). No tray icon or background residency.
- **Processes.** One main process owns all windows, stores, and routing.
  Each `WebContentsView` (chrome UI and pages alike) renders in Chromium
  renderer processes.
- **Shared profile.** Every content view in every space uses one persistent
  partition (`persist:flank`), so cookies, logins, and cache are shared
  app-wide. Both it and the JSON stores live in the app's own data folder
  (`Flank-Electron` under the platform's user application data directory;
  `userData` is pointed there).

## Window/view model

Each space window is a `BaseWindow` whose content view stacks:

1. **Chrome view** (bottom) — one full-window `WebContentsView` running the
   React app (title bar, toolbars, home views, address bars, flyouts, find
   bar, dialogs). Its background is transparent; the window's
   `backgroundColor` is the visible base.
2. **Content views** (top) — the pooled page views, positioned by the main
   process into "holes" the chrome reports over IPC (each `WebChrome`
   component measures its content area and sends the rect).

Flyouts and overlays over web content invert the stack: the chrome view is
raised to the top (transparent, so only the flyout paints), any outside
click light-dismisses in the chrome, and the chrome is lowered again. This
z-order dance is isolated in the space window controller (`setOverlay`).
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
and the overlay's symbol color follows the adaptive page colors.

```
main process
├── window-manager        – open space windows, openSpaces memory, burst-close
├── stores/               – settings/spaces/sessions over atomic JsonFile
├── space-window          – BaseWindow + chrome view + sections, layout, IPC
│   └── section (×2)      – tab pool (keep-alive per home link + ad-hoc view),
│                           eviction timer, session capture/restore
│       └── content-view  – one WebContentsView: navigation routing, trail,
│                           colors, load/crash state, favicon capture, zoom
├── manager-window        – launcher window (BrowserWindow, same React app)
├── extensions            – electron-chrome-extensions + reconcile + buttons
├── favicons              – live capture + fallback fetch icon cache
├── permissions/downloads – session-level handlers → per-window chrome UI
├── screen-share          – display-media handler + source picker dialog
└── icons-protocol        – flank-icon:// serves cached and extension icons
```

## Preload scripts

- **`chrome.ts`** — the IPC bridge for Flank's own UI (`window.flank`:
  invoke/send/on, all channels namespaced `flank:`). The chrome renderer is
  a pure view of main-process state snapshots (`SpaceStateDto`).
- **`content.ts`** — page instrumentation: shift+click interception,
  `Alt+Left`, `Shift+←/→` split
  nudges, form-submit reporting, the adaptive color reporter
  (theme-color/computed colors, re-reported on change), DOM-ready/load
  signals for the load bar, and Ctrl+wheel zoom.

## Where the spec's behaviors attach

| Behavior | Electron mechanism |
|---|---|
| Navigation routing (leave the pinned page → right section) | `will-navigate` `preventDefault()` + a programmatic-navigation flag, since the event carries no user-gesture flag |
| New tabs and popups | `setWindowOpenHandler`: `deny` + route per `behaviors.md`, or `allow` for sized popups (`disposition: 'new-window'`) |
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

`electron-chrome-extensions` (GPL-3.0 license option) runs on the shared
session, filling the `chrome.*` gaps Electron leaves (tabs, action popups,
storage). Content views register as tabs; the section's visible view is the
"active tab". Reconciliation loads every enabled settings entry once per app
session at startup — Electron sessions start empty, so reconcile = load —
and failures are logged and skipped. Engine-assigned ids are written back to
`settings.json` after loading.

MV3 background service workers are held alive with an explicit keep-alive
task (`serviceWorkers.startWorkerForScope` + `startTask`, re-asserted from
`running-status-changed` if a worker still stops). Chromium idle-kills
extension workers after ~30 s, and — unlike Chrome — Electron does not
revive a dead worker when a runtime message arrives for it, so anything a
content script relays to the background is silently lost once the worker
dies. Bitwarden's SSO/2FA login broke exactly this way: its vault connector
page reports the auth result via a content script minutes after the popup
closed, by which time the worker was gone.

`chrome.windows.create` opens a standalone "popout" window on the shared
session, registered as a tab (Bitwarden finishes SSO logins in one; Chrome
shows these as `type: 'popup'` windows). `chrome.tabs.create` routes through
Flank's new-window rules instead.

Toolbar buttons come from each extension's parsed manifest (localized name,
~48 px icon served over `flank-icon://`, grayscale in CSS). Clicking opens
the popup — a small frameless child window on the shared session, anchored
beside the button (below it when the toolbar sits on top) and clamped inside
the window, sized to the page's preferred size, destroyed on
close; blur light-dismisses, `window.close` works natively, link-outs route
like new-window requests. Extensions without a popup fall back to their
options page in the section's view.

Support remains partial (e.g. `chrome.webRequest` is unavailable, so ad
blockers degrade). Flank accepts that: extensions are an essentials-only
feature here, not a compatibility target.

## Error handling & resilience

- Renderer crash (`render-process-gone`) → inline crash panel with reload.
- Malformed JSON config → back up the bad file (`*.bad`), start from
  defaults.
- Fire-and-forget tasks funnel exceptions to `debug.log` in the data folder,
  as do uncaught exceptions and unhandled rejections.
- Extension load failures are logged and skipped; they never block startup.

## Debugging

- `debug.log` in the data folder is the first stop when something silently
  does nothing.
- `FLANK_DEBUG_PORT=<port>` exposes the Chromium remote-debugging endpoint
  for every view — chrome renderers and pages can be inspected or driven
  over the DevTools protocol (`http://127.0.0.1:<port>/json`).

## Project layout

```
electron.vite.config.ts  main/preload/renderer builds
electron-builder.yml     packaging targets (win zip, mac zip, linux tar.gz)
src/main/                lifecycle, stores, windows, routing, extensions
src/preload/             chrome.ts, content.ts
src/renderer/            React chrome UI (manager/, space/, components/)
src/shared/              data model + IPC DTO types
resources/               app icons
docs/                    this specification
```
