/**
 * qBittorrent adapter (ADR-0004): implements the protocol-neutral `TorrentClient`
 * on top of the qBittorrent WebUI API v2 (`QbittorrentClient`). All
 * qBittorrent→canonical normalization lives here or in ./qbittorrent/normalize.
 *
 * Capabilities are static: qBittorrent has no bandwidth groups, alt-speed
 * scheduler mapping, blocklist, or port test here, but does sequential download,
 * labels (tags), rename, per-tracker swarm, and a pieces map (have-state only —
 * no per-piece availability).
 */
import type { Capabilities, RpcResult } from '@shared/types'
import type {
  BandwidthGroup,
  FileStat,
  Peer,
  SessionInfo,
  SessionStats,
  Torrent,
  TorrentDetail,
  TorrentFile,
  TrackerStat
} from '@shared/transmission'
import type { QbittorrentClient } from '../qbittorrent/client'
import { normalizeTorrent, pieceStatesToBitfield, type QbitTorrent } from '../qbittorrent/normalize'
import type {
  AddResult,
  AddTorrentParams,
  QueueDirection,
  RenameResult,
  TorrentActionKind,
  TorrentClient
} from './types'

// qBittorrent per-file priority values.
const QPRIO = { SKIP: 0, NORMAL: 1, HIGH: 6 }

const notSupported = (feature: string): RpcResult<never> => ({
  ok: false,
  error: { kind: 'rpc', message: `${feature} is not supported on qBittorrent` }
})

function num(v: unknown, f = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : f
}
function str(v: unknown, f = ''): string {
  return typeof v === 'string' ? v : f
}
/** bytes/s ↔ the kB/s figures the UI shows (Transmission-shaped). */
const toKb = (bytesPerSec: number): number => Math.round(bytesPerSec / 1024)
const toBytes = (kb: number): number => Math.round(kb * 1024)

const hashesParam = (ids: string[]): string => (ids.length ? ids.join('|') : 'all')

export class QbittorrentAdapter implements TorrentClient {
  constructor(private readonly client: QbittorrentClient) {}

  getCapabilities(): Promise<RpcResult<Capabilities>> {
    return Promise.resolve({
      ok: true,
      data: {
        bandwidthGroups: false,
        altSpeedScheduler: false,
        blocklist: false,
        sequentialDownload: true,
        skipHashCheck: true, // /torrents/add supports skip_checking
        perPieceAvailability: false,
        perTrackerSwarm: true,
        labels: true,
        renamePath: true,
        portTest: false,
        anonymousMode: true, // preferences.anonymous_mode
        utp: false, // no dedicated µTP toggle in the WebUI prefs
        idleSeedingLimit: true, // max_inactive_seeding_time
        totalSeedTimeLimit: true, // max_seeding_time
        seedLimitAction: true, // max_ratio_act (0 pause / 1 remove)
        seedLimitActionDelete: false, // delete-files enum value unverified; deferred
        findData: false // /torrents/setLocation always moves the files
      }
    })
  }

  async test(): Promise<RpcResult<{ version: string }>> {
    const res = await this.client.getText('/app/version')
    return res.ok ? { ok: true, data: { version: res.data || 'unknown' } } : res
  }

  async getSession(): Promise<RpcResult<SessionInfo>> {
    const res = await this.client.get<Record<string, unknown>>('/app/preferences')
    if (!res.ok) return res
    const p = res.data
    const enc = num(p.encryption) // 0 prefer, 1 require, 2 disable
    const session = {
      version: '',
      'rpc-version': 0,
      'download-dir': str(p.save_path),
      'speed-limit-down': toKb(num(p.dl_limit)),
      'speed-limit-down-enabled': num(p.dl_limit) > 0,
      'speed-limit-up': toKb(num(p.up_limit)),
      'speed-limit-up-enabled': num(p.up_limit) > 0,
      'alt-speed-down': toKb(num(p.alt_dl_limit)),
      'alt-speed-up': toKb(num(p.alt_up_limit)),
      'alt-speed-enabled': false,
      seedRatioLimit: num(p.max_ratio, 0),
      seedRatioLimited: p.max_ratio_enabled === true,
      'idle-seeding-limit': Math.max(0, num(p.max_inactive_seeding_time)),
      'idle-seeding-limit-enabled': p.max_inactive_seeding_time_enabled === true,
      'seed-time-limit': Math.max(0, num(p.max_seeding_time)),
      'seed-time-limit-enabled': p.max_seeding_time_enabled === true,
      'seed-limit-action': num(p.max_ratio_act) === 1 ? 'remove' : 'pause',
      'peer-limit-global': num(p.max_connec, 0),
      'peer-limit-per-torrent': num(p.max_connec_per_torrent, 0),
      'peer-port': num(p.listen_port),
      'peer-port-random-on-start': p.random_port === true,
      'port-forwarding-enabled': p.upnp === true,
      'dht-enabled': p.dht === true,
      'pex-enabled': p.pex === true,
      'lpd-enabled': p.lsd === true,
      'utp-enabled': false, // no dedicated µTP preference in the WebUI
      'anonymous-mode': p.anonymous_mode === true,
      encryption: enc === 1 ? 'required' : enc === 2 ? 'tolerated' : 'preferred',
      'start-added-torrents': !(p.add_stopped_enabled === true || p.start_paused_enabled === true),
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
    const prefs: Record<string, unknown> = {}
    if ('download-dir' in fields) prefs.save_path = fields['download-dir']
    if ('speed-limit-down-enabled' in fields || 'speed-limit-down' in fields)
      prefs.dl_limit = fields['speed-limit-down-enabled'] ? toBytes(fields['speed-limit-down'] ?? 0) : 0
    if ('speed-limit-up-enabled' in fields || 'speed-limit-up' in fields)
      prefs.up_limit = fields['speed-limit-up-enabled'] ? toBytes(fields['speed-limit-up'] ?? 0) : 0
    if ('seedRatioLimited' in fields) prefs.max_ratio_enabled = fields.seedRatioLimited
    if ('seedRatioLimit' in fields) prefs.max_ratio = fields.seedRatioLimit
    if ('idle-seeding-limit-enabled' in fields)
      prefs.max_inactive_seeding_time_enabled = fields['idle-seeding-limit-enabled']
    if ('idle-seeding-limit' in fields) prefs.max_inactive_seeding_time = fields['idle-seeding-limit']
    if ('seed-time-limit-enabled' in fields)
      prefs.max_seeding_time_enabled = fields['seed-time-limit-enabled']
    if ('seed-time-limit' in fields) prefs.max_seeding_time = fields['seed-time-limit']
    if ('seed-limit-action' in fields) prefs.max_ratio_act = fields['seed-limit-action'] === 'remove' ? 1 : 0
    if ('peer-limit-global' in fields) prefs.max_connec = fields['peer-limit-global']
    if ('peer-limit-per-torrent' in fields) prefs.max_connec_per_torrent = fields['peer-limit-per-torrent']
    if ('start-added-torrents' in fields) prefs.add_stopped_enabled = !fields['start-added-torrents']
    if ('dht-enabled' in fields) prefs.dht = fields['dht-enabled']
    if ('pex-enabled' in fields) prefs.pex = fields['pex-enabled']
    if ('lpd-enabled' in fields) prefs.lsd = fields['lpd-enabled']
    if ('anonymous-mode' in fields) prefs.anonymous_mode = fields['anonymous-mode']
    if (Object.keys(prefs).length === 0) return Promise.resolve({ ok: true, data: {} })
    return this.client.post('/app/setPreferences', { json: JSON.stringify(prefs) })
  }

  private maindata(): Promise<RpcResult<{ torrents?: Record<string, QbitTorrent>; server_state?: Record<string, unknown> }>> {
    return this.client.get('/sync/maindata', { rid: '0' })
  }

  async getSessionStats(): Promise<RpcResult<SessionStats>> {
    const res = await this.maindata()
    if (!res.ok) return res
    const torrents = res.data.torrents ?? {}
    const ss = res.data.server_state ?? {}
    let paused = 0
    for (const t of Object.values(torrents)) {
      const st = str((t as QbitTorrent).state)
      if (st.startsWith('paused') || st.startsWith('stopped')) paused++
    }
    const count = Object.keys(torrents).length
    return {
      ok: true,
      data: {
        activeTorrentCount: Math.max(0, count - paused),
        pausedTorrentCount: paused,
        torrentCount: count,
        downloadSpeed: num(ss.dl_info_speed),
        uploadSpeed: num(ss.up_info_speed),
        'cumulative-stats': { uploadedBytes: num(ss.alltime_ul), downloadedBytes: num(ss.alltime_dl), secondsActive: 0 },
        'current-stats': { uploadedBytes: num(ss.up_info_data), downloadedBytes: num(ss.dl_info_data), secondsActive: 0 }
      }
    }
  }

  async getTorrents(): Promise<RpcResult<Torrent[]>> {
    const res = await this.client.get<QbitTorrent[]>('/torrents/info')
    if (!res.ok) return res
    return { ok: true, data: (res.data ?? []).map(normalizeTorrent) }
  }

  async getTorrentDetail(id: string): Promise<RpcResult<TorrentDetail | undefined>> {
    const [infoR, propsR, filesR, trackersR, peersR, piecesR] = await Promise.all([
      this.client.get<QbitTorrent[]>('/torrents/info', { hashes: id }),
      this.client.get<Record<string, unknown>>('/torrents/properties', { hash: id }),
      this.client.get<Record<string, unknown>[]>('/torrents/files', { hash: id }),
      this.client.get<Record<string, unknown>[]>('/torrents/trackers', { hash: id }),
      this.client.get<{ peers?: Record<string, Record<string, unknown>> }>('/sync/torrentPeers', { hash: id, rid: '0' }),
      this.client.get<number[]>('/torrents/pieceStates', { hash: id })
    ])
    if (!infoR.ok) return infoR
    const base = (infoR.data ?? [])[0]
    if (!base) return { ok: true, data: undefined }
    const p = propsR.ok ? propsR.data : {}
    const rawFiles = filesR.ok ? (filesR.data ?? []) : []
    const files: TorrentFile[] = rawFiles.map((f) => {
      const length = num(f.size)
      return { name: str(f.name), length, bytesCompleted: Math.round(length * num(f.progress)) }
    })
    const fileStats: FileStat[] = rawFiles.map((f) => {
      const prio = num(f.priority, QPRIO.NORMAL)
      return {
        bytesCompleted: Math.round(num(f.size) * num(f.progress)),
        wanted: prio > 0,
        priority: prio >= QPRIO.HIGH ? 1 : 0
      }
    })
    const peers: Peer[] = peersR.ok
      ? Object.values(peersR.data?.peers ?? {}).map((pr) => ({
          address: str(pr.ip),
          clientName: str(pr.client),
          flagStr: str(pr.flags),
          port: num(pr.port),
          progress: num(pr.progress),
          rateToClient: num(pr.dl_speed),
          rateToPeer: num(pr.up_speed),
          isEncrypted: false
        }))
      : []
    const trackerStats: TrackerStat[] = (trackersR.ok ? (trackersR.data ?? []) : [])
      .filter((t) => !str(t.url).startsWith('**')) // skip DHT/PeX/LSD pseudo-entries
      .map((t, i) => {
        let host = ''
        try {
          host = new URL(str(t.url)).hostname
        } catch {
          /* leave blank */
        }
        return {
          id: i,
          announce: str(t.url),
          host,
          sitename: '',
          tier: num(t.tier),
          lastAnnounceResult: str(t.msg),
          lastAnnounceSucceeded: num(t.status) === 2,
          lastAnnounceTime: 0,
          nextAnnounceTime: 0,
          seederCount: num(t.num_seeds, -1),
          leecherCount: num(t.num_leeches, -1),
          downloadCount: num(t.num_downloaded, -1)
        }
      })
    const pieces = piecesR.ok && Array.isArray(piecesR.data) ? pieceStatesToBitfield(piecesR.data) : ''
    const ratioLimit = num(base.ratio_limit, -2)
    const dlLimit = num(p.dl_limit ?? base.dl_limit)
    const upLimit = num(p.up_limit ?? base.up_limit)

    const detail: TorrentDetail = {
      ...normalizeTorrent(base),
      comment: str(p.comment),
      creator: str(p.created_by),
      dateCreated: Math.floor(num(p.creation_date)),
      doneDate: Math.floor(num(p.completion_date)),
      activityDate: Math.floor(num(p.last_seen)),
      startDate: Math.floor(num(p.addition_date)),
      pieceCount: num(p.pieces_num),
      pieceSize: num(p.piece_size),
      downloadedEver: num(p.total_downloaded),
      corruptEver: num(p.total_wasted),
      magnetLink: str(base.magnet_uri),
      isPrivate: base.is_private === true || p.is_private === true,
      pieces,
      availability: [],
      files,
      fileStats,
      peers,
      trackerStats,
      downloadLimited: dlLimit > 0,
      downloadLimit: dlLimit > 0 ? toKb(dlLimit) : 0,
      uploadLimited: upLimit > 0,
      uploadLimit: upLimit > 0 ? toKb(upLimit) : 0,
      seedRatioMode: ratioLimit === -2 ? 0 : ratioLimit === -1 ? 2 : 1,
      seedRatioLimit: ratioLimit >= 0 ? ratioLimit : 2,
      honorsSessionLimits: true,
      bandwidthPriority: 0,
      'peer-limit': 0,
      group: '',
      sequentialDownload: base.seq_dl === true
    }
    return { ok: true, data: detail }
  }

  /** POST an action, falling back from the qBittorrent 4.x verb to the 5.x one. */
  private async actionVerb(v4: string, v5: string, params: Record<string, string>): Promise<RpcResult<unknown>> {
    const r = await this.client.post(`/torrents/${v4}`, params)
    if (!r.ok && r.error.status === 404) return this.client.post(`/torrents/${v5}`, params)
    return r
  }

  torrentAction(action: TorrentActionKind, ids: string[]): Promise<RpcResult<unknown>> {
    const hashes = hashesParam(ids)
    switch (action) {
      case 'torrent-start':
      case 'torrent-start-now':
        return this.actionVerb('resume', 'start', { hashes })
      case 'torrent-stop':
        return this.actionVerb('pause', 'stop', { hashes })
      case 'torrent-verify':
        return this.client.post('/torrents/recheck', { hashes })
      case 'torrent-reannounce':
        return this.client.post('/torrents/reannounce', { hashes })
    }
  }

  queueMove(direction: QueueDirection, ids: string[]): Promise<RpcResult<unknown>> {
    const method = {
      'queue-move-top': 'topPrio',
      'queue-move-up': 'increasePrio',
      'queue-move-down': 'decreasePrio',
      'queue-move-bottom': 'bottomPrio'
    }[direction]
    return this.client.post(`/torrents/${method}`, { hashes: hashesParam(ids) })
  }

  removeTorrent(ids: string[], deleteData: boolean): Promise<RpcResult<unknown>> {
    return this.client.post('/torrents/delete', { hashes: hashesParam(ids), deleteFiles: deleteData })
  }

  async addTorrent(params: AddTorrentParams): Promise<RpcResult<AddResult>> {
    const fields: Record<string, string | undefined> = {
      savepath: params.downloadDir,
      paused: params.paused ? 'true' : undefined,
      tags: params.labels?.length ? params.labels.join(',') : undefined,
      sequentialDownload: params.sequentialDownload ? 'true' : undefined,
      skip_checking: params.skipHashCheck ? 'true' : undefined,
      addToTopOfQueue: params.addToTopOfQueue ? 'true' : undefined,
      urls: params.magnet
    }
    const files = params.metainfoBase64
      ? [{ field: 'torrents', filename: 'torrent.torrent', content: Buffer.from(params.metainfoBase64, 'base64') }]
      : []
    const res = await this.client.postMultipart('/torrents/add', fields, files)
    if (!res.ok) return res
    // qBittorrent returns "Ok."/"Fails." with no hash, and no duplicate signal.
    if (res.data.trim() === 'Fails.') {
      return { ok: false, error: { kind: 'rpc', message: 'qBittorrent rejected the torrent' } }
    }
    return { ok: true, data: { added: { id: '', name: '' } } }
  }

  async setTorrent(ids: string[], fields: Record<string, unknown>): Promise<RpcResult<unknown>> {
    const hashes = hashesParam(ids)

    if ('downloadLimit' in fields)
      return this.client.post('/torrents/setDownloadLimit', { hashes, limit: toBytes(num(fields.downloadLimit)) })
    if (fields.downloadLimited === false)
      return this.client.post('/torrents/setDownloadLimit', { hashes, limit: 0 })
    if ('uploadLimit' in fields)
      return this.client.post('/torrents/setUploadLimit', { hashes, limit: toBytes(num(fields.uploadLimit)) })
    if (fields.uploadLimited === false)
      return this.client.post('/torrents/setUploadLimit', { hashes, limit: 0 })

    if ('seedRatioMode' in fields || 'seedRatioLimit' in fields) {
      const mode = num(fields.seedRatioMode, 0)
      const ratioLimit = mode === 0 ? -2 : mode === 2 ? -1 : num(fields.seedRatioLimit, 0)
      return this.client.post('/torrents/setShareLimits', {
        hashes,
        ratioLimit,
        seedingTimeLimit: -2,
        inactiveSeedingTimeLimit: -2
      })
    }

    if ('sequentialDownload' in fields && ids.length) {
      // qBittorrent only *toggles*; flip only when the current state differs.
      const info = await this.client.get<QbitTorrent[]>('/torrents/info', { hashes: ids[0] })
      const current = info.ok && (info.data ?? [])[0]?.seq_dl === true
      if (current !== (fields.sequentialDownload === true))
        return this.client.post('/torrents/toggleSequentialDownload', { hashes })
      return { ok: true, data: {} }
    }

    // Per-file priorities (single torrent from the Files tab).
    const fileMap: [string, number][] = [
      ['files-unwanted', QPRIO.SKIP],
      ['files-wanted', QPRIO.NORMAL],
      ['priority-low', QPRIO.NORMAL],
      ['priority-normal', QPRIO.NORMAL],
      ['priority-high', QPRIO.HIGH]
    ]
    for (const [key, prio] of fileMap) {
      if (Array.isArray(fields[key]) && ids.length) {
        const idx = (fields[key] as number[]).join('|')
        return this.client.post('/torrents/filePrio', { hash: ids[0], id: idx, priority: prio })
      }
    }

    // Labels → tags (replace: strip current, add desired), per torrent.
    if ('labels' in fields) {
      const desired = Array.isArray(fields.labels) ? (fields.labels as string[]) : []
      const info = await this.client.get<QbitTorrent[]>('/torrents/info', { hashes })
      for (const t of info.ok ? (info.data ?? []) : []) {
        const cur = str(t.tags)
        if (cur) await this.client.post('/torrents/removeTags', { hashes: str(t.hash), tags: cur })
        if (desired.length) await this.client.post('/torrents/addTags', { hashes: str(t.hash), tags: desired.join(',') })
      }
      return { ok: true, data: {} }
    }

    return { ok: true, data: {} }
  }

  async renamePath(id: string, path: string, name: string): Promise<RpcResult<RenameResult>> {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    const newPath = parent + name
    const res = await this.client.post('/torrents/renameFile', { hash: id, oldPath: path, newPath })
    if (!res.ok) return res
    return { ok: true, data: { id, path: newPath, name } }
  }

  setLocation(ids: string[], location: string): Promise<RpcResult<unknown>> {
    return this.client.post('/torrents/setLocation', { hashes: hashesParam(ids), location })
  }

  async freeSpace(path: string): Promise<RpcResult<{ path: string; 'size-bytes': number }>> {
    const res = await this.maindata()
    if (!res.ok) return res
    return { ok: true, data: { path, 'size-bytes': num(res.data.server_state?.free_space_on_disk) } }
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
