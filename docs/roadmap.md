# Flank — Scope

What Flank deliberately does and does not do. Feature behavior is specified
in `ui.md`, `behaviors.md`, and `data-model.md`; the git history holds how it
got here.

## Explicitly out of scope

- **Tabs and an omnibox** — intentionally never. The space/section model
  replaces them (the contextual address bar is the only URL entry inside a
  web view).
- **Per-space browser profiles** — all spaces share one profile
  (cookies, logins, extensions). Revisit only if login separation becomes
  wanted.
- **System tray residency** — the app exits with its last window; sessions
  make relaunching lossless.
- **Command palette navigation overlay.**
- **Custom download manager** — the engine's default download UI is used.
- **Global history or cross-space search** — the per-view trail is the
  only history feature.
- **Sync, installers, auto-update** — releases are plain archives, unzipped
  and run.
- **Zoom display/persistence.**

## Future directions (not committed)

- **Taskbar jump list / dock menu** — per-space entries on the app icon's
  right-click menu, complementing the `--space` shortcut support.
- **Protocol handler** (`flank://space/...`) as an alternative launch
  surface.
