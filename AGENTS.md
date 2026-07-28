# Flank — Agent Notes

Flank is a personal, space-oriented web browser: no tabs, no persistent
address bar. Spaces are grouped into profiles, each with its own Chromium
partition (cookies, logins, cache); app data is JSON. It is an
Electron + TypeScript + React app running on Windows, macOS, and Linux, with
data under the platform's `userData` directory (`%APPDATA%\Flank-Electron` on
Windows).

## Keep the docs updated

The `docs/` folder is a **current-state specification** — precise enough that
someone could replicate the app exactly from it. **Whenever a change alters
behavior, adds a feature, or reverses a decision, update the relevant doc in
the same piece of work.** Do not accumulate history in the docs ("this used
to be…", "post-M5…"); git history holds the past. Keep the docs describing
only what the app does now, with the *why* included where a decision isn't
obvious. Anything true of only one OS goes in a `> **Linux:** …`-style
callout rather than the main text, so the spec reads platform-neutrally;
implementation detail belongs in `docs/architecture.md`.

- `docs/overview.md` — elevator pitch and doc index
- `docs/architecture.md` — stack, process model, components, Electron constraints
- `docs/ui.md` — launch/activation, manager window, space window, toolbar, flyouts
- `docs/data-model.md` — JSON schemas and storage layout
- `docs/behaviors.md` — navigation routing, tabs, trail, sessions, extensions
- `docs/roadmap.md` — out-of-scope list and future directions

## Don't build unless asked

Builds, packaging, and releases are the user's call — they are slow and drop
artifacts in the tree. Do not run `npm run build`, `npm run package`,
`npm run linux`, or `electron-builder` unless explicitly asked. Fast checks
(`npm run typecheck`) are fine for verifying an edit; when trying a change out
needs a build, say so and leave it to the user.

## Build and run

The shell is PowerShell: `&&` does not chain commands; use `;`.

```powershell
npm install
npm run dev        # build + launch with HMR (main/preload changes restart)
npm run typecheck  # tsc for main/preload (node) and renderer (web)
npm run package    # electron-vite build + electron-builder → dist/
```

The app is single-instance: launching opens the Manager window (the launcher)
or restores the last session's spaces, and a second launch routes into the
running instance. `--space <name or id>` opens a space directly. The app exits
when its last window closes (no tray).

Kill a running instance before packaging, or when a dev launch misbehaves:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

(Only Flank's own — check `MainWindowTitle` if other Electron apps are
running.)

## Debugging

- **Diagnostic log**: `debug.log` in the data folder (`%APPDATA%\Flank-Electron`
  on Windows). Fire-and-forget failures, uncaught exceptions, and extension
  load errors land here — check it first when something silently does nothing.
- **App data**: `settings.json`, `spaces.json`, `sessions/` in the same folder.
- **UI testing**: set `FLANK_DEBUG_PORT=9223` before `npm run dev`, then drive
  any view over the Chromium DevTools protocol
  (`http://127.0.0.1:9223/json` lists targets; `Runtime.evaluate` over a
  target's WebSocket clicks and inspects the chrome UI). The IPC handlers all
  take a space id, so `window.flank.invoke('section:openLink', …)` from the
  manager target poses any window without clicking through it.
- **Throwaway data**: `FLANK_DATA_DIR` relocates the whole data folder. Use it
 rather than editing real spaces — `tools/demo-profile/` is a ready fixture,
 and `tools/capture-window.ps1` screenshots a window (see
 `tools/demo-profile/README.md`).
- The chrome renderer is a pure view of main-process state snapshots; UI bugs
  are usually main-process state bugs — check `buildState()` first.

## Structure and conventions

- `src/main` — lifecycle, stores, windows, sections, routing, extensions.
- `src/preload` — `chrome.ts` (UI IPC bridge), `content.ts` (page
  instrumentation).
- `src/renderer` — React chrome UI: `manager/`, `space/`, `components/`.
- `src/shared` — data model and IPC DTO types shared across processes. Must
  stay platform- and process-agnostic.
- Persistence is JSON via `JsonFile` (atomic writes, `*.bad` on parse failure).
- All IPC channels are namespaced `flank:`.

## Gotchas (details in docs/architecture.md)

- **Chrome-view transparency is load-bearing.** In a space window the chrome
  view is raised above the page views for flyouts, so it must stay
  transparent: `setBackgroundColor('#00000000')` is re-applied after every
  chrome load (a load resets it), and no CSS ancestor of a content hole may
  paint a background, or the pages blank out whenever the chrome is raised.
- **Session-scoped setup goes through `prepareEverySession`.** Each profile is
 its own Chromium partition, created when its first space opens, so anything
 installed on a session (permission, download, screen-share handlers, the
 extension host) must be registered as a preparer rather than applied once at
 startup — otherwise it silently covers only the first profile used.
- **Extension service workers need a keep-alive.** Chromium idle-kills MV3
  workers after ~30 s and Electron does not revive them for incoming runtime
  messages, so anything a content script relays later is silently lost.
- **Extension reconcile must tolerate failures** — a bad extension is logged
  and skipped, never allowed to break view initialization.
- **Extension API warnings at startup** (`Permission 'x' is unknown`,
  `No source for require(webRequest)`) are expected partial-support noise from
  `electron-chrome-extensions`.
- **Flank must not look like Electron.** The user agent is trimmed to plain
  Chrome, and `extension-compat.ts` deletes Electron's partial `browser`
  global and stubs the missing `chrome.webRequest` events. Extensions sniff
  for all three: with any of them left as Electron ships it, LastPass either
  fails its service-worker registration or syncs an empty vault.
- **Don't set `--ozone-platform` from the main process** on Linux: the browser
  process has already picked its display backend, only the children switch,
  and the window never paints. `ELECTRON_OZONE_PLATFORM_HINT` is the
  environment-level knob, and Flank reads it rather than setting it.
- **There is deliberately no tray icon** — the app exits with its last window.
  Don't reintroduce one without discussion.
