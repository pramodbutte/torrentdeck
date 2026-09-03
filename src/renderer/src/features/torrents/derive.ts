/**
 * Pure torrent-list domain logic: status-group matching, filtering, sorting,
 * and sidebar aggregation. No React/Redux imports — everything here is a
 * plain function of (torrents, options), which is what makes it directly
 * unit-testable (see derive.test.ts) and safe to memoize in components.
 */
import type { SortPref, StatusFilter } from '@shared/types'
import { TorrentStatus, type Torrent } from '@shared/transmission'
import { trackerHost } from '@/lib/format'

export function matchesStatusFilter(t: Torrent, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'downloading':
      return t.status === TorrentStatus.Downloading || t.status === TorrentStatus.DownloadWait
    case 'seeding':
      return t.status === TorrentStatus.Seeding || t.status === TorrentStatus.SeedWait
    case 'paused':
      return t.status === TorrentStatus.Stopped
    case 'checking':
      return t.status === TorrentStatus.Checking || t.status === TorrentStatus.CheckWait
    case 'error':
      return t.error !== 0
  }
}

export interface FilterOptions {
  statusFilter: StatusFilter
  trackerFilter: string | null
  labelFilter: string | null
  search: string
}

export function filterTorrents(torrents: Torrent[], opts: FilterOptions): Torrent[] {
  const q = opts.search.trim().toLowerCase()
  return torrents.filter((t) => {
    if (!matchesStatusFilter(t, opts.statusFilter)) return false
    if (opts.trackerFilter && !t.trackers.some((tr) => trackerHost(tr.announce) === opts.trackerFilter))
      return false
    if (opts.labelFilter && !t.labels.includes(opts.labelFilter)) return false
    if (q && !t.name.toLowerCase().includes(q)) return false
    return true
  })
}

/** PanelFilters (persisted per Torrents panel) adapter over filterTorrents. */
export function applyPanelFilters(
  torrents: Torrent[],
  f: { status: StatusFilter; tracker: string | null; label: string | null; search: string }
): Torrent[] {
  return filterTorrents(torrents, {
    statusFilter: f.status,
    trackerFilter: f.tracker,
    labelFilter: f.label,
    search: f.search
  })
}

/** eta of -1/-2 (unknown / n-a) sorts to the end regardless of direction */
function etaValue(t: Torrent): number {
  return t.eta < 0 ? Number.MAX_SAFE_INTEGER : t.eta
}

const comparators: Record<SortPref['key'], (a: Torrent, b: Torrent) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  totalSize: (a, b) => a.totalSize - b.totalSize,
  percentDone: (a, b) => a.percentDone - b.percentDone,
  status: (a, b) => a.status - b.status,
  rateDownload: (a, b) => a.rateDownload - b.rateDownload,
  rateUpload: (a, b) => a.rateUpload - b.rateUpload,
  uploadRatio: (a, b) => a.uploadRatio - b.uploadRatio,
  eta: (a, b) => etaValue(a) - etaValue(b),
  addedDate: (a, b) => a.addedDate - b.addedDate,
  queuePosition: (a, b) => a.queuePosition - b.queuePosition,
  maxSeeders: (a, b) => a.maxSeeders - b.maxSeeders,
  availRatio: (a, b) => a.availRatio - b.availRatio
}

/** Tint for the availability ratio: can this download actually finish right now? */
export function availTextClass(availRatio: number): string {
  if (availRatio >= 1) return 'text-success-600 dark:text-success-400'
  if (availRatio > 0) return 'text-warning-600 dark:text-warning-400'
  return 'text-danger-600 dark:text-danger-400'
}

/** Size of each progress-color band (0.1 = a distinct color every 10%). */
export const PROGRESS_COLOR_STEP = 0.1

/**
 * Solid progress-fill color for an IN-PROGRESS download, quantized into
 * discrete bands (every PROGRESS_COLOR_STEP) so the fill visibly steps as it
 * fills rather than drifting imperceptibly. Deep orange when low → bright
 * yellow when nearly done; both hue AND lightness sweep so adjacent bands are
 * distinguishable. Green is reserved for 100% (the caller swaps in the
 * completed `success` color), so the bar never looks "done" before it is —
 * the ramp stays in the orange→yellow range, never into green.
 * Returns HSL for an inline backgroundColor (Tailwind can't interpolate).
 */
export function progressFillColor(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction))
  const band = Math.round(f / PROGRESS_COLOR_STEP) * PROGRESS_COLOR_STEP
  const hue = Math.round(20 + 40 * band) // 20°(orange) → 60°(yellow)
  const light = Math.round(42 + 10 * band) // 42% (deep) → 52% (bright)
  return `hsl(${hue} 90% ${light}%)`
}

/** Swarm-health tint for the seeder-count dot; -1 (unknown) reads as muted. */
export function swarmHealthClass(maxSeeders: number): string {
  if (maxSeeders <= 0) return 'bg-surface-400 dark:bg-surface-500'
  if (maxSeeders <= 5) return 'bg-warning-400'
  return 'bg-success-400'
}

export function sortTorrents(torrents: Torrent[], sort: SortPref): Torrent[] {
  const cmp = comparators[sort.key]
  const sorted = [...torrents].sort((a, b) => {
    const c = cmp(a, b)
    return c !== 0 ? (sort.desc ? -c : c) : a.id.localeCompare(b.id)
  })
  return sorted
}

export interface SidebarCounts {
  all: number
  downloading: number
  seeding: number
  paused: number
  checking: number
  error: number
  trackers: { host: string; count: number }[]
  labels: { label: string; count: number }[]
}

export function deriveSidebar(torrents: Torrent[]): SidebarCounts {
  const trackerMap = new Map<string, number>()
  const labelMap = new Map<string, number>()
  const counts = { all: torrents.length, downloading: 0, seeding: 0, paused: 0, checking: 0, error: 0 }
  for (const t of torrents) {
    if (matchesStatusFilter(t, 'downloading')) counts.downloading++
    if (matchesStatusFilter(t, 'seeding')) counts.seeding++
    if (matchesStatusFilter(t, 'paused')) counts.paused++
    if (matchesStatusFilter(t, 'checking')) counts.checking++
    if (matchesStatusFilter(t, 'error')) counts.error++
    const hosts = new Set(t.trackers.map((tr) => trackerHost(tr.announce)))
    for (const h of hosts) trackerMap.set(h, (trackerMap.get(h) ?? 0) + 1)
    for (const l of t.labels) labelMap.set(l, (labelMap.get(l) ?? 0) + 1)
  }
  return {
    ...counts,
    trackers: [...trackerMap.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => a.host.localeCompare(b.host)),
    labels: [...labelMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label))
  }
}

/**
 * Status → color coding for list rows (v0.4): a left stripe class and a text
 * tint class per Status group, using the semantic palette. Kept subtle by
 * design — stripe + status text only, no row fills.
 */
export function statusColor(t: Torrent): { stripe: string; text: string } {
  if (t.error !== 0)
    return { stripe: 'border-l-danger-400', text: 'text-danger-600 dark:text-danger-400' }
  switch (t.status) {
    case TorrentStatus.Downloading:
    case TorrentStatus.DownloadWait:
      return { stripe: 'border-l-accent-400', text: 'text-accent-600 dark:text-accent-300' }
    case TorrentStatus.Seeding:
    case TorrentStatus.SeedWait:
      return { stripe: 'border-l-success-400', text: 'text-success-600 dark:text-success-400' }
    case TorrentStatus.Checking:
    case TorrentStatus.CheckWait:
      return { stripe: 'border-l-warning-400', text: 'text-warning-600 dark:text-warning-400' }
    default:
      return {
        stripe: 'border-l-surface-300 dark:border-l-surface-600',
        text: 'text-surface-500 dark:text-surface-400'
      }
  }
}

export function statusText(t: Torrent): string {
  if (t.error !== 0) return t.errorString || 'Error'
  switch (t.status) {
    case TorrentStatus.Stopped:
      return t.isFinished ? 'Finished' : 'Paused'
    case TorrentStatus.CheckWait:
      return 'Queued to verify'
    case TorrentStatus.Checking:
      return 'Verifying'
    case TorrentStatus.DownloadWait:
      return 'Queued'
    case TorrentStatus.Downloading:
      return 'Downloading'
    case TorrentStatus.SeedWait:
      return 'Queued to seed'
    case TorrentStatus.Seeding:
      return 'Seeding'
    default:
      return 'Unknown'
  }
}

/**
 * Hover text for a status cell: the daemon's FULL error message when the
 * torrent is in an error state (list cells truncate it, and e.g. Transmission's
 * "No data found! …" text carries the fix instructions), otherwise nothing.
 */
export function statusTitle(t: Torrent): string | undefined {
  return t.error !== 0 && t.errorString ? t.errorString : undefined
}
