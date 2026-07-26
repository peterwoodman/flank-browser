# Flank — Data Model & Storage

All Flank data lives in one app-data folder, `Flank-Electron` inside the
platform's per-user application data directory: `%APPDATA%` on Windows,
`~/Library/Application Support` on macOS, `$XDG_CONFIG_HOME` (usually
`~/.config`) on Linux. Setting `FLANK_DATA_DIR` puts it somewhere else
instead, for demo and test profiles.

```
<app data>/
├── settings.json          – app-wide settings and app-level state
├── spaces.json        – space definitions and home grids
├── sessions/
│   └── {spaceId}.json – per-space session state and trails
├── icons/                 – cached favicons for home grid tiles
│   ├── {urlhash}.png      – page-declared favicon captured live (keyed by a
│   │                        hash of the link URL; see behaviors.md → Favicons)
│   └── {authority}.ico    – fallback fetch for never-opened links (keyed by
│                            host[_port]): the site's /favicon.ico, then a
│                            domain-level icon service
├── extensions/            – extensions imported from another browser, one
│   └── {extensionId}/       folder each (behaviors.md → Extensions); created
│                            on the first import. Extensions added by folder
│                            stay where they are and are not copied here.
├── debug.log              – diagnostic log (errors from fire-and-forget tasks)
└── Cache/, Local Storage/, Network/, … – the Chromium profile shared by every
                            space (engine-managed; Flank never reads these)
```

Design rules:

- JSON, UTF-8, human-readable and hand-editable.
- Every file has a `"version"` field for future migrations.
- Writes are atomic: write `*.tmp`, then rename over the original. On load
  failure the bad file is copied to `*.bad` and defaults are used.
- Settings and spaces save immediately on change; sessions save on window
  close and every ~30 s while open.
- IDs are GUID strings (no dashes); timestamps are ISO 8601.

## settings.json

```json
{
  "version": 1,
  "searchTemplate": "https://www.qwant.com/?q={query}",
  "suggestTemplate": "https://api.qwant.com/v3/suggest?q={query}&version=2",
  "launchAtLogin": false,
  "toolbarPosition": "side",
  "backgroundTabMinutes": 30,
  "openSpaces": ["8b1c…"],
  "managerWindow": { "x": 640, "y": 320, "width": 660, "height": 560, "maximized": false },
  "extensions": [
    {
      "id": "c0f3…",
      "name": "uBlock Origin",
      "path": "C:\\Tools\\uBlockOrigin",
      "enabled": true,
      "browserExtensionId": "odfafepnkmbhccpbejgmiehpchacaeak"
    }
  ]
}
```

- `searchTemplate` — `{query}` is replaced with the URL-encoded search text.
- `suggestTemplate` — autocomplete endpoint for the search/address boxes;
  empty disables remote suggestions (see `behaviors.md` → Search suggestions).
- `toolbarPosition` — `"side"` (default) or `"top"`: where every section's
  toolbar sits (see `ui.md` → Web view). Anything else falls back to `"side"`.
- `backgroundTabMinutes` — idle time before a backgrounded left tab is
  unloaded.
- `openSpaces` — ids of the spaces open in the last session,
  reopened on the next plain launch (see `behaviors.md` → Startup). The
  final window close of a session is not recorded (that is the app
  quitting, not the space being closed).
- `managerWindow` — the Manager window's last bounds (spaces keep theirs
  in `spaces.json`).
- `extensions[].path` — folder containing an unpacked Chromium extension.
  Extensions added by folder are referenced where they sit; imported ones
  point into `extensions/{extensionId}/` in the data folder.
- `extensions[].browserExtensionId` — the id the browser engine assigned on
  install; written back after the first successful add.

## spaces.json

```json
{
  "version": 1,
  "spaces": [
    {
      "id": "a1b2…",
      "name": "Research",
      "order": 0,
      "splitRatio": 0.5,
      "window": { "x": 120, "y": 80, "width": 1600, "height": 900, "maximized": false },
      "links": [
        {
          "id": "f9e8…",
          "title": "Wikipedia",
          "url": "https://en.wikipedia.org",
          "icon": "icons/3fa4.png",
          "background": "#ffffff",
          "order": 0
        }
      ]
    }
  ]
}
```

- `links` is the home grid; `order` drives grid position (row-major).
- `icon` is a relative path into the `icons/` cache; empty means "fetch a
  favicon on next display".
- `background` is the app's manifest `background_color` (or `theme_color`),
  used as the launch splash canvas; empty means a theme-neutral splash. It's
  captured from the web app manifest when a link is pinned and refreshed
  whenever the link's app loads.
- `splitRatio` and `window` are remembered layout state. They live here
  rather than in the session file because they describe the space's
  shape, not its browsing state.
- Window placements are validated on save and load: bounds captured from
  minimized windows are skipped, and implausible bounds (under 300×200, or
  positioned far off-screen) are replaced with defaults.

## sessions/{spaceId}.json

Captures what the space looked like when its window last closed, so
reopening restores it.

```json
{
  "version": 1,
  "savedAt": "2026-07-21T14:03:22Z",
  "left": {
    "mode": "web",
    "url": "https://en.wikipedia.org/wiki/Electron_(software_framework)",
    "open": true,
    "trail": [
      {
        "url": "https://en.wikipedia.org/wiki/Electron_(software_framework)",
        "title": "Electron (software framework) - Wikipedia",
        "visitedAt": "2026-07-21T14:01:10Z"
      },
      {
        "url": "https://en.wikipedia.org",
        "title": "Wikipedia",
        "visitedAt": "2026-07-21T13:58:47Z"
      }
    ]
  },
  "right": { "mode": "home", "url": "", "open": false, "trail": [] }
}
```

- `left` and `right` are both always written; an unused right section is
  `mode: "home"` with an empty trail.
- `open` records whether the section was visible when saved. A closed right
  section keeps its trail here but is not reopened on restore.
- `mode` is `"home"` or `"web"`. In home mode `url` is ignored.
- `trail` is newest-first and capped (500 entries per view); deleting an
  entry in the UI removes it here on the next save.
- Sessions are saved on window close and every ~30 s while open, so a crash
  loses at most half a minute of trail.

## What is deliberately not stored

- **Cookies, logins, cache** — owned by the browser engine in its user data
  folder, shared across all spaces. Flank never parses or writes these.
- **Global history** — there is no cross-space history; the per-view
  trail is the only history feature.
- **Favicons for trails** — not persisted, to keep session files small.
