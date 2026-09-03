<p align="center"><img src="docs/images/wordmark.png" width="460" alt="TorrentDeck"></p>

# TorrentDeck

**One desktop app for all your torrent servers.** TorrentDeck manages
[Transmission](https://transmissionbt.com), [Deluge](https://deluge-torrent.org), and
[qBittorrent](https://www.qbittorrent.org), **several servers at once, side by side** in
one rearrangeable, color-coded dashboard on macOS (Apple Silicon), Windows, and Linux.

Mix a Transmission NAS, a Deluge seedbox, and a local qBittorrent in the same window; each
server shows only the controls it actually supports. If you're looking for a
**transgui alternative** — [transgui](https://github.com/transmission-remote-gui/transgui)
is unmaintained and never ran natively on Apple Silicon — TorrentDeck is a maintained,
Apple-Silicon-native successor that also speaks Deluge and qBittorrent.

![TorrentDeck -> Transmission, Deluge, and qBittorrent in one dashboard](docs/images/demo.gif)

> Every daemon in one rearrangeable, color-coded dashboard. *(Torrent names blurred.)*

Electron + TypeScript + React, with Redux Toolkit / RTK Query for state. All RPC traffic
runs through the Electron main process (see [ADR-0001](docs/adr/0001-rpc-via-main-process.md)),
where a per-daemon **adapter** translates protocol-neutral operations into each daemon's
native RPC (see [ADR-0004](docs/adr/0004-protocol-adapters.md)); passwords are stored with
the OS keychain via `safeStorage`.

Each server profile picks a **Server Type**:

- **Transmission 4.x** (RPC version 17+) — full feature set.
- **Deluge 2.x** via its Web UI (`deluge-web`, default `:8112/json`). The Web UI must be
  running; the app does not speak to `deluged` directly.
- **qBittorrent 4.1+ / 5.x** via its WebUI API (default `:8080`).

Features a server doesn't support are hidden automatically per profile (see the matrix below).

## Documentation

- [User guide](docs/USER_GUIDE.md) — how to use the app: servers, panels, torrents, settings (with screenshots)
- [Product requirements (PRD)](docs/PRD.md) — problem, users, requirement tables with status, release plan
- [Architecture](docs/ARCHITECTURE.md) — process model, data flow, state, security, testing
- [Domain glossary](CONTEXT.md) — the canonical vocabulary used in code and UI
- [Deluge support](docs/DELUGE.md) — Deluge vs. Transmission capabilities, degrades, and limits
- [qBittorrent support](docs/QBITTORRENT.md) — qBittorrent vs. Transmission capabilities, degrades, and limits
- [Releasing](docs/RELEASING.md) — how to build, sign/notarize, and publish a release; auto-update
- [Decision records](docs/adr/) — 0001 RPC-via-main-process, 0002 flexible panel workspace, 0003 server-qualified selection, 0004 protocol adapters

## Supported features by server type

| Feature | Transmission 4.x | Deluge 2.x (Web UI) | qBittorrent 4.1+/5.x |
| --- | --- | --- | --- |
| List / add (magnet + file) / remove / start / pause / verify / reannounce | ✓ | ✓ | ✓ |
| Detail: general, files (+ priorities), peers, trackers | ✓ | ✓ | ✓ |
| Peer country flags (offline GeoIP, client-side) | ✓ | ✓ | ✓ |
| Per-torrent limits, seed-ratio, queue reorder, free space, global speed limits | ✓ | ✓ | ✓ |
| Sequential download | ✓ (RPC ≥ 18) | ✓ | ✓ |
| Size filter (skip small files on add) | ✓ | ✓ *(metadata prefetch on magnets)* | ✓ |
| Watch folder (client-side, per server) | ✓ | ✓ | ✓ |
| Privacy: DHT / PeX / LPD | ✓ | ✓ | ✓ |
| Privacy: µTP | ✓ | *(build-dependent)* | — |
| Privacy: anonymous mode | — | *(build-dependent)* | ✓ |
| Seeding: idle-time limit | ✓ | — | ✓ |
| Seeding: total seed-time limit | — | — | ✓ |
| Seeding: action on limit (pause / remove) | — *(pauses)* | ✓ | ✓ |
| Labels | ✓ | ✓ *(Label plugin; single label)* | ✓ *(tags; multiple)* |
| Pieces map | ✓ *(+ per-piece availability)* | — *(progress only)* | ✓ *(have-state; no availability)* |
| Per-tracker swarm scrape | ✓ | approximate *(swarm totals)* | ✓ |
| Path rename | ✓ | — | ✓ |
| Find data (re-point at existing files without moving) | ✓ | — | — |
| Bandwidth groups | ✓ | — | — |
| Alt-speed scheduler | ✓ | — | — |
| Blocklist | ✓ | — | — |
| Port test | ✓ | — | — |

See [docs/DELUGE.md](docs/DELUGE.md) and [docs/QBITTORRENT.md](docs/QBITTORRENT.md) for the
full per-daemon breakdowns; each server type's exact support is reported live via
capabilities and unsupported controls are hidden per profile.

## Features

- Multiple servers (any mix of Transmission, Deluge, and qBittorrent) shown together, each
  panel scoped to the server(s) you choose; per-server color coding with a custom color
  per profile
- **Flexible panel workspace** — add, remove, resize, and rearrange panels (torrent
  lists, detail tabs, speed graph, session stats, pieces map, logs); run several
  instances of the same panel watching different servers side by side
- Torrent list with live polling, search, sorting, and per-panel filters by status,
  tracker, and label — as cards or a **multi-column table** (pick columns, click to
  sort); server group headers show each server's **live ↓/↑ speeds and a
  downloading/seeding/paused breakdown**
- Add torrents by magnet link, `.torrent` file, or drag-and-drop, with destination
  folder, free-space check, file selection, and start-paused
- **Size filter**: skip files below a per-server size threshold so junk (tiny readme/ad
  files) never downloads: a server default, an in-dialog slider for `.torrent` adds
  (applied automatically to magnets), and a retroactive "skip files under…" slider in a
  torrent's Files tab
- **Watch folders**: a per-server folder the app scans while open, auto-adding dropped
  `.torrent` files (works with remote daemons)
- **Clipboard magnet watcher** (opt-in) — offers to add a magnet link as soon as you copy
  it; copy several in a row and they collect into one batch add (deduped)
- OS integration: registers as handler for `magnet:` links and `.torrent` files; system
  tray with live speeds and close-to-tray; download-complete notifications
- Detail panel: general info, files as a collapsible tree with per-file wanted/priority,
  **peers with country flags** (offline GeoIP — no IP ever leaves your machine), tracker
  management with per-tracker swarm stats, and a **pieces map** with availability overlay
- Per-torrent speed limits and seeding limits, queue reordering (drag-to-reorder
  included), labels, path rename, and set-location
- Multi-select with Cmd/Ctrl-click and **Shift-click range selection**; keyboard
  shortcuts throughout
- Session settings (speed limits, alt-speed turtle with scheduler, seeding limits incl.
  idle/total-time, privacy — DHT/PeX/LPD/µTP/anonymous, encryption, port test, blocklist
  with a one-click default list, bandwidth groups)
- **Logs panel** with copy and reveal-on-disk; app version shown in the Settings menu
- Updates download in the background and install **only when you choose** — a badge marks
  the pending update; quitting or restarting never force-installs
- Light/dark theme

The app icon is original artwork for this project (a color-coded "deck" of torrent
panels) see `build/icon.svg` (GPL-2.0-or-later, like the rest of the project).

Peer country flags use the bundled **DB-IP IP-to-Country Lite** database — IP
Geolocation by [DB-IP](https://db-ip.com), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Lookups are fully offline;
no peer IP ever leaves your machine.

## Development

```sh
nvm use               # Node 22
npm install
cd dev-daemon && docker compose up -d && cd ..               # Transmission at localhost:9091 (dev/devpass)
cd dev-daemon/deluge && docker compose up -d && cd ../..      # Deluge Web UI at localhost:8112 (password "deluge")
cd dev-daemon/qbittorrent && docker compose up -d && cd ../.. # qBittorrent WebUI at localhost:8080 (admin/adminadmin)
npm run dev
```

Run tests with `npm test`, typecheck with `npm run typecheck`.

## Release

macOS & Windows are built + signed **locally**; Linux (AppImage + deb) is built by **CI**;
everything publishes to one GitHub Release that the in-app auto-updater consumes. After the
[one-time setup](docs/RELEASING.md#one-time-setup) (`gh auth login` + a git-ignored
`.env.release` with your Apple creds):

```sh
npm version <ver> --no-git-tag-version && git commit -am "chore(release): <ver>" && git push
scripts/release.sh mac && scripts/release.sh win     # signed/notarized mac + win → draft
git tag v<ver> && git push origin v<ver>             # Linux via CI → same release
gh release edit v<ver> --repo pramod-bls/torrentdeck --draft=false --latest
```

Full procedure, platform/signing matrix, auto-update details, and troubleshooting:
**[docs/RELEASING.md](docs/RELEASING.md)**.
