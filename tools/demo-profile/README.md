# Demo profile

A throwaway Flank profile of public, ad-free sites, used to take the
screenshots in `docs/images/`. The window sizes in `spaces.json` are chosen to
frame well in a shot; the four spaces exist to fill the Manager grid.

Point `FLANK_DATA_DIR` at a copy of this folder and the app starts as the demo
instead of as yours, so nothing here touches real spaces:

```powershell
$demo = Join-Path $env:TEMP 'flank-demo-profile'
New-Item -ItemType Directory -Path $demo -Force | Out-Null
Copy-Item tools\demo-profile\*.json $demo -Force
$env:FLANK_DATA_DIR = $demo; $env:FLANK_DEBUG_PORT = '9223'; npm run dev
```

Favicons and the Chromium profile fill themselves in on first run, which is
why the fixture is only two JSON files.

## Taking a screenshot

[`../capture-window.ps1`](../capture-window.ps1) captures one window to a PNG:

```powershell
.\tools\capture-window.ps1 -TitleLike 'Research' -Out docs\images\home.png
```

It runs DPI-aware, since a scaled display would otherwise yield a blurry
upscale; takes the DWM frame bounds, so the invisible resize border is
excluded; and masks the rounded corners to transparency rather than leaving
wallpaper in them.

Capturing the OS window is the only option: a space window composites a chrome
view over separate `WebContentsView`s, so `capturePage()` inside the app can
only ever photograph one layer of the stack.

To pose the views before the shot, launch with `FLANK_DEBUG_PORT` set (as
above) and drive them over the Chromium DevTools protocol —
`window.flank.invoke('section:openLink', …)` from a window's target opens pages
without clicking through the UI. See `AGENTS.md` → Debugging.
