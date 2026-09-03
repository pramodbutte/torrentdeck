import { describe, expect, it } from 'vitest'
import type { Torrent } from '@shared/transmission'
import { TorrentStatus } from '@shared/transmission'
import {
  filterTorrents,
  sortTorrents,
  deriveSidebar,
  statusColor,
  statusText,
  statusTitle,
  progressFillColor
} from './derive'

function torrent(partial: Partial<Torrent>): Torrent {
  return {
    id: '1',
    name: 't',
    status: TorrentStatus.Downloading,
    hashString: 'h',
    totalSize: 100,
    sizeWhenDone: 100,
    leftUntilDone: 50,
    percentDone: 0.5,
    recheckProgress: 0,
    rateDownload: 0,
    rateUpload: 0,
    uploadRatio: 0,
    uploadedEver: 0,
    eta: 60,
    addedDate: 0,
    queuePosition: 0,
    error: 0,
    errorString: '',
    labels: [],
    downloadDir: '/dl',
    peersConnected: 0,
    peersSendingToUs: 0,
    peersGettingFromUs: 0,
    isFinished: false,
    metadataPercentComplete: 1,
    trackers: [],
    maxSeeders: -1,
    maxLeechers: -1,
    desiredAvailable: 0,
    availRatio: 1,
    ...partial
  }
}

const base = { statusFilter: 'all' as const, trackerFilter: null, labelFilter: null, search: '' }

describe('filterTorrents', () => {
  it('filters by status group', () => {
    const list = [
      torrent({ id: '1', status: TorrentStatus.Downloading }),
      torrent({ id: '2', status: TorrentStatus.Seeding }),
      torrent({ id: '3', status: TorrentStatus.Stopped })
    ]
    expect(filterTorrents(list, { ...base, statusFilter: 'downloading' }).map((t) => t.id)).toEqual(['1'])
    expect(filterTorrents(list, { ...base, statusFilter: 'paused' }).map((t) => t.id)).toEqual(['3'])
  })

  it('filters by error state', () => {
    const list = [torrent({ id: '1' }), torrent({ id: '2', error: 3, errorString: 'boom' })]
    expect(filterTorrents(list, { ...base, statusFilter: 'error' }).map((t) => t.id)).toEqual(['2'])
  })

  it('searches case-insensitively', () => {
    const list = [torrent({ id: '1', name: 'Ubuntu ISO' }), torrent({ id: '2', name: 'debian' })]
    expect(filterTorrents(list, { ...base, search: 'ubu' }).map((t) => t.id)).toEqual(['1'])
  })

  it('filters by tracker host and label', () => {
    const list = [
      torrent({
        id: '1',
        trackers: [{ announce: 'https://tr.example.org/announce', id: 0, scrape: '', sitename: '', tier: 0 }]
      }),
      torrent({ id: '2', labels: ['isos'] })
    ]
    expect(filterTorrents(list, { ...base, trackerFilter: 'tr.example.org' }).map((t) => t.id)).toEqual(['1'])
    expect(filterTorrents(list, { ...base, labelFilter: 'isos' }).map((t) => t.id)).toEqual(['2'])
  })
})

describe('sortTorrents', () => {
  it('sorts by name with numeric awareness', () => {
    const list = [torrent({ id: '1', name: 'ep10' }), torrent({ id: '2', name: 'ep2' })]
    expect(sortTorrents(list, { key: 'name', desc: false }).map((t) => t.name)).toEqual(['ep2', 'ep10'])
  })

  it('sorts descending', () => {
    const list = [torrent({ id: '1', totalSize: 10 }), torrent({ id: '2', totalSize: 20 })]
    expect(sortTorrents(list, { key: 'totalSize', desc: true }).map((t) => t.id)).toEqual(['2', '1'])
  })

  it('always sorts unknown eta last', () => {
    const list = [torrent({ id: '1', eta: -1 }), torrent({ id: '2', eta: 30 })]
    expect(sortTorrents(list, { key: 'eta', desc: false }).map((t) => t.id)).toEqual(['2', '1'])
  })
})

describe('deriveSidebar', () => {
  it('counts statuses, trackers, and labels', () => {
    const list = [
      torrent({
        id: '1',
        status: TorrentStatus.Downloading,
        labels: ['isos'],
        trackers: [{ announce: 'https://a.example/announce', id: 0, scrape: '', sitename: '', tier: 0 }]
      }),
      torrent({ id: '2', status: TorrentStatus.Seeding, labels: ['isos'] })
    ]
    const sb = deriveSidebar(list)
    expect(sb.all).toBe(2)
    expect(sb.downloading).toBe(1)
    expect(sb.seeding).toBe(1)
    expect(sb.trackers).toEqual([{ host: 'a.example', count: 1 }])
    expect(sb.labels).toEqual([{ label: 'isos', count: 2 }])
  })
})

describe('statusColor', () => {
  it('maps status groups to semantic tints', () => {
        expect(statusColor(torrent({ status: TorrentStatus.Downloading })).stripe).toContain('accent')
    expect(statusColor(torrent({ status: TorrentStatus.Seeding })).stripe).toContain('success')
    expect(statusColor(torrent({ status: TorrentStatus.Checking })).stripe).toContain('warning')
    expect(statusColor(torrent({ status: TorrentStatus.Stopped })).stripe).toContain('surface')
    expect(statusColor(torrent({ status: TorrentStatus.Downloading, error: 3 })).stripe).toContain('danger')
  })
})

describe('deriveAvailRatio', () => {
  it('is 1 for complete torrents and clamps over-supply', async () => {
    const { deriveAvailRatio } = await import('@shared/transmission')
    expect(deriveAvailRatio(0, 0)).toBe(1)
    expect(deriveAvailRatio(100, 200)).toBe(1)
    expect(deriveAvailRatio(100, 50)).toBe(0.5)
    expect(deriveAvailRatio(100, 0)).toBe(0)
  })
})

describe('progressFillColor', () => {
  it('sweeps orange → yellow only (never green; green is reserved for 100%)', () => {
    expect(progressFillColor(0)).toBe('hsl(20 90% 42%)')
    expect(progressFillColor(0.5)).toBe('hsl(40 90% 47%)')
    expect(progressFillColor(1)).toBe('hsl(60 90% 52%)')
  })
  it('quantizes into 10% bands (nearby values share a color, band boundaries differ)', () => {
    expect(progressFillColor(0.4)).toBe(progressFillColor(0.44))
    expect(progressFillColor(0.4)).toBe('hsl(36 90% 46%)')
    expect(progressFillColor(0.4)).not.toBe(progressFillColor(0.5))
  })
  it('clamps out-of-range input', () => {
    expect(progressFillColor(-1)).toBe('hsl(20 90% 42%)')
    expect(progressFillColor(2)).toBe('hsl(60 90% 52%)')
  })
})

describe('statusText / statusTitle', () => {
  const NO_DATA =
    'No data found! Ensure your drives are connected or use "Set Location". To re-download, remove the torrent and re-add it.'

  it('shows the daemon error text as the status and exposes it in full as the title', () => {
    const t = torrent({ status: TorrentStatus.Stopped, error: 3, errorString: NO_DATA })
    expect(statusText(t)).toBe(NO_DATA)
    expect(statusTitle(t)).toBe(NO_DATA)
  })

  it('falls back to "Error" when the daemon gives no text, with no title', () => {
    const t = torrent({ error: 3, errorString: '' })
    expect(statusText(t)).toBe('Error')
    expect(statusTitle(t)).toBeUndefined()
  })

  it('has no title for healthy torrents', () => {
    expect(statusTitle(torrent({ status: TorrentStatus.Seeding }))).toBeUndefined()
  })
})
