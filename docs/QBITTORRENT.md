# qBittorrent support — capabilities vs. Transmission

TorrentDeck drives Transmission, Deluge, and qBittorrent through per-daemon adapters
([ADR-0004](adr/0004-protocol-adapters.md)). The UI is the same for all; features a server
can't honor are hidden per profile via its reported **Capabilities**. This page documents
exactly what a qBittorrent profile supports, what degrades, and what is unavailable
compared to a Transmission 4.x profile.

qBittorrent is reached over its **WebUI API v2** (HTTP `/api/v2`, default port `8080`). The
Web UI must be enabled (Tools → Options → Web UI). Tested against qBittorrent **5.2.2** and
the 4.1+ API.

## Connection differences

| | Transmission | qBittorrent |
| --- | --- | --- |
| Endpoint | daemon RPC (`/transmission/rpc`, `:9091`) | WebUI API v2 (`/api/v2`, `:8080`) |
| Auth | username + password (HTTP Basic) | username + password → session cookie (`SID` / `QBT_SID_<port>`) |
| CSRF | — | requests send a `Referer`/`Origin` header matching the base URL |
| Versions | 4.x (RPC 17+) | 4.1+ and 5.x |

**IP bans:** qBittorrent temporarily **bans your IP after several failed logins** (default
1 hour). If Test Connection reports a refused/banned login, fix the credentials and either
wait for the ban to lapse or restart the daemon to clear it (the ban is in-memory).

## Full parity

These behave the same as on Transmission:

- **Torrent list & live polling** — name, size, status, progress, ↓/↑ rates, ratio, ETA,
  added date, queue position, download dir, peer counts.
- **Add** by magnet or `.torrent` file (with destination + start-paused); **remove** with
  or without data.
- **Actions** — start, pause, verify (force recheck), reannounce.
  *(qBittorrent 5.x renamed pause/resume to stop/start; the adapter uses whichever the
  daemon accepts.)*
- **Detail tabs** — General, Files (with **per-file priorities**: skip / normal / high /
  maximal), Peers, Trackers (per-tracker scrape).
- **Per-torrent limits** — download/upload speed caps, seed-ratio / seed-time stop, and
  **sequential download**.
- **Queue reorder** — move top / up / down / bottom, and drag-to-reorder.
- **Path rename** — rename a file or folder within a torrent.
- **Free space** and **global session settings** — default download folder, global speed
  limits, seeding limits, start-added-paused.
- **Per-tracker swarm** — seeds/leechers come from each tracker's scrape.
- **Labels** — qBittorrent **tags**; multiple per torrent, like Transmission's labels.

## Degraded (works, but with less data than Transmission)

| Feature | On Transmission | On qBittorrent |
| --- | --- | --- |
| **Pieces map** | per-piece verified **and** availability overlay | **have-map only** — qBittorrent reports which pieces you have, but not per-piece availability, so the availability overlay is hidden |
| **Availability %** | per-piece, from missing-data availability | from the API's `availability` figure (swarm copies); no per-piece breakdown |

## Not supported on qBittorrent (hidden or unavailable)

Controls for these are **hidden** on a qBittorrent profile (capability-gated), so you won't
see dead buttons:

| Feature | Why |
| --- | --- |
| **Bandwidth groups** | No equivalent in qBittorrent. |
| **Alt-speed limits + scheduler** (status-bar turtle, schedule) | qBittorrent has an alternate-rate mode and its own scheduler, but they're not wired into the neutral UI in v1. |
| **Blocklist** (enable / URL / update) | Managed in qBittorrent's own options; not wired in v1. |
| **Per-piece availability overlay** | qBittorrent exposes no per-piece availability (see Degraded). |
| **Port test** | Not wired in v1. |
| **Find data** (re-point at existing files without moving) | `/torrents/setLocation` always moves the files. **Move** is offered. |

## Attempting an unsupported action

If an unsupported operation is ever invoked directly, the qBittorrent adapter returns a
clean `"… is not supported on qBittorrent"` error rather than crashing — but in normal use
the capability gating means the trigger isn't shown in the first place.

## Download hygiene & automation (v0.9)

- **Size Filter** — `.torrent` adds filter at add time; magnets are **best-effort** (no
  metadata-preview in the WebUI API), so the app adds the magnet, then marks sub-threshold
  files not-wanted the moment the file list appears. A few tiny files may briefly land
  first.
- **Privacy & network** — DHT (`dht`), PeX (`pex`), LPD (`lsd`), and **anonymous mode**
  (`anonymous_mode`) are supported; there's no dedicated µTP preference.
- **Seeding** — idle-time (`max_inactive_seeding_time`) and total seed-time
  (`max_seeding_time`) limits, plus a Pause/Remove **action** on limit (`max_ratio_act`
  0/1). The "remove + delete files" action is deferred (its enum value is unverified).
- **Watch folders** are client-side and daemon-agnostic.

## Under the hood

The mapping lives entirely in the main process: `src/main/rpc/qbittorrent/client.ts` (HTTP
`/api/v2` transport, cookie auth, CSRF header, 403 re-login self-heal),
`src/main/rpc/qbittorrent/normalize.ts` (pure qBittorrent→canonical mappers — state
strings, 0–1 progress, infohash id, tags→labels, per-piece have-map bitfield), and
`src/main/rpc/adapters/qbittorrent.ts` (the `TorrentClient` implementation and write-field
translation, including the v4/v5 verb fallback). Capabilities are reported by the adapter;
the renderer reads them via `useServerCapabilities` / `can()`.
