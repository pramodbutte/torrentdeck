# TorrentDeck — User Guide

TorrentDeck is a desktop app for **remote-controlling BitTorrent daemons**. It
talks to **Transmission 4.x**, **Deluge 2.x**, and **qBittorrent 4.1+/5.x** servers, and
can show several of them at once in a single, rearrangeable workspace.

It does not download torrents itself — it's a remote control for a daemon running
elsewhere (your NAS, a seedbox, another machine, or localhost).

> Torrent names in the screenshots below are intentionally blurred.

- [Requirements](#requirements)
- [Launching the app](#launching-the-app)
- [Adding a server](#adding-a-server)
- [The main window](#the-main-window)
- [Interface reference](#interface-reference)
- [Managing servers](#managing-servers)
- [Adding torrents](#adding-torrents)
- [Working with torrents](#working-with-torrents)
- [The detail panel](#the-detail-panel)
- [Panels](#panels)
- [Server settings](#server-settings)
- [What each server supports](#what-each-server-supports)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [System tray](#system-tray)
- [Troubleshooting](#troubleshooting)

---

## Requirements

You need a running daemon to connect to:

- **Transmission 4.0+** with its RPC enabled (default port `9091`, path `/transmission/rpc`).
- **Deluge 2.x** with the **Web UI** (`deluge-web`) running (default port `8112`, path
  `/json`). The app talks to the Web UI, not the `deluged` core directly, so the Web UI
  must be running and bound to a daemon.
- **qBittorrent 4.1+ or 5.x** with the **Web UI** enabled (Tools → Options → Web UI;
  default port `8080`). Use its Web UI username and password.

See [What each server supports](#what-each-server-supports) for the per-daemon feature
differences.

---

## Launching the app

Grab the release for your platform (macOS / Windows / Linux) and launch it like any other
app. The first time you open it with no servers configured, you'll be prompted to **Add a
server**.

---

## Adding a server

Open the **Servers** menu (top-right) → **Add server…**, or click **Add server** on the
welcome screen. Fill in the connection details:

![Adding or editing a server](images/add-server.png)

| Field | Notes |
| --- | --- |
| **Display name** | Whatever you want to call it ("Home NAS", "Seedbox"). |
| **Server type** | **Transmission**, **Deluge**, or **qBittorrent** — this sets sensible defaults and tailors the form. |
| **Host** / **Port** | Address of the daemon. Defaults: Transmission `9091`, Deluge `8112`, qBittorrent `8080`. |
| **RPC path** / **Web UI path** | Transmission `/transmission/rpc`, Deluge `/json`. qBittorrent needs no path (hidden). |
| **Use HTTPS** | Enable if the daemon is behind TLS. A second checkbox lets you trust a self-signed certificate. |
| **Username / Password** | Transmission and **qBittorrent** use both. **Deluge uses only a Web UI password** (no username). |

Click **Test connection** to verify before saving — it reports the connected daemon's
version, or an actionable error (auth vs. TLS vs. network). Then **Save**.

You can add as many servers as you like; there is no single "primary" server — each panel
picks which server(s) it shows.

---

## The main window

The window is a **workspace of panels** you can rearrange freely. A typical layout:

![The main window](images/main-window.png)

- **Toolbar** (top): quick actions for the selection (start, pause, labels, remove), the
  **Add** menu, the **Servers** menu, and **Panels**.
- **Workspace**: a single, app-wide arrangement of panels (saved automatically). There's
  no single "active" server — each panel chooses the server(s) it shows.

### Arranging panels

Open the **Panels** menu (top-right) to add a panel; every type is grouped by category:

![The Panels / Add-panel menu](images/panels-menu.png)

- **Add** — pick a panel from the menu; it drops into the first free spot on the grid.
  (Single-instance panels like the tabbed *Torrent detail* are greyed out once present.)
- **Move** — drag a panel by its header.
- **Resize** — drag its bottom or bottom-right edge.
- **Remove** — click the **✕** on the panel's header.
- **Reset layout** — restores the default arrangement from the bottom of the Panels menu.

### Server colors

Each server gets a **stable pastel color** (derived from the server, so it's the same
every launch). It shows as small **squares next to a panel's title** — one per server the
panel displays, so a multi-server Torrents panel reads as a little swatch row — and as
**dots** beside server names in menus and group headers. Same server, same color
everywhere, so you always know whose data you're looking at.

To **override** a server's color, open the server editor (Servers ▾ → edit) and pick one
under **Server color** (or **Reset to default** to go back to the derived color). The
choice is saved with the server profile.

---

## Interface reference

A fully-loaded workspace, with every control numbered:

![Numbered interface reference](images/workspace-overview.png)

**Toolbar**

1. **Add** — add a torrent; the ▾ opens options (paste a magnet, choose a `.torrent`).
2. **Start** the selected torrent(s).
3. **Pause** the selected torrent(s).
4. **Set labels** on the selection.
5. **Remove** the selection (optionally deleting downloaded data).
6. **Servers** — list, add, and edit your servers.
7. **Settings** — Server settings, Bandwidth groups, Preferences, Keyboard shortcuts, and
   Check for updates.
8. **Panels** — add a panel, or reset the layout.

**Torrents panel**

9. **Server scope** — show all servers or pick which ones this panel lists.
10. **Status filter** — All / Downloading / Seeding / Paused / Verifying / Error.
11. **Tracker filter** — narrow to one tracker.
12. **Label filter** — narrow to one label/tag.
13. **Sort** — choose the sort field and direction.
14. **View toggle** — switch between card and table views.
15. **Search** — filter the visible list by name.
16. **Columns** — choose which columns show (table view).
17. **Panel title + server swatches** — the panel's server(s), color-coded; drag the
    header to move the panel, drag its edge to resize.
18. **Close panel** (✕) — remove this panel from the workspace.

**Session stats & Speed graph**

19. **Stats server** — which server the statistics are for.
20. **Graph server** — which server the speed graph plots.
21. **Graph window** — the time span shown (1 / 5 / 15 min).

**Status bar**

22. **Speeds** — download / upload for the status-bar server.
23. **Alt-speed (turtle)** — toggle alternative speed limits (Transmission).
24. **Torrent count · free space** — for the status-bar server.
25. **Status-bar server** — which server the status bar reflects.

The **Torrent detail** panel (top-right) fills in when you select a torrent — see
[The detail panel](#the-detail-panel).

---

## Managing servers

The **Servers** menu lists every configured server (with its color dot). Click one to
**edit** it, or choose **Add server…**.

![The Servers menu](images/servers-menu.png)

---

## Adding torrents

Use the **Add** button (▾ for options), drag a `.torrent` file onto the window, or open a
`magnet:` link (the app can register as your system handler for magnets).

![Adding a torrent](images/add-torrent.png)

- **Add to server** — choose which server receives the torrent. Your last choice is
  remembered.
- **Magnet link / .torrent file** — a toggle at the top of the dialog. In **Magnet** mode,
  paste a link (the clipboard is auto-detected) — or paste/copy **several**: each magnet
  becomes a row (labelled by its name, with a ✕ to drop it), and they're all added together
  to the chosen server. In **.torrent** mode, click **Choose .torrent…** or drag a file onto
  the window.
- **Destination folder** — defaults to the server's download folder; free space is shown.
- **Labels** — optional, comma-separated (Transmission and qBittorrent, where they're
  tags; Deluge if its Label plugin is on).
- **Add paused** — add without starting.

For a `.torrent`, the dialog lists every file with a checkbox and size, and a **"Skip
files under" slider** pre-unchecks small files (defaults to the server's Size Filter, see
below). Drag the slider or type an exact size in MB; you can still tick/untick individual
files afterwards.

### Size Filter — skip junk files

Set a **Size Filter** per server (in the server editor) to keep tiny files — the readme,
ad, and sample files bundled into some releases — from ever downloading. Any file below
the threshold is marked *not-wanted* on add.

- For a **`.torrent`**, this is applied instantly (the slider above starts at the server's
  threshold).
- For a **magnet**, the file list isn't known until the daemon fetches metadata, so it's
  applied *best-effort*: the moment the files appear, sub-threshold ones are skipped. On
  **Deluge** the metadata is prefetched so the filter applies before anything downloads;
  on Transmission/qBittorrent a few tiny files may briefly land before being skipped.

The filter never skips a torrent's only file, and never leaves a torrent with nothing to
download.

### Clipboard magnet watcher

In **Preferences**, enable **Watch the clipboard for magnet links**: while the app is open,
copying a `magnet:` link opens the prefilled Add dialog automatically. It's off by default
(it reads clipboard text while running).

Copy several links in a row without waiting: each new magnet is **added to the open dialog's
list** (deduped) rather than replacing the last, so you can collect a batch and add them all
at once. The same applies to clicking multiple `magnet:` links in your browser.

When a batch is added, any that are already on the server or fail are left in the list and
marked, with a short summary (e.g. *"3 added · 1 already on server"*); the dialog closes on
its own only when every link succeeded.

---

## Working with torrents

**Select** a torrent by clicking it; **⌘/Ctrl-click** toggles individual rows and
**Shift-click** selects a range from the last click to the row you click — both within one
server (a selection never spans servers). Selecting drives the detail panels.

**Actions** — from the toolbar or the right-click context menu:

- Start / Start now / Pause
- Verify local data
- Ask tracker for more peers (reannounce)
- Set labels…
- **Queue**: move to top / up / down / bottom, or set an exact position
- Remove… (optionally deleting local data)

Actions go straight to the server and the row updates on the next poll — there is no
"done" message. If the server **rejects** an action, a small notice appears above the
status bar saying what failed, on which server, and why; it fades on its own. Hover a
torrent's **status** to read a long error message in full.

**Filter, search, sort** — each Torrents panel has its own filter bar: filter by status,
tracker, or label, type in **Search**, and click a column header (table view) or the
**sort** control to reorder. Switch between **cards** and **table** views with the view
toggle. In table view you can reorder and resize columns, and — when sorted by queue
position — drag rows to reorder the queue.

**Choosing which servers a panel shows** — click the Torrents panel's server selector (the
left-most button in its filter bar, e.g. **All servers**) to show every server or tick a
specific set:

![The Torrents panel server selector](images/server-select.png)

Torrents are grouped under a collapsible header (with the server's color dot) per server;
each header shows a **status breakdown** (total, plus downloading / seeding / paused /
verifying / error counts) and the server's current **↓/↑ speed**. An unreachable server
only errors its own section. The **Session stats** and **Speed
graph** panels have their own single-server picker in their header, and the detail panels
follow whatever torrent you select — so each panel is independently pointed at a server
(see the [Panels](#panels) table).

---

## The detail panel

Select a torrent to populate the **Torrent detail** panel. Its tabs:

- **General** — status, sizes, ratio, dates, pieces summary, creator/comment, hash, and a
  **Speed & limits** section for per-torrent download/upload caps, seed-ratio, connection
  limit, and (Transmission) priority, bandwidth group, and sequential download. The
  **Location** field relocates a torrent's data: **Move** moves the files to the new
  folder; **Find data** (Transmission) points the torrent at files that are *already*
  there without moving anything, then verifies them — the fix when a torrent reports
  *"No data found"* because a drive was unmounted or a folder was moved.
- **Files** — per-file sizes and progress in a collapsible tree; set file priorities or
  deselect files you don't want. A **"Skip files under" slider** at the top applies the
  Size Filter to *this* torrent retroactively: drag it to preview which files stay (the
  checkboxes update live, nothing is sent yet — you can also tick/untick rows), then
  **Apply** to commit, or **Reset** to discard.
- **Peers** — connected peers, each with a country flag resolved from a bundled offline
  GeoIP database (no peer IP ever leaves your machine).
- **Trackers** — the torrent's trackers.
- **Pieces** — a piece map (on Transmission, with per-piece availability; on Deluge it
  shows overall progress).

You can also add **individual** detail tabs (General, Files, …) as standalone panels.

---

## Panels

| Panel | What it shows | Server |
| --- | --- | --- |
| **Torrents** | The torrent list | One or several — pick in its server selector |
| **Torrent detail** (and single tabs) | The selected torrent | Follows your selection |
| **Session stats** | Totals: speeds, counts, all-time, free space | Its own picker |
| **Speed graph** | Live ↓/↑ throughput | Its own picker |
| **Logs** | The app's own activity log, with Copy and Open file | Global (the app, not a server) |

Add any of these from **Panels → Add panel**. Server-reading panels (Session stats, Speed
graph) each carry a small server picker in their header.

---

## Server settings

**Servers menu area → the settings (⚙) menu → Server settings** opens the daemon-wide
settings. The dialog is **tabbed, one tab per server**, so you can manage every daemon
from one place — each tab shows only what that server supports.

![Server settings, tabbed per server](images/server-settings.png)

Covers: default download folder, global speed limits, **seeding** (stop at ratio, and —
where the daemon supports it — stop when idle or after a total seeding time, plus a
Pause/Remove action when a limit is reached), **privacy & network** (DHT, PeX, LPD, and
capability-gated µTP / anonymous mode, plus encryption), peers/port, and —
**Transmission only** — alternative-speed limits with a schedule, and the blocklist (when
the daemon still has Transmission's `example.com` placeholder URL, the dialog offers a
working community list — Naunter's BT_BlockLists — which is saved only when you hit Save).

The server editor (**Servers → edit a server**, or **Add server**) also carries two
client-side, per-server options:

- **Size filter** — skip files smaller than *N* MB on add (0 = off). See
  [Size Filter](#size-filter--skip-junk-files).
- **Watch folder** — a folder on *this* computer that TorrentDeck scans (about every 10 s,
  while the app is open) for new `.torrent` files and auto-adds them to this server. It
  works even with a remote daemon (the file is sent over the connection). Set an optional
  download folder, a label, and whether to add paused; the server's Size Filter applies.
  Added files move to an `.added` subfolder (rejected ones to `.failed`).

---

## What each server supports

The app hides controls a server doesn't support, so you only see what works. In short:

- **All three**: list, add/remove, start/pause/verify/reannounce, detail tabs, per-torrent
  limits + file priorities, queue reorder, free space, global speed limits, sequential
  download, labels, the **Size Filter**, client-side **watch folders**, and the
  **DHT / PeX / LPD** privacy toggles.
- **Transmission & qBittorrent**: path rename, per-tracker swarm scrape, and an
  **idle-time** seeding limit; both also show a piece **have-map** (which pieces you have).
- **qBittorrent**: a **total seed-time** limit and a Pause/Remove **action** when a
  seeding limit is reached (Deluge offers Pause/Remove too, tied to its ratio limit).
- **Privacy extras**: µTP (Transmission; build-dependent on Deluge) and anonymous mode
  (qBittorrent; build-dependent on Deluge) appear only where the daemon exposes them.
- **Transmission only**: bandwidth groups, alternative-speed scheduler, blocklist, a port
  test, **Find data** (re-point a torrent at existing files without moving them), and
  per-piece **availability** (how many peers have each piece).
- **Labels**: Transmission and qBittorrent allow **multiple** per torrent (qBittorrent
  calls them *tags*); Deluge needs its **Label plugin** and allows **one** per torrent.
- **Deluge**: the pieces map shows overall progress only (no per-piece map).

Full Deluge-vs-Transmission breakdown: **[DELUGE.md](DELUGE.md)**; qBittorrent specifics:
**[QBITTORRENT.md](QBITTORRENT.md)**.

---

## Keyboard shortcuts

Shortcuts act on the **focused** Torrents panel (click a panel to focus it — it gets a
highlighted border) and the current selection. With the mouse: **click** a row to select
it, **⌘/Ctrl-click** to add/remove rows, and **Shift-click** to select a range (within one
server).

| Key | Action |
| --- | --- |
| **↑ / ↓** | Move the selection up / down the list |
| **Shift + ↑ / ↓** | Extend the selection (within one server) |
| **⌘/Ctrl + A** | Select all torrents in a server |
| **Space** | Start / pause the selection |
| **Delete** (or **⌘/Ctrl + Backspace**) | Remove… (opens the confirm dialog) |
| **Esc** | Clear the selection |

A selection never spans servers: selecting in one server's group replaces a selection held
in another.

---

## System tray

The app can live in the system tray / menu bar: it shows combined speeds in the tooltip
and offers **Pause all / Resume all** (across every configured server) and show/hide.
Enable **close-to-tray** in Preferences to keep it running when you close the window.

---

## Troubleshooting

- **View logs** — Settings (⚙) → **View logs** (or Panels → Tools → Logs) opens a **Logs
  panel** showing the app's log; the text is selectable and there's a **Copy** button and
  **Open file** (reveals it on disk) so you can share it. The installed **version** is shown
  at the bottom of the Settings menu.
- **Updates** — when an update has downloaded, a dot appears on the Settings (⚙) button and
  the menu shows **Restart to install vX** (plus a one-time notification per version). It's
  entirely non-blocking: keep working, quit, or restart on the old version as long as you
  like — the update installs **only** when you explicitly pick *Restart to install*.
- **"Authentication failed"** — check the username/password (Deluge: the Web UI
  password). Use **Test connection** in the server editor.
- **"Certificate rejected"** — the server uses a self-signed cert; enable **Use HTTPS →
  Allow self-signed certificate** for that server.
- **"The server did not respond in time"** — the daemon is unreachable (wrong host/port,
  not running, or blocked by a firewall).
- **Deluge: "no configured daemon host" / can't connect** — the Deluge **Web UI must be
  running** and bound to a `deluged` host. The app auto-binds when there's a single host;
  if your Web UI knows several daemons and none is connected, connect one in the Deluge
  Web UI first.
- **qBittorrent: "login refused / IP banned"** — qBittorrent temporarily **bans your IP
  after several failed logins** (default: 1 hour). Fix the username/password, then wait for
  the ban to lapse or restart the qBittorrent daemon to clear it immediately. Also make
  sure the **Web UI is enabled** (Tools → Options → Web UI).
- **Transmission: "No data found!"** — the daemon can't see the torrent's files (drive
  unmounted, folder moved or deleted). On Transmission 4.0.x, **Verify local data does
  nothing** in this state — the daemon skips the check while it sees no files (4.1 runs
  it). If the files still exist, enter their folder in the detail panel's **Location**
  field and click **Find data**, then start the torrent. If they're gone, remove the
  torrent and re-add it to download again.
- **A feature is missing** — it's likely hidden because the connected server doesn't
  support it (see [What each server supports](#what-each-server-supports)).
