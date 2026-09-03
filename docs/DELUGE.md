# Deluge support — capabilities vs. Transmission

TorrentDeck drives both Transmission and Deluge through per-daemon adapters
([ADR-0004](adr/0004-protocol-adapters.md)). The UI is the same for both; features a
server can't honor are hidden per profile via its reported **Capabilities**. This page
documents exactly what a Deluge profile supports, what degrades, and what is unavailable
compared to a Transmission 4.x profile.

Deluge is reached over the **Deluge Web UI** (`deluge-web`) JSON-RPC endpoint
(`/json`, default port `8112`) — not the native `deluged` socket. The Web UI must be
running. Tested against Deluge **2.2.0**.

## Connection differences

| | Transmission | Deluge |
| --- | --- | --- |
| Endpoint | daemon RPC (`/transmission/rpc`, `:9091`) | Web UI JSON-RPC (`/json`, `:8112`) |
| Auth | username + password (HTTP Basic) | **single Web UI password** (no username) → session cookie |
| Extra hop | — | Web UI must be **bound to a `deluged` host**; the app auto-binds the sole/default one |
| Versions | 4.x (RPC 17+) | 2.x |

If the Web UI knows several daemon hosts and none is connected, the app can't guess which
to use and shows an actionable error — connect one in the Deluge Web UI first. With the
usual single-daemon setup this never comes up.

## Full parity

These behave the same as on Transmission:

- **Torrent list & live polling** — name, size, status, progress, ↓/↑ rates, ratio, ETA,
  added date, queue position, download dir, peer counts.
- **Add** by magnet or `.torrent` file (with destination + start-paused); **remove** with
  or without data.
- **Actions** — start, pause, verify (force recheck), reannounce (force reannounce).
  *(Deluge has no distinct "start now"; it maps to start.)*
- **Detail tabs** — General, Files (with **per-file priorities**: skip / low / normal /
  high), Peers, Trackers (tracker list).
- **Per-torrent limits** — download/upload speed caps, max connections, seed-ratio stop
  (`stop_at_ratio` / `stop_ratio`), and **sequential download**.
- **Queue reorder** — move top / up / down / bottom, and drag-to-reorder.
- **Free space** and **global session settings** — default download folder, global
  speed limits, global/per-torrent peer limits, stop-seeding-at-ratio, start-added-paused.

## Degraded (works, but with less data than Transmission)

| Feature | On Transmission | On Deluge |
| --- | --- | --- |
| **Swarm health** (seeders/leechers dot) | best-tracker scrape counts | swarm **totals** (`total_seeds` / `total_peers`) — approximate, not per-tracker |
| **Availability %** | per-piece, from missing-data availability | derived from `distributed_copies` (full copies in the swarm); ≥1 copy reads as fully available |
| **Pieces map** | per-piece verified/availability overlay | **progress only** — Deluge exposes no per-piece bitfield, so the map degrades |
| **Trackers tab** | per-tracker scrape (seeds/leeches/downloads, announce times) | tracker **list** only; no per-tracker scrape stats |
| **ETA** | daemon-provided | shown only while actively downloading (Deluge reports 0 otherwise → treated as unknown) |
| **"Honor global limits"** toggle | real per-torrent flag | always on (Deluge has no per-torrent override of this) |
| **Session version** in settings | reported | blank in the session view; the daemon version shows via Test Connection instead |

## Not supported on Deluge (hidden or unavailable)

Controls for these are **hidden** on a Deluge profile (capability-gated), so you won't see
dead buttons:

| Feature | Why |
| --- | --- |
| **Bandwidth groups** | No equivalent in Deluge. |
| **Alt-speed limits + scheduler** (status-bar turtle, schedule) | Deluge's scheduling is a separate *Scheduler* plugin, not wired in v1. |
| **Blocklist** (enable / URL / update) | Deluge's blocklist is a separate *Blocklist* plugin, not wired in v1. |
| **Bandwidth priority** (High/Normal/Low per torrent) | No Transmission-style priority in Deluge. |
| **Per-piece availability overlay** | Deluge exposes no per-piece data (see Degraded). |
| **Path rename** (rename file/folder within a torrent) | Deluge renames by file index, not path; not exposed in v1. |
| **Port test** | Not wired in v1. |
| **Find data** (re-point at existing files without moving) | `core.move_storage` always moves; Deluge has no set-location-only call. **Move** is offered. |

Additional behavioral limits:

- **Labels** require Deluge's **Label plugin**. When it's enabled, labels work but Deluge
  allows **one label per torrent** (setting labels replaces, and only the first is used);
  when the plugin is absent, label UI is hidden. Transmission supports multiple free-form
  labels natively.
- **Selective files at add-time** — Transmission can mark files unwanted in the add
  dialog; on Deluge, add first, then set file priorities from the Files tab.

## Attempting an unsupported action

If an unsupported operation is ever invoked directly, the Deluge adapter returns a clean
`"… is not supported on Deluge"` error rather than crashing — but in normal use the
capability gating means the trigger isn't shown in the first place.

## Download hygiene & automation (v0.9)

- **Size Filter** — on a magnet, Deluge is the one daemon that filters *before* adding:
  `core.prefetch_magnet_metadata` fetches the file list and the torrent is added with file
  priorities already set, so sub-threshold files never download. (`.torrent` adds filter
  at add time, like every daemon.)
- **Privacy & network** — DHT (`dht`), PeX (`utpex`), and LPD (`lsd`) are supported. µTP
  and anonymous mode are **build-dependent**: the adapter probes `core.get_config` and only
  offers them when the daemon exposes those keys (the current dev build exposes neither).
- **Seeding** — the ratio limit maps to `stop_seed_at_ratio` / `stop_seed_ratio`, and the
  **action on limit** (Pause / Remove) maps to `remove_seed_at_ratio`. Idle-time and total
  seed-time limits are **not** exposed (no clean session-global toggle).
- **Watch folders** are client-side and daemon-agnostic — they work with the remote Web UI
  because the `.torrent` bytes are sent over the connection.

## Under the hood

The mapping lives entirely in the main process: `src/main/rpc/deluge/client.ts` (JSON-RPC
transport, cookie auth, host binding), `src/main/rpc/deluge/normalize.ts` (pure
Deluge→canonical mappers — state strings, 0–100 progress, infohash id, swarm,
availability), and `src/main/rpc/adapters/deluge.ts` (the `TorrentClient` implementation
and write-field translation). Capabilities are reported by the adapter; the renderer reads
them via `useServerCapabilities` / `can()`.
