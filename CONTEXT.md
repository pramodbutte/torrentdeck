# Context

Glossary of domain terms for TorrentDeck, a desktop client that remote-controls
Transmission and Deluge BitTorrent daemons. Terms here are the canonical language for
code, UI copy, and discussion. Implementation details do not belong in this file.

## Terms

### Server Profile
A saved connection definition for one daemon: name, Server Type, address, port, TLS
settings, credentials, and per-profile UI preferences. A user may have many Server
Profiles (home NAS, seedbox, …).

### Server Type
The daemon protocol a Server Profile speaks — Transmission or Deluge. It selects the
Adapter that backs the profile and, through Capabilities, which features the UI offers.
For Deluge this is the Web UI (deluge-web), reached over its JSON-RPC endpoint.

### Adapter
The per–Server Type translator that turns the app's protocol-neutral operations into a
daemon's native RPC and normalizes replies back into the shared Torrent/Session shapes.
One Adapter implementation per Server Type; the rest of the app never sees a
daemon-specific payload.

### Capabilities
The set of features a connected server actually supports (bandwidth groups, alt-speed
scheduler, blocklist, sequential download, per-piece availability, labels, …). Reported
by the Adapter — some flags fixed by Server Type, some probed live (e.g. Deluge labels
depend on its Label plugin). The UI hides controls a server lacks rather than letting
them fail.

### Host
For a Deluge Server, the backing `deluged` daemon that the Web UI connects to. One
Web UI may know several Hosts; the app binds to the sole/default one automatically.

### Session
The daemon-wide state of a server: global speed limits, download directory, encryption
policy, port settings, and statistics. Distinct from any individual torrent. There is no
single "active" server — each Panel and dialog names the server it acts on.

### Torrent
One transfer known to a server, identified canonically by its infohash (the same identity
across daemons). A Torrent has a Status, content Files, Peers, Trackers, and optional
Labels.

### Status
The daemon-reported lifecycle state of a Torrent: stopped, queued to verify, verifying,
queued to download, downloading, queued to seed, or seeding. The UI groups these into
the coarser Status Filters.

### Status Filter
A grouping over Statuses: All, Downloading, Seeding, Paused, Verifying, Error. Together
with the Tracker filter, Label filter, and Search it forms a Torrents Panel's filters —
owned by each Panel individually, never global.

### Label
A free-form tag stored on a Torrent by the daemon (Transmission "labels"; on Deluge, the
optional Label plugin — a single label per torrent). Used for user-defined grouping and
filtering. Absent as a Capability when the daemon doesn't provide it.

### Torrents Panel
A Panel showing torrents from one or more servers (its Scope), grouped by server when
several are shown. Each instance owns its filters, sort, search, and view mode
(cards or table). Also called the Torrent List.

### Scope
The set of Server Profiles a Torrents Panel displays: either "default" (all configured
servers) or an explicit list. Other server-reading Panels (Session stats, Speed Graph)
similarly pick their own server.

### Workspace
The single, app-wide arrangement of Panels (positions, sizes, per-instance config),
persisted once for the whole app — not per server. Every Panel names the server(s) it
reads, so one Workspace can show several daemons at once.

### Selection
The torrents currently highlighted, always belonging to exactly one server
(server-qualified). Bulk actions apply to the Selection and are sent to its server.

### Detail Panel
The collapsible right-side panel inspecting the selected Torrent, with tabs:
General, Files, Peers, Trackers.

### Magnet Link
A `magnet:` URI that adds a Torrent without a metainfo file. The app registers as the
OS handler for these.

### Panel
A self-contained view (Torrents Panel, a Detail tab, session stats, Speed Graph) that
the user can add to, remove from, and rearrange within the Workspace. One Panel type
may appear as several independent instances.

### Pieces Map
A visualization of a Torrent's piece bitfield — which pieces the daemon has verified
locally — with an Availability overlay marking missing pieces that connected peers can
supply. Shown as a strip in the General tab and as a grid in the Pieces tab/Panel.

### Availability
How much of a Torrent's still-missing data connected peers can currently provide:
per piece (the overlay on the Pieces Map) and as a ratio per Torrent (the "avail"
badge/column — 100% means the download can finish with the current swarm).

### Size Filter
A rule that keeps a Torrent's smaller Files from being downloaded, so junk bundled into
a release (tiny readme, ad, or sample files) never lands on disk. Applies per Server
Profile as the default for every add, can be overridden for a single add in the Add
dialog, and can be applied retroactively to an existing Torrent from its Files tab. Files
below the Size Threshold are set not-wanted; the daemon skips them. Never skips a
Torrent's only File, and never leaves a Torrent with nothing to download.

### Size Threshold
The minimum File size the Size Filter keeps: Files at or above it download, Files below
it are skipped. A per–Server Profile value, off when zero.

### Watch Folder
A folder on the machine running TorrentDeck that the app scans for new `.torrent` files
and auto-adds them to one Server Profile. Client-side and per–Server Profile — it works
with a remote daemon (the file's contents travel over RPC), but only while the app is
running. Ingested files move to an `.added/` subfolder (failures to `.failed/`); the
Server Profile's Size Filter and add defaults apply.

### Bandwidth Group
A named speed-limit pool on the daemon. Torrents assigned to a group share its
download/upload caps. Created and edited in the Bandwidth Groups manager; a torrent
joins one from its detail panel.

### Speed Graph
A Panel plotting one server's download/upload throughput over a selectable time
window, fed by the same polling that drives the stats displays.

### Swarm
The peers available for a Torrent across its trackers. The list shows the best
seeder/leecher counts any tracker reports, with a health tint (none/few/plenty).

### Pending Update
An app update that has been downloaded and verified in the background and is ready to
install. It is applied only when the user explicitly chooses to install it — quitting or
restarting the app never applies it. Its presence is signaled quietly: a one-time
notification per version and a persistent badge; the user may defer indefinitely.

### Find Data
Re-pointing a Torrent at files that already exist at another path, without moving them,
followed by a verify. Transmission only (its set-location call can skip the move); the fix
for a Torrent reporting "No data found" after a drive was unmounted or a folder moved.
Distinct from **Move**, which relocates the files.
