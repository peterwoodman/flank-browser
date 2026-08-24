# Flank — Overview

Flank is a personal, space-oriented web browser. Instead of one window
with tabs, the browser is a set of **spaces**, each opening as its own
independent window. There are no tabs and no persistent address bar.

These documents are the specification of the application's current behavior —
complete enough to replicate it exactly. Flank is a cross-platform Electron
app (Windows, macOS, Linux); `architecture.md` describes how it is built, and
the rest of the spec is written platform-neutrally, with anything that differs
per OS called out where it applies.

## The model

- **Spaces** — named collections of pinned links with their own window,
  layout, and browsing session.
- **Profiles** — each space belongs to a profile, and a profile is a browsing
  identity: the spaces in one share its cookies, logins, and cache, and see
  nothing of any other profile's. One profile is the normal case; the Manager
  groups its spaces per profile once there is more than one.
- **Launcher flow** — launching Flank reopens the spaces from the last
  session; with nothing to restore it opens the **Manager window**, a
  launcher-styled grid of space tiles. The Manager is the hub every space is
  reached from, and it stays open behind them while you are in a
  space — brought forward when the last space window closes, and raised any
  time by the Spaces button at the end of the left section's toolbar. A space can also be
  opened directly with the `--space <name or id>` argument (for pinned
  shortcuts). The app exits when its last window closes.
- **A section is a page**: an icon toolbar (on the side or the top, per
  settings) and the browser view, with an address/search bar across the top
  only when the page is not one of the space's pinned links. Before its first
  page a section shows only the backdrop.
- **The space menu** — the space's start menu: a panel of pinned links and a
  search box that opens from the toolbar over the page, covering part of it
  rather than replacing it. It light-dismisses, and a section with no page yet
  shows it by default.
- **Two sections per window**: a space window shows one section by
  default (the left). Navigating away from the left page opens the second
  (right) section, keeping the launched page in place — see `behaviors.md`
  for the full routing rules. A draggable split bar separates them.
- **1-shot windows** — for the errand that belongs to no space: a plain browser
  window, one page with an address bar, no space menu and no history, opened
  from the button beside Spaces and browsing in that space's profile. Nothing
  about it is remembered once it closes.

Toolbar buttons (per section): Open right view (left only, hidden while the
right is open) / Close view (right only) / Move page to left (right only) /
Back (only while the browser can go back) / Space menu / Refresh / Trail
(expandable per-view history) / extension icons / 1-shot window and Spaces
(left only, at the far end).

## Documentation index

- `architecture.md` — tech stack, process model, components
- `ui.md` — launch/activation, manager window, space window, 1-shot window,
  toolbar, flyouts
- `data-model.md` — JSON schemas and storage layout
- `behaviors.md` — navigation routing, tabs, trail, sessions, extensions
- `roadmap.md` — out-of-scope list and future directions
