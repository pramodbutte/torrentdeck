/**
 * Deluge adapter (ADR-0004): implements the protocol-neutral `TorrentClient`
 * on top of the Deluge Web UI JSON-RPC (`DelugeClient`). All Deluge→canonical
 * normalization lives here or in ./deluge/normalize; the renderer never sees a
 * Deluge-shaped payload.
 *
 * Capabilities are mostly static (Deluge has no bandwidth groups, alt-speed
 * scheduler, blocklist, or per-piece availability), except `labels`, which is
 * probed live — Deluge labels come from the optional Label plugin.
 */
import type { Capabilities, RpcResult } from '@shared/types'
import { parseInfoDictFiles } from '@shared/bencode'
import { unwantedBySizeThreshold } from '@shared/sizeFilter'
import type {
  BandwidthGroup,
  Peer,
  SessionInfo,
  SessionStats,
  Torrent,
  TorrentDetail,
  TorrentFile,
  FileStat
} from '@shared/transmission'
import type { DelugeClient } from '../deluge/client'
import { DELUGE_LIST_KEYS, normalizeTorrent, type DelugeStatus } from '../deluge/normalize'
import type {
  AddResult,
  AddTorrentParams,
  QueueDirection,
  RenameResult,
  TorrentActionKind,
  TorrentClient
} from './types'

// Deluge/libtorrent per-file priority values.
const PRIO = { SKIP: 0, LOW: 1, NORMAL: 4, HIGH: 7 }

const DETAIL_KEYS = [
  ...DELUGE_LIST_KEYS,
  'comment',
  'num_pieces',
  'piece_length',
  'files',
  'file_progress',
  'file_priorities',
  'peers',
  'private',
  'all_time_download',
  'completed_time',
  'max_download_speed',
  'max_upload_speed',
  'max_connections',
  'stop_at_ratio',
  'stop_ratio',
  'sequential_download'
]

const notSupported = (feature: string): RpcResult<never> => ({
  ok: false,
  error: { kind: 'rpc', message: `${feature} is not supported on Deluge` }
})

export class DelugeAdapter implements TorrentClient {
  private caps: Capabilities | null = null

  constructor(private readonly client: DelugeClient) {}

  async getCapabilities(): Promise<RpcResult<Capabilities>> {
    if (this.caps) return { ok: true, data: this.caps }
    // Label plugin presence → labels capability. get_enabled_plugins is cheap.
    const plugins = await this.client.rpc<string[]>('core.get_enabled_plugins', [])
    // Some privacy toggles vary by Deluge build; probe the config for their keys
    // rather than assuming (e.g. this daemon exposes neither utp nor anonymous_mode).
    const cfg = await this.client.rpc<Record<string, unknown>>('core.get_config', [])
    const hasKey = (k: string): boolean => cfg.ok && !!cfg.data && k in cfg.data
    const base: Capabilities = {
      bandwidthGroups: false,
      altSpeedScheduler: false,
      blocklist: false,
      sequentialDownload: true,
      skipHashCheck: false, // Deluge's seed_mode differs semantically; not exposed
      perPieceAvailability: false,
      perTrackerSwarm: false,
      labels: plugins.ok && Array.isArray(plugins.data) && plugins.data.includes('Label'),
      renamePath: false,
      portTest: false,
      anonymousMode: hasKey('anonymous_mode'), // present only on some builds
      utp: hasKey('utp'), // not exposed by the Web UI config on some builds
      idleSeedingLimit: false, // no idle-based seeding stop
      totalSeedTimeLimit: false, // seed_time_limit has no clear enable toggle; not exposed
      seedLimitAction: true, // remove_seed_at_ratio → pause/remove when ratio is hit
      seedLimitActionDelete: false, // remove from session, no data delete
      findData: false // core.move_storage always moves the files
    }
    // Only cache once the probe actually succeeded, so a failure while the
    // server is briefly unreachable doesn't pin `labels:false` forever.
    if (plugins.ok && cfg.ok) this.caps = base
    return { ok: true, data: base }
  }

  async test(): Promise<RpcResult<{ version: string }>> {
    const res = await this.client.rpc<string>('daemon.get_version', [])
    return res.ok ? { ok: true, data: { version: res.data ?? 'unknown' } } : res
  }

  async getSession(): Promise<RpcResult<SessionInfo>> {
    const cfg = await this.client.rpc<Record<string, unknown>>('core.get_config', [])
    if (!cfg.ok) return cfg
    const c = cfg.data
    const num = (k: string): number => (typeof c[k] === 'number' ? (c[k] as number) : 0)
    const bool = (k: string): boolean => c[k] === true
    // Deluge global rates are KiB/s, -1 = unlimited. Map to Transmission's
    // enabled-flag + limit shape; features Deluge lacks default to off.
    const session = {
      version: '',
      'rpc-version': 0,
      'download-dir': (c['download_location'] as string) ?? '',
      'speed-limit-down': Math.max(0, num('max_download_speed')),
      'speed-limit-down-enabled': num('max_download_speed') > 0,
      'speed-limit-up': Math.max(0, num('max_upload_speed')),
      'speed-limit-up-enabled': num('max_upload_speed') > 0,
      'alt-speed-down': 0,
      'alt-speed-up': 0,
      'alt-speed-enabled': false,
      seedRatioLimit: num('stop_seed_ratio'),
      seedRatioLimited: bool('stop_seed_at_ratio'),
      'idle-seeding-limit': 0, // Deluge has no idle-based seeding stop
      'idle-seeding-limit-enabled': false,
      'seed-limit-action': bool('remove_seed_at_ratio') ? 'remove' : 'pause',
      'peer-limit-global': num('max_connections_global'),
      'peer-limit-per-torrent': num('max_connections_per_torrent'),
      'peer-port': num('listen_ports'),
      'peer-port-random-on-start': bool('random_port'),
      'port-forwarding-enabled': bool('upnp'),
      'dht-enabled': bool('dht'),
      'pex-enabled': bool('utpex'),
      'lpd-enabled': bool('lsd'),
      'utp-enabled': bool('utp'),
      'anonymous-mode': bool('anonymous_mode'),
      encryption: 'preferred',
      'start-added-torrents': !bool('add_paused'),
      'alt-speed-time-enabled': false,
      'alt-speed-time-begin': 0,
      'alt-speed-time-end': 0,
      'alt-speed-time-day': 0,
      'blocklist-enabled': false,
      'blocklist-url': '',
      'blocklist-size': 0
    } as unknown as SessionInfo
    return { ok: true, data: session }
  }

  setSession(fields: Partial<SessionInfo>): Promise<RpcResult<unknown>> {
    const cfg: Record<string, unknown> = {}
    if ('download-dir' in fields) cfg['download_location'] = fields['download-dir']
    if ('speed-limit-down-enabled' in fields || 'speed-limit-down' in fields) {
      cfg['max_download_speed'] = fields['speed-limit-down-enabled']
        ? (fields['speed-limit-down'] ?? 0)
        : -1
    }
    if ('speed-limit-up-enabled' in fields || 'speed-limit-up' in fields) {
      cfg['max_upload_speed'] = fields['speed-limit-up-enabled'] ? (fields['speed-limit-up'] ?? 0) : -1
    }
    if ('seedRatioLimited' in fields) cfg['stop_seed_at_ratio'] = fields['seedRatioLimited']
    if ('seedRatioLimit' in fields) cfg['stop_seed_ratio'] = fields['seedRatioLimit']
    if ('seed-limit-action' in fields) cfg['remove_seed_at_ratio'] = fields['seed-limit-action'] === 'remove'
    if ('peer-limit-global' in fields) cfg['max_connections_global'] = fields['peer-limit-global']
    if ('peer-limit-per-torrent' in fields)
      cfg['max_connections_per_torrent'] = fields['peer-limit-per-torrent']
    if ('start-added-torrents' in fields) cfg['add_paused'] = !fields['start-added-torrents']
    if ('dht-enabled' in fields) cfg['dht'] = fields['dht-enabled']
    if ('pex-enabled' in fields) cfg['utpex'] = fields['pex-enabled']
    if ('lpd-enabled' in fields) cfg['lsd'] = fields['lpd-enabled']
    if ('utp-enabled' in fields) cfg['utp'] = fields['utp-enabled']
    if ('anonymous-mode' in fields) cfg['anonymous_mode'] = fields['anonymous-mode']
    if (Object.keys(cfg).length === 0) return Promise.resolve({ ok: true, data: {} })
    return this.client.rpc('core.set_config', [cfg])
  }

  async getSessionStats(): Promise<RpcResult<SessionStats>> {
    const st = await this.client.rpc<Record<string, number>>('core.get_session_status', [
      ['payload_download_rate', 'payload_upload_rate']
    ])
    const filter = await this.client.rpc<Record<string, unknown>>('core.get_filter_tree', [])
    const down = st.ok ? (st.data['payload_download_rate'] ?? 0) : 0
    const up = st.ok ? (st.data['payload_upload_rate'] ?? 0) : 0
    // filter tree's "state" bucket carries per-state counts as [label, count] pairs.
    let torrentCount = 0
    let paused = 0
    if (filter.ok) {
      const states = (filter.data['state'] as [string, number][] | undefined) ?? []
      for (const [label, count] of states) {
        if (label === 'All') torrentCount = count
        if (label === 'Paused') paused = count
      }
    }
    return {
      ok: true,
      data: {
        activeTorrentCount: Math.max(0, torrentCount - paused),
        pausedTorrentCount: paused,
        torrentCount,
        downloadSpeed: down,
        uploadSpeed: up,
        'cumulative-stats': { uploadedBytes: 0, downloadedBytes: 0, secondsActive: 0 },
        'current-stats': { uploadedBytes: 0, downloadedBytes: 0, secondsActive: 0 }
      }
    }
  }

  async getTorrents(): Promise<RpcResult<Torrent[]>> {
    const res = await this.client.rpc<Record<string, DelugeStatus>>('core.get_torrents_status', [
      {},
      DELUGE_LIST_KEYS
    ])
    if (!res.ok) return res
    const map = res.data ?? {}
    return { ok: true, data: Object.entries(map).map(([hash, d]) => normalizeTorrent(hash, d)) }
  }

  async getTorrentDetail(id: string): Promise<RpcResult<TorrentDetail | undefined>> {
    const res = await this.client.rpc<DelugeStatus | null>('core.get_torrent_status', [id, DETAIL_KEYS])
    if (!res.ok) return res
    const d = res.data
    if (!d || Object.keys(d).length === 0) return { ok: true, data: undefined }
    return { ok: true, data: this.toDetail(id, d) }
  }

  private toDetail(hash: string, d: DelugeStatus): TorrentDetail {
    const base = normalizeTorrent(hash, d)
    const progress = (Array.isArray(d.file_progress) ? (d.file_progress as number[]) : []) ?? []
    const prios = (Array.isArray(d.file_priorities) ? (d.file_priorities as number[]) : []) ?? []
    const rawFiles = (Array.isArray(d.files) ? (d.files as Record<string, unknown>[]) : []) ?? []
    const files: TorrentFile[] = rawFiles.map((f, i) => {
      const length = typeof f.size === 'number' ? f.size : 0
      return { name: String(f.path ?? ''), length, bytesCompleted: Math.round(length * (progress[i] ?? 0)) }
    })
    const fileStats: FileStat[] = rawFiles.map((f, i) => {
      const length = typeof f.size === 'number' ? f.size : 0
      const p = prios[i] ?? PRIO.NORMAL
      return {
        bytesCompleted: Math.round(length * (progress[i] ?? 0)),
        wanted: p > 0,
        priority: p > PRIO.NORMAL ? 1 : p > 0 && p < PRIO.NORMAL ? -1 : 0
      }
    })
    const peers: Peer[] = (Array.isArray(d.peers) ? (d.peers as Record<string, unknown>[]) : []).map((p) => ({
      address: String(p.ip ?? '').split(':')[0],
      clientName: String(p.client ?? ''),
      flagStr: '',
      port: 0,
      progress: typeof p.progress === 'number' ? p.progress : 0,
      rateToClient: typeof p.down_speed === 'number' ? p.down_speed : 0,
      rateToPeer: typeof p.up_speed === 'number' ? p.up_speed : 0,
      isEncrypted: false
    }))
    const maxDown = typeof d.max_download_speed === 'number' ? d.max_download_speed : -1
    const maxUp = typeof d.max_upload_speed === 'number' ? d.max_upload_speed : -1
    return {
      ...base,
      comment: String(d.comment ?? ''),
      creator: '',
      dateCreated: 0,
      doneDate: Math.floor(typeof d.completed_time === 'number' ? d.completed_time : 0),
      activityDate: 0,
      startDate: 0,
      pieceCount: typeof d.num_pieces === 'number' ? d.num_pieces : 0,
      pieceSize: typeof d.piece_length === 'number' ? d.piece_length : 0,
      downloadedEver: typeof d.all_time_download === 'number' ? d.all_time_download : 0,
      corruptEver: 0,
      magnetLink: '',
      isPrivate: d.private === true,
      pieces: '', // no base64 bitfield from Deluge → PiecesMap degrades to progress
      availability: [],
      files,
      fileStats,
      peers,
      trackerStats: [],
      downloadLimited: maxDown > 0,
      downloadLimit: maxDown > 0 ? Math.round(maxDown) : 0,
      uploadLimited: maxUp > 0,
      uploadLimit: maxUp > 0 ? Math.round(maxUp) : 0,
      seedRatioMode: d.stop_at_ratio === true ? 1 : 0,
      seedRatioLimit: typeof d.stop_ratio === 'number' ? d.stop_ratio : 2,
      honorsSessionLimits: true,
      bandwidthPriority: 0,
      'peer-limit': typeof d.max_connections === 'number' && d.max_connections > 0 ? d.max_connections : 0,
      group: '',
      sequentialDownload: d.sequential_download === true
    }
  }

  torrentAction(action: TorrentActionKind, ids: string[]): Promise<RpcResult<unknown>> {
    switch (action) {
      case 'torrent-start':
      case 'torrent-start-now':
        return ids.length
          ? this.client.rpc('core.resume_torrent', [ids])
          : this.client.rpc('core.resume_session', [])
      case 'torrent-stop':
        return ids.length
          ? this.client.rpc('core.pause_torrent', [ids])
          : this.client.rpc('core.pause_session', [])
      case 'torrent-verify':
        return this.client.rpc('core.force_recheck', [ids])
      case 'torrent-reannounce':
        return this.client.rpc('core.force_reannounce', [ids])
    }
  }

  queueMove(direction: QueueDirection, ids: string[]): Promise<RpcResult<unknown>> {
    const method = {
      'queue-move-top': 'core.queue_top',
      'queue-move-up': 'core.queue_up',
      'queue-move-down': 'core.queue_down',
      'queue-move-bottom': 'core.queue_bottom'
    }[direction]
    return this.client.rpc(method, [ids])
  }

  removeTorrent(ids: string[], deleteData: boolean): Promise<RpcResult<unknown>> {
    return this.client.rpc('core.remove_torrents', [ids, deleteData])
  }

  async addTorrent(params: AddTorrentParams): Promise<RpcResult<AddResult>> {
    const options: Record<string, unknown> = {}
    if (params.downloadDir) options['download_location'] = params.downloadDir
    if (params.paused !== undefined) options['add_paused'] = params.paused
    if (params.sequentialDownload) options['sequential_download'] = true

    // Size Filter, Deluge-perfect path: fetch the magnet's metadata WITHOUT
    // adding it, compute the not-wanted set, and add with file priorities
    // already applied so junk never downloads. Best-effort — any failure
    // (timeout on a seederless magnet, missing method) falls through to a
    // normal add, and the main-process watcher filters once metadata arrives.
    if (params.magnet && params.sizeThresholdBytes && params.sizeThresholdBytes > 0) {
      try {
        const meta = await this.client.rpc<[string, string]>('core.prefetch_magnet_metadata', [
          params.magnet,
          10
        ])
        if (meta.ok && Array.isArray(meta.data) && typeof meta.data[1] === 'string') {
          const preview = parseInfoDictFiles(meta.data[1])
          if (preview && preview.files.length > 1) {
            const unwanted = new Set(unwantedBySizeThreshold(preview.files, params.sizeThresholdBytes))
            if (unwanted.size > 0) {
              options['file_priorities'] = preview.files.map((_, i) =>
                unwanted.has(i) ? PRIO.SKIP : PRIO.NORMAL
              )
            }
          }
        }
      } catch {
        // fall through: normal add + post-add watcher
      }
    }

    let res: RpcResult<string | null>
    if (params.magnet) {
      res = await this.client.rpc<string | null>('core.add_torrent_magnet', [params.magnet, options])
    } else if (params.metainfoBase64) {
      res = await this.client.rpc<string | null>('core.add_torrent_file', [
        'torrent.torrent',
        params.metainfoBase64,
        options
      ])
    } else {
      return notSupported('Adding without a magnet or file')
    }
    if (!res.ok) {
      // Deluge raises on a duplicate rather than returning a marker.
      if (/already|duplicate/i.test(res.error.message)) {
        return { ok: true, data: { duplicate: { id: '', name: '' } } }
      }
      return res
    }
    const hash = res.data
    if (!hash) return { ok: true, data: { duplicate: { id: '', name: '' } } }
    if (params.addToTopOfQueue) {
      await this.client.rpc('core.queue_top', [[hash]]).catch(() => undefined)
    }
    // Apply a label after add if the plugin is present and one was requested.
    if (params.labels?.length && this.caps?.labels) {
      await this.client.rpc('label.set_torrent', [hash, params.labels[0]]).catch(() => undefined)
    }
    return { ok: true, data: { added: { id: hash, name: '' } } }
  }

  async setTorrent(ids: string[], fields: Record<string, unknown>): Promise<RpcResult<unknown>> {
    // Labels (Label plugin, single label per torrent, replace semantics).
    if ('labels' in fields) {
      if (!this.caps?.labels) return { ok: true, data: {} }
      const label = Array.isArray(fields.labels) ? (fields.labels[0] ?? '') : ''
      for (const id of ids) {
        const r = await this.client.rpc('label.set_torrent', [id, label])
        if (!r.ok) return r
      }
      return { ok: true, data: {} }
    }

    // Per-file priorities (single torrent; FilesTab operates on one detail).
    const fileFieldKeys = ['files-wanted', 'files-unwanted', 'priority-high', 'priority-normal', 'priority-low']
    if (fileFieldKeys.some((k) => k in fields) && ids.length === 1) {
      return this.setFilePriorities(ids[0], fields)
    }

    // Everything else → core.set_torrent_options.
    const opts: Record<string, unknown> = {}
    if ('downloadLimit' in fields) opts['max_download_speed'] = fields['downloadLimit']
    else if (fields['downloadLimited'] === false) opts['max_download_speed'] = -1
    if ('uploadLimit' in fields) opts['max_upload_speed'] = fields['uploadLimit']
    else if (fields['uploadLimited'] === false) opts['max_upload_speed'] = -1
    if ('peer-limit' in fields) opts['max_connections'] = fields['peer-limit']
    if ('seedRatioMode' in fields) opts['stop_at_ratio'] = fields['seedRatioMode'] === 1
    if ('seedRatioLimit' in fields) opts['stop_ratio'] = fields['seedRatioLimit']
    if ('sequentialDownload' in fields) opts['sequential_download'] = fields['sequentialDownload']
    if (Object.keys(opts).length === 0) return { ok: true, data: {} }
    return this.client.rpc('core.set_torrent_options', [ids, opts])
  }

  private async setFilePriorities(
    id: string,
    fields: Record<string, unknown>
  ): Promise<RpcResult<unknown>> {
    const cur = await this.client.rpc<{ file_priorities?: number[] }>('core.get_torrent_status', [
      id,
      ['file_priorities']
    ])
    if (!cur.ok) return cur
    const prios = [...(cur.data?.file_priorities ?? [])]
    const apply = (key: string, value: number): void => {
      const idx = fields[key]
      if (Array.isArray(idx)) for (const i of idx as number[]) if (i >= 0 && i < prios.length) prios[i] = value
    }
    apply('files-unwanted', PRIO.SKIP)
    apply('files-wanted', PRIO.NORMAL)
    apply('priority-low', PRIO.LOW)
    apply('priority-normal', PRIO.NORMAL)
    apply('priority-high', PRIO.HIGH)
    return this.client.rpc('core.set_torrent_options', [[id], { file_priorities: prios }])
  }

  renamePath(_id: string, _path: string, _name: string): Promise<RpcResult<RenameResult>> {
    // Deluge renames by file index, not path; not exposed in v1 (capability off).
    return Promise.resolve(notSupported('Renaming'))
  }

  setLocation(ids: string[], location: string, _move: boolean): Promise<RpcResult<unknown>> {
    return this.client.rpc('core.move_storage', [ids, location])
  }

  async freeSpace(path: string): Promise<RpcResult<{ path: string; 'size-bytes': number }>> {
    const res = await this.client.rpc<number>('core.get_free_space', [path || null])
    if (!res.ok) return res
    return { ok: true, data: { path, 'size-bytes': res.data ?? 0 } }
  }

  getGroups(): Promise<RpcResult<BandwidthGroup[]>> {
    return Promise.resolve({ ok: true, data: [] })
  }
  setGroup(): Promise<RpcResult<unknown>> {
    return Promise.resolve(notSupported('Bandwidth groups'))
  }
  blocklistUpdate(): Promise<RpcResult<{ 'blocklist-size': number }>> {
    return Promise.resolve(notSupported('Blocklist'))
  }
  portTest(): Promise<RpcResult<{ 'port-is-open': boolean }>> {
    return Promise.resolve(notSupported('Port test'))
  }
}
