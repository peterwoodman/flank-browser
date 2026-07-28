# Flank — Data Model & Storage

All Flank data lives in one app-data folder, `Flank-Electron` inside the
platform's per-user application data directory: `%APPDATA%` on Windows,
`~/Library/Application Support` on macOS, `$XDG_CONFIG_HOME` (usually
`~/.config`) on Linux. Setting `FLANK_DATA_DIR` puts it somewhere else
instead, for demo and test profiles.

```
<app data>/
├── settings.json          – app-wide settings and app-level state
├── spaces.json        – profiles, space definitions, and home grids
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
└── Partitions/            – one Chromium profile per Flank profile, named after
    └── flank[-{id}]/        its partition: Cache/, Local Storage/, Network/, …
                             (engine-managed; Flank never reads these). Created
                             when a profile's first space opens, and deleted
                             with the profile.
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
  "searchTemplate": "https://www.ecosia.org/search?method=index&q={query}",
  "suggestTemplate": "https://api.qwant.com/v3/suggest?q={query}&version=2",
  "launchAtLogin": false,
  "toolbarPosition": "side",
  "backgroundTabMinutes": 30,
  "oneShotStart": "blank",
  "oneShotStartUrl": "",
  "openSpaces": ["8b1c…"],
  "permissions": { "https://meet.example.com": { "media": true, "notifications": false } },
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
  Must be an `http(s)` URL containing `{query}`; anything else is refused on
  entry and ignored in favor of the default if it reached the file another way
  (see `behaviors.md` → Search engine).
- `suggestTemplate` — autocomplete endpoint for the search/address boxes, held
  to the same rule; empty disables remote suggestions (see `behaviors.md` →
  Search suggestions).
- `toolbarPosition` — `"side"` (default) or `"top"`: where every section's
  toolbar sits (see `ui.md` → Web view). Anything else falls back to `"side"`.
- `backgroundTabMinutes` — idle time before a backgrounded left tab is
  unloaded.
- `oneShotStart` — what a 1-shot window opens on: `"blank"` (default, an empty
  page), `"search"` (the `searchTemplate`'s own home page), or `"custom"` for
  `oneShotStartUrl`. Anything else falls back to `"blank"`.
- `oneShotStartUrl` — the page `"custom"` opens. Held to `http(s)` like the
  search templates, since the host navigates a window to it; a value that got in
  another way is ignored in favor of an empty page.
- `openSpaces` — ids of the spaces open in the last session,
  reopened on the next plain launch (see `behaviors.md` → Startup). The
  final window close of a session is not recorded (that ends the session,
  rather than meaning you are done with the space).
- `managerWindow` — the Manager window's last bounds (spaces keep theirs
  in `spaces.json`). Never captured while it is minimized behind a space
  window, so being tucked away does not overwrite where it sits.
- `permissions` — remembered allow/deny answers, keyed by origin then permission
  name, written the first time a prompt is answered. The engine keeps no such
  memory, and these answers also settle the silent checks web APIs make before
  asking (see `behaviors.md` → Media, permissions, and dialogs). Deleting an
  origin's entry makes it ask again. App-wide rather than per profile: allowing a
  site your camera is a decision about the site, not about which identity is
  browsing it.
- `extensions` — app-wide, not per profile: the same set is loaded into every
  profile (see `behaviors.md` → Extensions).
- `extensions[].path` — folder containing an unpacked Chromium extension.
  Extensions added by folder are referenced where they sit; imported ones
  point into `extensions/{extensionId}/` in the data folder.
- `extensions[].browserExtensionId` — the id the browser engine assigned on
  install; written back after the first successful add.

## spaces.json

```json
{
  "version": 1,
  "profiles": [
    { "id": "7c4d…", "name": "Default", "order": 0, "partition": "persist:flank" },
    { "id": "b3a1…", "name": "Work", "order": 1, "partition": "persist:flank-b3a1…" }
  ],
  "spaces": [
    {
      "id": "a1b2…",
      "name": "Research",
      "profileId": "7c4d…",
      "order": 0,
      "splitRatio": 0.5,
      "colorScheme": "azure",
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

- `profiles` are the browsing identities spaces are grouped into, in the order
  the Manager lists them; there is always at least one. `partition` names the
  Chromium partition holding that profile's cookies, logins, and cache — the
  first profile keeps `persist:flank`, the partition the app used before it had
  profiles, so gaining profiles doesn't sign anyone out. A partition that is
  missing, malformed, or already claimed by another profile is replaced with one
  derived from the profile's id, since two profiles sharing one would share the
  identity that defines them.
- `profileId` is the profile a space browses as. An unknown one (hand-edited, or
  a space written before profiles existed) falls back to the first profile.
  Spaces are stored grouped by profile, in profile order.
- `links` is the home grid; `order` drives grid position (row-major).
- `icon` is a relative path into the `icons/` cache; empty means "fetch a
  favicon on next display".
- `background` is the app's manifest `background_color` (or `theme_color`),
  used as the launch splash canvas; empty means a theme-neutral splash. It's
  captured from the web app manifest when a link is pinned and refreshed
  whenever the link's app loads.
- `colorScheme` is the id of the space's backdrop color scheme (see `ui.md` →
  Backdrop). An unknown id, and a space saved before the setting existed, fall
  back to the default and are rewritten on the next save.
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

- **Cookies, logins, cache** — owned by the browser engine in its partition
  folder, one per profile and shared by that profile's spaces. Flank never
  parses or writes these; removing a profile clears them through the engine.
- **Global history** — there is no cross-space history; the per-view
  trail is the only history feature.
- **Favicons for trails** — not persisted, to keep session files small.
