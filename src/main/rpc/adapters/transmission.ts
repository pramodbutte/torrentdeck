/**
 * Transmission adapter (ADR-0004): implements the protocol-neutral
 * `TorrentClient` on top of the raw `TransmissionClient` transport. This is
 * where the response normalization that used to live in the renderer's
 * `rpcApi.ts` now runs — `tableToObjects`, `deriveSwarm`, `deriveAvailRatio`,
 * and the `sequential_download` snake_case fix — so the renderer receives
 * finished `Torrent`/`TorrentDetail` objects.
 *
 * Identity: the canonical `id` is set to `hashString`. Transmission RPC accepts
 * infohashes anywhere it accepts numeric ids, so passing hash `ids` straight
 * through to torrent-* methods works unchanged.
 */
import type { Capabilities, RpcResult } from '@shared/types'
import {
  TORRENT_DETAIL_FIELDS,
  TORRENT_LIST_FIELDS,
  deriveAvailRatio,
  deriveSwarm,
  tableToObjects,
  type BandwidthGroup,
  type SessionInfo,
  type SessionStats,
  type Torrent,
  type TorrentDetail,
  type TrackerStat
} from '@shared/transmission'
import type { TransmissionClient } from '../client'
import type {
  AddResult,
  AddTorrentParams,
  QueueDirection,
  RenameResult,
  TorrentActionKind,
  TorrentClient
} from './types'

export class TransmissionAdapter implements TorrentClient {
  private rpcVersion: number | null = null

  constructor(private readonly client: TransmissionClient) {}

  async getCapabilities(): Promise<RpcResult<Capabilities>> {
    if (this.rpcVersion === null) {
      const res = await this.client.call<{ 'rpc-version'?: number }>('session-get', {
        fields: ['rpc-version']
      })
      if (!res.ok) return res
      this.rpcVersion = res.data['rpc-version'] ?? 17
    }
    return {
      ok: true,
      data: {
        bandwidthGroups: true,
        altSpeedScheduler: true,
        blocklist: true,
        // sequentialDownload landed in rpc-version 18 (Transmission 4.1+)
        sequentialDownload: this.rpcVersion >= 18,
        skipHashCheck: false, // torrent-add has no skip-verify option
        perPieceAvailability: true,
        perTrackerSwarm: true,
        labels: true,
        renamePath: true,
        portTest: true,
        anonymousMode: false, // Transmission has no anonymous mode
        utp: true, // utp-enabled
        idleSeedingLimit: true, // idle-seeding-limit(-enabled)
        totalSeedTimeLimit: false, // no total seeding-time limit
        seedLimitAction: false, // ratio/idle limit only pauses
        seedLimitActionDelete: false,
        findData: true // torrent-set-location with move=false re-points without moving
      }
    }
  }

  test(): Promise<RpcResult<{ version: string }>> {
    return this.client
      .call<{ version?: string }>('session-get', { fields: ['version', 'rpc-version'] })
      .then((res) =>
        res.ok ? { ok: true, data: { version: res.data.version ?? 'unknown' } } : res
      )
  }

  getSession(): Promise<RpcResult<SessionInfo>> {
    return this.client.call<SessionInfo>('session-get')
  }

  setSession(fields: Partial<SessionInfo>): Promise<RpcResult<unknown>> {
    return this.client.call('session-set', fields)
  }

  getSessionStats(): Promise<RpcResult<SessionStats>> {
    return this.client.call<SessionStats>('session-stats')
  }

  async getTorrents(): Promise<RpcResult<Torrent[]>> {
    const res = await this.client.call<{ torrents: unknown[][] }>('torrent-get', {
      fields: TORRENT_LIST_FIELDS,
      format: 'table'
    })
    if (!res.ok) return res
    const list = tableToObjects<Torrent & { trackerStats?: TrackerStat[] }>(res.data.torrents).map(
      (t) => {
        // Strip the heavy trackerStats array before it leaves the main process;
        // only the derived swarm aggregates travel with list torrents.
        const { trackerStats, ...rest } = t
        return {
          ...rest,
          id: rest.hashString,
          ...deriveSwarm(trackerStats),
          availRatio: deriveAvailRatio(rest.leftUntilDone, rest.desiredAvailable)
        } as Torrent
      }
    )
    return { ok: true, data: list }
  }

  async getTorrentDetail(id: string): Promise<RpcResult<TorrentDetail | undefined>> {
    const res = await this.client.call<{
      torrents: (TorrentDetail & { sequential_download?: boolean })[]
    }>('torrent-get', { ids: [id], fields: TORRENT_DETAIL_FIELDS })
    if (!res.ok) return res
    const t = res.data.torrents[0]
    const detail = t
      ? ({
          ...t,
          id: t.hashString,
          ...deriveSwarm(t.trackerStats),
          availRatio: deriveAvailRatio(t.leftUntilDone, t.desiredAvailable),
          // daemon returns snake_case; older daemons omit it entirely
          sequentialDownload: t.sequential_download ?? t.sequentialDownload ?? false
        } as TorrentDetail)
      : undefined
    return { ok: true, data: detail }
  }

  torrentAction(action: TorrentActionKind, ids: string[]): Promise<RpcResult<unknown>> {
    // Empty ids = all torrents: Transmission targets everything when `ids` is
    // omitted, so drop it rather than sending an empty array (which matches
    // nothing). Used by the tray's Pause-all / Resume-all.
    return this.client.call(action, ids.length ? { ids } : {})
  }

  queueMove(direction: QueueDirection, ids: string[]): Promise<RpcResult<unknown>> {
    return this.client.call(direction, { ids })
  }

  removeTorrent(ids: string[], deleteData: boolean): Promise<RpcResult<unknown>> {
    return this.client.call('torrent-remove', { ids, 'delete-local-data': deleteData })
  }

  async addTorrent(params: AddTorrentParams): Promise<RpcResult<AddResult>> {
    const res = await this.client.call<{
      'torrent-added'?: { hashString: string; name: string }
      'torrent-duplicate'?: { hashString: string; name: string }
    }>('torrent-add', {
      ...(params.magnet ? { filename: params.magnet } : {}),
      ...(params.metainfoBase64 ? { metainfo: params.metainfoBase64 } : {}),
      ...(params.downloadDir ? { 'download-dir': params.downloadDir } : {}),
      ...(params.paused !== undefined ? { paused: params.paused } : {}),
      ...(params.unwantedIndices && params.unwantedIndices.length
        ? { 'files-unwanted': params.unwantedIndices }
        : {}),
      ...(params.labels && params.labels.length ? { labels: params.labels } : {})
    })
    if (!res.ok) return res
    const added = res.data['torrent-added']
    const dup = res.data['torrent-duplicate']
    // torrent-add can't set these, so apply them to the new torrent afterward.
    const hash = added?.hashString ?? dup?.hashString
    if (hash) {
      if (params.sequentialDownload) {
        await this.client.call('torrent-set', { ids: [hash], sequentialDownload: true }).catch(() => undefined)
      }
      if (params.addToTopOfQueue) {
        await this.client.call('queue-move-top', { ids: [hash] }).catch(() => undefined)
      }
    }
    return {
      ok: true,
      data: {
        ...(added ? { added: { id: added.hashString, name: added.name } } : {}),
        ...(dup ? { duplicate: { id: dup.hashString, name: dup.name } } : {})
      }
    }
  }

  setTorrent(ids: string[], fields: Record<string, unknown>): Promise<RpcResult<unknown>> {
    return this.client.call('torrent-set', { ids, ...fields })
  }

  async renamePath(id: string, path: string, name: string): Promise<RpcResult<RenameResult>> {
    // torrent-rename-path accepts exactly ONE torrent per call (RPC spec)
    const res = await this.client.call<{ path: string; name: string }>('torrent-rename-path', {
      ids: [id],
      path,
      name
    })
    if (!res.ok) return res
    return { ok: true, data: { id, path: res.data.path, name: res.data.name } }
  }

  setLocation(ids: string[], location: string, move: boolean): Promise<RpcResult<unknown>> {
    return this.client.call('torrent-set-location', { ids, location, move })
  }

  freeSpace(path: string): Promise<RpcResult<{ path: string; 'size-bytes': number }>> {
    return this.client.call('free-space', { path })
  }

  async getGroups(): Promise<RpcResult<BandwidthGroup[]>> {
    const res = await this.client.call<{ group: BandwidthGroup[] }>('group-get')
    if (!res.ok) return res
    return { ok: true, data: res.data.group ?? [] }
  }

  setGroup(group: Partial<BandwidthGroup> & { name: string }): Promise<RpcResult<unknown>> {
    return this.client.call('group-set', group)
  }

  blocklistUpdate(): Promise<RpcResult<{ 'blocklist-size': number }>> {
    return this.client.call('blocklist-update')
  }

  portTest(): Promise<RpcResult<{ 'port-is-open': boolean }>> {
    return this.client.call('port-test')
  }
}
