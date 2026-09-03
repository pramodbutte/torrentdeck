# Product Requirements — TorrentDeck

| | |
|---|---|
| Status | Living document |
| Owner | Pramod Butte |
| Last updated | 2026-07-05 |
| Related | [ARCHITECTURE.md](ARCHITECTURE.md) · [CONTEXT.md](../CONTEXT.md) · [ADRs](adr/) |

## 1. Problem

[transgui](https://github.com/transmission-remote-gui/transgui) was the best remote
client for the Transmission BitTorrent daemon: fast, keyboard-friendly, multi-server.
It is abandoned, written in Free Pascal/Lazarus, and no longer runs on Apple Silicon
Macs. People who run Transmission headless on a NAS or seedbox and drive it from a
desktop are left with the daemon's bare web UI or nothing.

**TorrentDeck** is a maintained, cross-platform successor: transgui's
functionality with a modern UI, distributed as signed native installers.

## 2. Users and primary jobs

A self-hosting enthusiast running Transmission on one or more remote machines
(home NAS, seedbox, home-lab VM), who wants to:

1. **Monitor** — glance at what's downloading/seeding, speeds, and problems.
2. **Act** — add (magnet/.torrent), pause, resume, remove, reprioritize files.
3. **Manage** — labels, trackers, data location, per-daemon settings.
4. **Switch** — move between several servers with zero re-configuration.

## 3. Goals / non-goals

**Goals**

- Functional parity with transgui's daily-driver core (v0.1 ✅, shipped).
- First-class OS integration: default handler for `magnet:` and `.torrent`.
- Secure by construction: credentials in the OS keychain, no plaintext secrets,
  sandboxed renderer (see [ADR-0001](adr/0001-rpc-via-main-process.md)).
- macOS (Apple Silicon), Windows, and Linux from a single codebase, auto-updating.
- A **flexible workspace**: the UI is composed of panels the user can add, remove,
  resize, and rearrange rather than a fixed chrome (see §6 and
  [ADR-0002](adr/0002-flexible-panel-workspace.md)).
- **Multiple daemon types** behind one UI via per-protocol adapters — Transmission and
  Deluge (v0.7), with features gated per server by capabilities (see
  [ADR-0004](adr/0004-protocol-adapters.md)).

**Non-goals**

- Being a torrent *client* — the app never downloads torrent data itself; it only
  remote-controls a daemon.
- Supporting Transmission < 4.0 (RPC version < 17), Deluge 1.x, the native `deluged`
  socket protocol (Deluge is reached through its Web UI), rTorrent, or qBittorrent.
- Torrent search/indexing, RSS auto-download (may be revisited post-1.0), streaming.
- Mobile or web deployment.

## 4. Requirements

Priority: **P0** = must have (MVP), **P1** = should have, **P2** = nice to have.
Status reflects the current build.

### 4.1 Connectivity and profiles

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| C1 | Multiple named Server Profiles (host, port, HTTPS, RPC path, credentials) | P0 | ✅ |
| C2 | No single "active" server — every Panel/dialog targets the server(s) it names; all state keyed per profile; one app-wide Workspace | P0 | ✅ (revised v0.8) |
| C3 | Passwords encrypted at rest via OS keychain (safeStorage); never exposed to the UI process | P0 | ✅ |
| C4 | Per-profile trust of self-signed HTTPS certificates | P0 | ✅ |
| C5 | "Test connection" with actionable error messages (auth vs TLS vs network) | P0 | ✅ |
| C6 | Automatic CSRF (409 session-id) handling and retry | P0 | ✅ |
| C7 | View several servers simultaneously (each Torrents panel scopes to one or more servers, grouped sections, per-server error isolation) | P2 | ✅ v0.3 |
| C8 | Per-profile **Server Type** (Transmission or Deluge) with a per-protocol adapter; unsupported features hidden via capabilities ([ADR-0004](adr/0004-protocol-adapters.md)) | P1 | ✅ v0.7 |
| C9 | Deluge via its Web UI JSON-RPC (`/json`): password→session-cookie auth, auto-bind to the sole/default `deluged` host | P1 | ✅ v0.7 |

### 4.2 Torrent list

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| L1 | Live-updating list (configurable 1–10 s polling), virtualized to thousands of rows | P0 | ✅ |
| L2 | Row shows name, progress, status, speeds, ratio/ETA, peer counts | P0 | ✅ |
| L3 | Sort by name, size, progress, status, ↓/↑ speed, ratio, ETA, added date, queue position; direction toggle; persisted per profile | P0 | ✅ |
| L4 | Filters: status groups with counts, trackers, labels; combinable with text search — per Torrents panel since v0.3 | P0 | ✅ |
| L5 | Multi-select (⌘/Ctrl-click) with bulk actions | P0 | ✅ |
| L6 | Context menu: start, start now, pause, verify, reannounce, remove | P0 | ✅ |
| L7 | Optional multi-column table view (transgui-style spreadsheet): sortable headers, column show/hide, per panel | P1 | ✅ v0.3 |
| L8 | Keyboard navigation (arrows, ⇧-extend, ⌘A, space, delete) and global shortcuts with cheat sheet | P1 | ✅ v0.3 |
| L9 | Status-coded rows (stripe + tinted status text) on a soft semantic palette | P1 | ✅ v0.4 |
| L10 | Queue controls: move top/up/down/bottom (context menu), visible # column + card badge, set-exact-position dialog, drag-to-reorder rows (when queue-sorted) | P1 | ✅ v0.4/v0.6 |
| L12 | Reorder table columns by dragging headers (order persisted per panel) | P2 | ✅ v0.6 |
| L13 | Resize table column widths by dragging header borders (persisted per panel) | P2 | ✅ v0.6 |
| L11 | Swarm health: best seeder/leecher counts with health tint, sortable table columns | P1 | ✅ v0.4 |
| L14 | Action feedback, errors only: a rejected action shows a non-modal notice (what failed, on which server, the daemon's reason); successes stay silent. Status cells show the daemon's full error text on hover | P1 | ✅ v0.12 |

### 4.3 Adding torrents

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| A1 | Add via magnet link (paste), .torrent file picker, and drag-and-drop | P0 | ✅ |
| A2 | OS-level association: clicking a magnet link or .torrent anywhere opens the add dialog (app running or not) | P0 | ✅ |
| A3 | Add dialog: destination folder with live free-space, start-paused, per-file selection (metainfo parsed locally) | P0 | ✅ |
| A4 | Duplicate detection surfaced to the user | P0 | ✅ |
| A5 | Set labels at add time; bulk relabel via context menu; label chips with click-to-filter | P1 | ✅ v0.3 |
| A6 | Clipboard magnet detection: add dialog prefills a magnet link found in the clipboard | P2 | ✅ v0.4 |

### 4.4 Torrent detail

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| D1 | Detail view with General / Files / Peers / Trackers tabs | P0 | ✅ |
| D2 | Files: per-file wanted toggle and priority (high/normal/low) | P0 | ✅ |
| D3 | Trackers: list with announce health, add and remove | P0 | ✅ |
| D4 | Edit labels; move data to a new location; **Find data** (Transmission: re-point at files already on disk without moving, then verify — the fix path for "No data found") | P0 | ✅ (Find data v0.12) |
| D5 | Peers: address, client, progress, rates | P0 | ✅ |
| D6 | Files tab renders as a collapsible directory tree with folder-level wanted/priority | P1 | ✅ v0.5 |
| D7 | Per-torrent speed limits, seed-ratio override, bandwidth priority, peer limit | P1 | ✅ v0.5 |
| D8 | Pieces map (downloaded-pieces bitfield): strip in General, grid in a Pieces tab/panel | P1 | ✅ |
| D9 | Swarm availability: per-piece availability overlay on the pieces map (4.0+ `availability`) and an availability-ratio (`desiredAvailable`) list column/badge showing whether a download can finish | P1 | ✅ |
| D10 | Rename torrent root or individual files on the daemon (`torrent-rename-path`) from General/Files tabs | P1 | ✅ |

### 4.5 Daemon and app settings

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| S1 | Session settings: speed limits, alt-speed values, seeding limits, peer limits, encryption, peer port + open-port test | P0 | ✅ |
| S2 | One-click alternative-speed ("turtle") toggle in the status bar | P0 | ✅ |
| S3 | App preferences: theme (system/light/dark), polling rate | P0 | ✅ |
| S4 | Alt-speed scheduler UI (enable, begin/end time, day-of-week mask) | P2 | ✅ v0.6 |
| S5 | Blocklist management (enable, URL, size, update now) | P2 | ✅ v0.6 |
| S9 | Sequential download toggle per torrent (rpc-version ≥ 18) | P1 | ✅ v0.6 |
| S10 | Bandwidth groups: named speed-limit pools, manager dialog, per-torrent assignment | P1 | ✅ v0.6 |
| S6 | Speed Graph panel: per-server throughput over 1/5/15-min windows | P1 | ✅ v0.4 |
| S7 | Free-space gauges (status bar + stats panel) for a chosen server's download dir | P1 | ✅ v0.4 |
| S8 | Native notification on download completion (per server, click to focus + select); toggleable | P1 | ✅ v0.4 |

### 4.6 Platform and distribution

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| P1 | macOS arm64+x64 (signed, notarized DMG), Windows (NSIS), Linux (AppImage + deb with XDG magnet/torrent registration) | P0 | ✅ config (unreleased) |
| P2 | Auto-update from GitHub releases | P0 | ✅ wired |
| P3 | Single instance; second launch focuses the window and forwards its arguments | P0 | ✅ |
| P4 | System tray / menu-bar controller: speed tooltip, Show/Hide, Pause-all/Resume-all, opt-in close-to-tray | P2 | ✅ v0.5 |

### 4.7 Non-functional

- **Performance:** list stays at 60 fps with 2,000+ torrents (virtualized rows;
  pure-function filter/sort, memoized). Poll payloads use Transmission's compact
  `table` format.
- **Security:** see §3 goals; renderer has no network or Node access.
- **Reliability:** RPC failures degrade to an inline error state with the cause;
  polling resumes automatically when the daemon returns. A rejected user action
  surfaces as a non-modal notice with the daemon's reason (v0.12).
- **Compatibility:** Transmission 4.0+ (RPC 17+), verified against 4.0.5 (user's NAS)
  and 4.1.3 (dev container); Deluge 2.x via its Web UI, verified against 2.2.0 (dev
  container). Per-server-type feature support is documented in [DELUGE.md](DELUGE.md)
  (and summarized in the README matrix).

## 5. Current UI

Fixed chrome (toolbar with add/bulk actions/sort/search/server switcher/Panels menu;
status bar with aggregate speeds, turtle toggle, torrent count, daemon version)
around a flexible panel Workspace (§6). The default Workspace mirrors the classic
three-zone arrangement: filters | torrent list | tabbed detail.

## 6. Flexible panel workspace (shipped in v0.2)

Modeled on the panel system in the owner's FlimViewer app
(`electron_frontend_for_fastapi_docker_server`), which proved the pattern:
a `react-grid-layout` dashboard where every view is a panel that can be added from a
categorized picker, removed from its header, dragged by a handle, and resized — with
the layout persisted per page through Redux middleware to electron-store.

Requirements:

| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| W1 | Panel registry: every major view (torrent list, filter sidebar, each detail tab, session stats) is a registered panel type, declaratively mapped to a component | P1 | ✅ |
| W2 | "Add panel" picker grouped by category; panels removable from a header control | P1 | ✅ |
| W3 | Panels drag by handle and resize on a responsive grid; no overlap (compaction) | P1 | ✅ |
| W4 | Layout persisted per Server Profile via the existing electron-store path; sensible default layout ships out of the box and is restorable ("Reset layout") | P1 | ✅ |
| W5 | Layout schema carries a version number with a migration path (gap identified in the reference app) | P1 | ✅ |
| W6 | Multiple instances of one panel type with per-instance state (each Torrents panel owns scope, filters, sort, view — see ADR-0003) | P2 | ✅ v0.3 |

Design notes carried over from the reference implementation: UUID instance ids
(never index-based), a single source of truth driving both the picker and
validation, persistence as a middleware side-effect rather than inside reducers.
Decision record: [ADR-0002](adr/0002-flexible-panel-workspace.md).

## 7. Release plan

| Version | Contents |
|---|---|
| **0.1** ✅ | MVP core (§4, all P0s) — built and verified against live daemons |
| **0.2** ✅ | Flexible panel workspace (§6) |
| **0.3** ✅ | Multi-server Torrents panels with per-panel filters/sort/scope (C7/W6, ADR-0003); table view (L7); keyboard shortcuts (L8); labels everywhere (A5) |
| **0.4** ✅ | Semantic color system + status-coded rows (L9); speed graph panel (S6); queue controls (L10); free space (S7); completion notifications (S8); clipboard magnets (A6); swarm health (L11) |
| **0.5** ✅ | Files-as-tree (D6); per-torrent limits (D7); tray (P4) |
| **1.0** | Public launch: branding, docs site, auto-update proven in the wild |
| **0.6** ✅ | Alt-speed scheduler (S4); blocklist (S5); sequential download (S9); bandwidth groups (S10) |
| **0.7** ✅ | Deluge support via protocol adapters (C8/C9, ADR-0004): neutral capability API, infohash identity, capability-gated UI |
| **0.8** ✅ | Multi-daemon rework: removed default/active server (global workspace, per-panel server selection), per-server colors, renamed **TorrentDeck**; **qBittorrent** adapter (WebUI API v2) |
| **0.9** ✅ | Download hygiene & automation: **Size Filter** (per-server, ADR-0005) with in-dialog slider, Deluge magnet prefetch, and a retroactive per-torrent slider in the Files tab (v0.1.5); **watch folders** (client-side per server, ADR-0006); **privacy & network** settings (DHT/PeX/LPD/µTP/anonymous); **extended seeding limits** (idle/total time, action on limit); **clipboard magnet watcher** (opt-in); **Shift-click** range selection; Add-dialog Magnet/File toggle |
| **0.10** ✅ | Observability & QoL (shipped as app release v0.1.6): **peer country flags** via bundled offline GeoIP (DB-IP Lite); **Logs panel** (copy, reveal on disk) + version display; per-server **color override**; per-server **↓/↑ speeds and status breakdown** in group headers; **Pending Update** semantics — background download, explicit install only, never on quit; blocklist **default list** prefill |
| **0.11** ✅ | Add-dialog **multi-magnet batch**: copied/handed-off magnets accumulate in one dialog (deduped by infohash) instead of clobbering; add-all-then-summarize with per-row status; recording-privacy **opaque redaction** of names (superseding blur) |
| **0.12** ✅ | Action feedback & data recovery: **error-only action notice** (rejected mutations surface what/where/why; successes stay silent); daemon **error text on hover** in list cells; **Find data** in the detail Location field (Transmission set-location without move, then verify) — the fix path for *"No data found"*, where Transmission 4.0.x silently ignores a plain verify |
| Future | rTorrent adapter (XML-RPC over /RPC2); Synology Download Station adapter (scoped — build gated on a live DSM to test against; reduced capabilities); qBittorrent categories; more per-daemon depth |
| Post-1.0 | RSS feeds, completion scripts, web seeds in peers |

## 8. Success criteria

- Owner retires transgui for daily use across macOS/Windows/Linux machines.
- A fresh user goes from download → connected to their daemon in under 2 minutes
  without reading docs.
- Zero plaintext credentials on disk (audit: `strings` on the config file).
- Update flow: tagging a release delivers an installed update to all three platforms
  with no manual steps beyond the tag.
