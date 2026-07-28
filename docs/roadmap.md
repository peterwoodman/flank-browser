# Flank — Scope

What Flank deliberately does and does not do. Feature behavior is specified
in `ui.md`, `behaviors.md`, and `data-model.md`; the git history holds how it
got here.

## Explicitly out of scope

- **Tabs and an omnibox** — intentionally never. The space/section model
  replaces them (the contextual address bar is the only URL entry inside a
  web view).
- **Per-space browser profiles** — login separation is a *profile* feature
  instead (`behaviors.md` → Profiles): a space belongs to a profile and shares
  its cookies and logins with that profile's other spaces. Giving every space
  its own identity would make one signed-in state per window, which is the tab
  sprawl the space model exists to avoid.
- **Per-profile extensions or settings** — the extension list, search engine,
  and permission answers stay app-wide. A profile separates *who the browser is
  signed in as*, not how it behaves.
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
