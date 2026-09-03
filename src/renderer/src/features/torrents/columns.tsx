/**
 * Column registry for the table view. One entry per ColumnKey drives the
 * header strip, the visibility menu, cell rendering, and (via sortKey) which
 * SortPref a header click applies — same single-source-of-truth style as the
 * panel registry.
 */
import type { ColumnKey, SortKey } from '@shared/types'
import type { Torrent } from '@shared/transmission'
import { availTextClass, progressFillColor, statusColor, statusText, statusTitle } from './derive'
import { formatBytes, formatDate, formatEta, formatPercent, formatRatio, formatSpeed } from '@/lib/format'

export interface ColumnDef {
  key: ColumnKey
  label: string
  /** CSS grid track for this column */
  track: string
  align: 'left' | 'right'
  sortKey?: SortKey
  cell: (t: Torrent) => React.ReactNode
}

export const COLUMNS: Record<ColumnKey, ColumnDef> = {
  queue: {
    key: 'queue',
    label: '#',
    track: '44px',
    align: 'right',
    sortKey: 'queuePosition',
    cell: (t) => `#${t.queuePosition + 1}`
  },
  name: {
    key: 'name',
    label: 'Name',
    track: 'minmax(160px, 2fr)',
    align: 'left',
    sortKey: 'name',
    cell: (t) => (
      <span className="torrent-name truncate" title={t.name}>
        {t.name}
      </span>
    )
  },
  size: {
    key: 'size',
    label: 'Size',
    track: '72px',
    align: 'right',
    sortKey: 'totalSize',
    cell: (t) => formatBytes(t.totalSize)
  },
  progress: {
    key: 'progress',
    label: 'Progress',
    track: '110px',
    align: 'left',
    sortKey: 'percentDone',
    cell: (t) => {
      const staticColor =
        t.error !== 0 ? 'bg-danger-500' : t.percentDone >= 1 ? 'bg-success-500' : null
      return (
        <span className="flex w-full items-center gap-1.5">
          <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
            <span
              className={`block h-full rounded-full ${staticColor ?? ''}`}
              style={{
                width: `${t.percentDone * 100}%`,
                backgroundColor: staticColor ? undefined : progressFillColor(t.percentDone)
              }}
            />
          </span>
          <span className="w-10 shrink-0 text-right text-[11px] text-surface-500">
            {formatPercent(t.percentDone)}
          </span>
        </span>
      )
    }
  },
  status: {
    key: 'status',
    label: 'Status',
    track: '96px',
    align: 'left',
    sortKey: 'status',
    cell: (t) => (
      <span className={`truncate ${statusColor(t).text}`} title={statusTitle(t)}>
        {statusText(t)}
      </span>
    )
  },
  downSpeed: {
    key: 'downSpeed',
    label: '↓ Speed',
    track: '78px',
    align: 'right',
    sortKey: 'rateDownload',
    cell: (t) =>
      t.rateDownload > 0 ? (
        <span className="text-accent-600 dark:text-accent-400">{formatSpeed(t.rateDownload)}</span>
      ) : (
        '—'
      )
  },
  upSpeed: {
    key: 'upSpeed',
    label: '↑ Speed',
    track: '78px',
    align: 'right',
    sortKey: 'rateUpload',
    cell: (t) =>
      t.rateUpload > 0 ? (
        <span className="text-success-600 dark:text-success-400">{formatSpeed(t.rateUpload)}</span>
      ) : (
        '—'
      )
  },
  ratio: {
    key: 'ratio',
    label: 'Ratio',
    track: '56px',
    align: 'right',
    sortKey: 'uploadRatio',
    cell: (t) => formatRatio(t.uploadRatio)
  },
  eta: {
    key: 'eta',
    label: 'ETA',
    track: '64px',
    align: 'right',
    sortKey: 'eta',
    cell: (t) => formatEta(t.eta)
  },
  added: {
    key: 'added',
    label: 'Added',
    track: '132px',
    align: 'right',
    sortKey: 'addedDate',
    cell: (t) => formatDate(t.addedDate)
  },
  avail: {
    key: 'avail',
    label: 'Avail',
    track: '58px',
    align: 'right',
    sortKey: 'availRatio',
    cell: (t) =>
      t.leftUntilDone <= 0 ? (
        '—'
      ) : (
        <span className={availTextClass(t.availRatio)}>{Math.round(t.availRatio * 100)}%</span>
      )
  },
  seeders: {
    key: 'seeders',
    label: 'Seeds',
    track: '56px',
    align: 'right',
    sortKey: 'maxSeeders',
    cell: (t) => (t.maxSeeders < 0 ? '—' : String(t.maxSeeders))
  },
  leechers: {
    key: 'leechers',
    label: 'Peers',
    track: '56px',
    align: 'right',
    cell: (t) => (t.maxLeechers < 0 ? '—' : String(t.maxLeechers))
  },
  labels: {
    key: 'labels',
    label: 'Labels',
    track: 'minmax(70px, 1fr)',
    align: 'left',
    cell: (t) => (
      <span className="truncate text-[11px] text-accent-700 dark:text-accent-300">
        {t.labels.join(', ')}
      </span>
    )
  }
}

export const ALL_COLUMNS = Object.values(COLUMNS)

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  'queue',
  'name',
  'size',
  'progress',
  'status',
  'downSpeed',
  'upSpeed',
  'ratio',
  'eta'
]

/** Column defs in the user's stored order (so header drag-reordering sticks),
 * dropping any unknown keys from older layouts. */
export function visibleColumnDefs(visible: ColumnKey[] | undefined): ColumnDef[] {
  const keys = visible?.length ? visible : DEFAULT_VISIBLE_COLUMNS
  return keys.map((k) => COLUMNS[k]).filter((c): c is ColumnDef => c !== undefined)
}

export const MIN_COLUMN_WIDTH = 40

/** Grid track list, substituting any user-resized fixed px widths. */
export function gridTemplateFor(defs: ColumnDef[], widths?: Record<string, number>): string {
  return defs
    .map((d) => {
      const w = widths?.[d.key]
      return w && w >= MIN_COLUMN_WIDTH ? `${w}px` : d.track
    })
    .join(' ')
}
