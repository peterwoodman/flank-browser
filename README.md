# Flank

A personal, space-oriented web browser: no tabs, no persistent address bar.
Instead of one window full of tabs, the browser is a set of **spaces** — each
opens as its own window with its own grid of pinned sites, its own session, and
up to two pages side by side. Cross-platform (Windows, macOS, Linux), built
with Electron, TypeScript, and React.

## A look at it

![A Flank space window split in two: the Rust standard library documentation on the left with a narrow icon toolbar down its edge, and a Wikipedia article on the right under an address bar](docs/images/split.png)

The page you launch stays put. Follow a link out of it and the second section
opens beside it, so the thing you were reading is never replaced. Each
section's chrome takes its page's colors, and an address bar appears only over
a page that isn't one of the space's pinned sites — the left has none, the
right does.

![A space window on its empty backdrop, with a flyout of pinned site icons and a search box](docs/images/home.png)

Every space opens on its own backdrop with the space menu already up — pinned
sites and a search box. Each pinned site keeps its page alive in the
background, so leaving it and coming back resumes exactly where you were.

![The Manager window showing four space tiles, each with a montage of site favicons](docs/images/manager.png)

The Manager is the launcher: one tile per space, each showing the favicons of
what's pinned inside it. A space also picks the color its window's backdrop is
washed in, from a small palette, so which space a window belongs to reads at a
glance — the tile is tinted to match.

## Any site becomes an app

Pinning a site to a space's home grid is Flank's equivalent of installing it.
There is no install step and no eligibility test: where a conventional browser
offers "Install app" only for sites that ship a web app manifest, Flank gives
every pinned site the same app treatment and uses whatever metadata the site
happens to publish.

**What it reads.** When a site is pinned — and again whenever its page loads —
Flank fetches the page's web app manifest and takes three things from it:

- `short_name`/`name` becomes the tile's title, because it is the app's stable
  name rather than a document title that changes with every page.
- `icons` provides the tile and splash icon: the app's own installable artwork,
  at full size instead of a 16 px favicon upscaled. Unpadded (`any`) icons rank
  above `maskable` ones, which only look right cropped; `monochrome` and SVG
  entries are skipped, and the largest raster wins.
- `background_color`, or `theme_color` in its absence, is the canvas the launch
  splash is painted on.

The manifest is fetched from inside the page, so cookies apply and sites that
serve a manifest only to signed-in users still work. Sites without one fall
back through their declared `<link>` icons, the engine's favicon, and finally a
domain icon service, with the document title as the name — the app treatment
degrades in fidelity rather than switching off.

The `theme-color` meta tag is read separately and continuously: it tints that
section's toolbar and address bar, the window's title bar, and the native
caption buttons, and it is re-read whenever the page changes it, so a site that
swaps its color on a route change or with a dark stylesheet is followed rather
than frozen at its first frame.

**How it behaves.** Launching a pinned site shows a splash — its icon and name
on its manifest background color — until the page is ready. The page then fills
the window with a strip of icon buttons for chrome and no address bar, for as
long as you stay on that site; wander off it and the bar appears. Links leaving
the app open in the second section, so the app itself is never navigated away
from. Pinned sites keep running in the background, and returning to one resumes
its scroll position, media, and in-page state with no reload, until an idle
timeout unloads it. Meanwhile the window is an ordinary OS window in the taskbar
or dock, and `--space <name>` opens one directly, so a space can be pinned as a
shortcut like any app.

The result is that a set of sites behaves like a set of installed apps, without
depending on a site's authors having asked for that.

## Documentation

[`docs/`](docs) is the specification of what the app currently does — start at
[`docs/overview.md`](docs/overview.md), or go to
[`docs/architecture.md`](docs/architecture.md) for how it is built.

## Develop

```powershell
npm install
npm run dev        # build + launch with HMR for the chrome UI
```

Main-process and preload changes restart the app; chrome UI (React) changes
hot-reload in place.

```powershell
npm run typecheck  # main/preload (node) + renderer (web)
```

The source tree:

```
src/main/      lifecycle, stores, window/view management, routing, favicons,
               permissions, downloads, extensions
src/preload/   chrome.ts (UI IPC bridge), content.ts (page instrumentation)
src/renderer/  React chrome UI: manager/ (grid, settings), space/ (sections,
               home, web chrome, flyouts, find bar), components/
src/shared/    data model + IPC DTO types shared across processes
```

## Debug

- **App data** lives in `%APPDATA%\Flank-Electron`, or the platform equivalent
  of Electron's `userData`: `settings.json`, `spaces.json`, `sessions/`,
  `icons/`, `debug.log`, plus the shared Chromium profile.
- **`debug.log`** collects errors and fire-and-forget failures. Check it first
  when something silently does nothing.
- **Remote debugging**: `FLANK_DEBUG_PORT` exposes the Chromium DevTools
  protocol for every view, chrome UI and pages alike, at
  e.g. `http://127.0.0.1:9223/json`.

  ```powershell
  $env:FLANK_DEBUG_PORT="9223"; npm run dev
  ```

- **Throwaway profile**: `FLANK_DATA_DIR` relocates the whole data folder, so
  an experiment or a demo never touches real spaces.
  [`tools/demo-profile/`](tools/demo-profile) is a ready-made fixture, and its
  README covers reproducing the screenshots above.

## Package

```powershell
npm run package    # electron-vite build + electron-builder → dist/
```

This builds for the OS it runs on. There is no installer on any platform: each
artifact is an archive to unpack and run.

### Windows

`npm run package` produces `dist/Flank-<version>-win.zip`. Unzip it anywhere
and run `Flank.exe`.

### Linux

`npm run package` on Linux produces `dist/flank-<version>.tar.gz`; extract it
and run `./flank`. Electron bundles Chromium, so nothing else needs
installing. On kernels without unprivileged user namespaces, the bundled
`chrome-sandbox` helper has to be made setuid root:

```bash
chown root:root chrome-sandbox && chmod 4755 chrome-sandbox
```

The Linux archive can also be cross-packaged from any OS — electron-builder
downloads the target platform's Electron binary:

```powershell
npm run build; npx electron-builder --linux
```

### macOS

macOS **cannot** be cross-packaged. The `.app` bundle contains symlinks that
non-Mac filesystems lose, and the ad-hoc `codesign` step — without which Apple
Silicon refuses to launch the app — only exists on macOS. Build on a Mac, or a
macOS CI runner:

```bash
npm install
npm run build && npx electron-builder --mac
```

That yields one `dist/Flank-<version>[-arm64]-mac.zip` per configured arch
(arm64 for Apple Silicon, x64 for Intel), ad-hoc signed automatically since no
signing identity is configured.

Because the zips are not notarized, Gatekeeper blocks the first launch of a
downloaded copy: approve it under System Settings → Privacy & Security →
"Open Anyway" (older macOS accepts right-click → Open). Copies built on the Mac
itself launch without ceremony.

## Linux desktop integration

Three things behave differently on Linux. The first two the app handles itself,
since there is no installer to do it.

- **Desktop entry.** On each start the packaged app writes
  `~/.local/share/applications/flank.desktop` and its icon into the user's icon
  theme, re-pointing them if the folder moved. This is what gives the dock, app
  grid, and window switcher a real icon: desktop environments pair a window to
  its launcher by matching the window's `app_id`/`WM_CLASS` against the entry's
  base name (`flank`, set via `desktopName` in `package.json`), and read the
  icon from there.
- **Display server.** Flank runs on whatever the session provides: native
  Wayland under Wayland, X11 under X11. Wayland's protocol forbids an app from
  placing its own windows, so there window positions are not restored (sizes
  are) and extension popups are placed by the compositor rather than anchored
  to their sidebar button. `ELECTRON_OZONE_PLATFORM_HINT=x11` asks Electron for
  XWayland, which brings both back where the build and session honor it. Do not
  set `--ozone-platform` from the main process instead: the browser process has
  already picked its backend, so only the child processes switch and the
  resulting window never paints — see
  [`docs/architecture.md`](docs/architecture.md).
- **Screen sharing.** Under Wayland this goes through xdg-desktop-portal, so
  the session needs a portal backend implementing ScreenCast. The GTK backend
  alone does not, and a session without one ("Can't share your screen" in Meet,
  and the same in any other browser) needs the backend for its desktop
  installed: `xdg-desktop-portal-gnome` under GNOME, `-kde` under KDE, `-wlr`
  under wlroots compositors. Switching to XWayland is not a workaround — an
  XWayland client cannot see Wayland windows' pixels, so it captures a mostly
  blank screen.

`debug.log` records which session was detected and what follows from it, e.g.
`Linux session: XDG_SESSION_TYPE=wayland ozone=session default
positioning=unavailable (native Wayland)`.

## License

Copyright (C) 2026 Peter Woodman. Flank is free software under the
[GNU General Public License](LICENSE), version 3 or later.

The copyleft is inherited rather than chosen: Flank's extension support uses
[`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell),
which is offered under either the GPL-3.0 or a paid patron license, and Flank
takes the GPL option.
