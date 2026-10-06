import * as ContextMenu from '@radix-ui/react-context-menu'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Torrent } from '@shared/transmission'
import { TorrentStatus } from '@shared/transmission'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { useQueueMoveMutation, useTorrentActionMutation } from '@/services/rpcApi'
import {
  availTextClass,
  progressFillColor,
  statusColor,
  statusText,
  statusTitle,
  swarmHealthClass
} from '@/features/torrents/derive'
import {
  openLabelsEditor,
  openQueueEditor,
  openRemoveConfirm,
  selectRange,
  selectTorrent
} from '@/features/ui/uiSlice'
import { formatBytes, formatEta, formatPercent, formatRatio, formatSpeed } from '@/lib/format'
import { cn } from '@/lib/cn'

export function ProgressBar({ torrent }: { torrent: Torrent }): React.JSX.Element {
  const checking = torrent.status === TorrentStatus.Checking
  const fraction = checking ? torrent.recheckProgress : torrent.percentDone
  // In-progress fill is colored by completion (orange→green); terminal states
  // keep their semantic color.
  const staticColor =
    torrent.error !== 0
      ? 'bg-danger-500'
      : torrent.status === TorrentStatus.Stopped
        ? 'bg-surface-400 dark:bg-surface-500'
        : torrent.percentDone >= 1
          ? 'bg-success-500'
          : null
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
      <div
        className={cn('h-full rounded-full', staticColor)}
        style={{
          width: `${fraction * 100}%`,
          backgroundColor: staticColor ? undefined : progressFillColor(fraction)
        }}
      />
    </div>
  )
}

function LabelChips({
  labels,
  onLabelClick
}: {
  labels: string[]
  onLabelClick?: (label: string) => void
}): React.JSX.Element | null {
  if (!labels.length) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {labels.slice(0, 3).map((l) => (
        <button
          key={l}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onLabelClick?.(l)
          }}
          className="rounded-full bg-accent-100 px-1.5 text-[10px] text-accent-700 hover:bg-accent-200 dark:bg-accent-900/50 dark:text-accent-300 dark:hover:bg-accent-900"
        >
          {l}
        </button>
      ))}
    </span>
  )
}

function RowStats({ torrent }: { torrent: Torrent }): React.JSX.Element {
  const before: string[] = []
  const after: string[] = []
  const isDone = torrent.percentDone >= 1
  before.push(
    isDone
      ? formatBytes(torrent.totalSize)
      : `${formatPercent(torrent.percentDone)} of ${formatBytes(torrent.sizeWhenDone)}`
  )
  if (torrent.status === TorrentStatus.Downloading) {
    if (torrent.eta >= 0) after.push(formatEta(torrent.eta))
    after.push(`${torrent.peersSendingToUs}/${torrent.peersConnected} peers`)
  }
  if (torrent.status === TorrentStatus.Seeding) after.push(`ratio ${formatRatio(torrent.uploadRatio)}`)
  return (
    <span className="flex items-center gap-2 truncate text-xs text-surface-500 dark:text-surface-400">
      <span className="truncate">
        {before.join(' · ')} ·{' '}
        <span className={statusColor(torrent).text} title={statusTitle(torrent)}>
          {statusText(torrent)}
        </span>
        {after.length ? ` · ${after.join(' · ')}` : ''}
      </span>
      {torrent.leftUntilDone > 0 && torrent.availRatio < 1 && (
        <span
          className={cn('shrink-0', availTextClass(torrent.availRatio))}
          title="Share of missing data available from connected peers"
        >
          avail {Math.round(torrent.availRatio * 100)}%
        </span>
      )}
      {torrent.maxSeeders >= 0 && (
        <span className="flex shrink-0 items-center gap-1" title="Swarm: seeders / leechers (best tracker)">
          <span className={cn('h-1.5 w-1.5 rounded-full', swarmHealthClass(torrent.maxSeeders))} />
          {torrent.maxSeeders}S/{Math.max(0, torrent.maxLeechers)}L
        </span>
      )}
      {torrent.rateDownload > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-accent-600 dark:text-accent-400">
          <ArrowDown size={11} /> {formatSpeed(torrent.rateDownload)}
        </span>
      )}
      {torrent.rateUpload > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-success-600 dark:text-success-400">
          <ArrowUp size={11} /> {formatSpeed(torrent.rateUpload)}
        </span>
      )}
    </span>
  )
}

/**
 * Selection + context-menu wrapper shared by card rows and table rows.
 * Selection is server-qualified: clicking always associates the row with its
 * profileId (ADR-0003).
 */
export interface RowReorder {
  onDragStart: () => void
  onDragEnter: () => void
  onDrop: () => void
  isDropTarget: boolean
}

export function TorrentRowShell({
  torrent,
  profileId,
  className,
  reorder,
  orderedIds,
  children
}: {
  torrent: Torrent
  profileId: string
  className?: string
  /** Present only when the panel is queue-sorted (drag-to-reorder enabled). */
  reorder?: RowReorder
  /** This group's row ids in display order, for Shift-click range selection. */
  orderedIds?: string[]
  children: React.ReactNode
}): React.JSX.Element {
  const dispatch = useAppDispatch()
  const selection = useAppSelector((s) => s.ui.selection)
  const anchor = useAppSelector((s) => s.ui.detailTarget)
  const selected = selection?.profileId === profileId && selection.ids.includes(torrent.id)
  const [torrentAction] = useTorrentActionMutation()
  const [queueMove] = useQueueMoveMutation()

  const ctxIds = selected && selection ? selection.ids : [torrent.id]
  const act =
    (
      action:
        | 'torrent-start'
        | 'torrent-start-now'
        | 'torrent-stop'
        | 'torrent-verify'
        | 'torrent-reannounce'
    ) =>
    () =>
      void torrentAction({ profileId, action, ids: ctxIds })

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          role="row"
          aria-selected={selected}
          data-torrent-row
          data-rowid={`${profileId}:${torrent.id}`}
          draggable={reorder !== undefined}
          onClick={(e) => {
            e.stopPropagation()
            // Shift-click: select the range from the anchor to this row, within
            // this server group's display order (selection is server-qualified).
            if (e.shiftKey && orderedIds && anchor?.profileId === profileId) {
              const a = orderedIds.indexOf(anchor.id)
              const b = orderedIds.indexOf(torrent.id)
              if (a !== -1 && b !== -1) {
                const [lo, hi] = a < b ? [a, b] : [b, a]
                dispatch(selectRange({ profileId, ids: orderedIds.slice(lo, hi + 1) }))
                return
              }
            }
            dispatch(selectTorrent({ profileId, id: torrent.id, additive: e.metaKey || e.ctrlKey }))
          }}
          onContextMenu={() => {
            if (!selected) dispatch(selectTorrent({ profileId, id: torrent.id, additive: false }))
          }}
          onDragStart={reorder ? () => reorder.onDragStart() : undefined}
          onDragOver={
            reorder
              ? (e) => {
                  e.preventDefault()
                  reorder.onDragEnter()
                }
              : undefined
          }
          onDrop={
            reorder
              ? (e) => {
                  e.preventDefault()
                  reorder.onDrop()
                }
              : undefined
          }
          className={cn(
            'border-b border-surface-100 dark:border-surface-800',
            reorder && 'cursor-grab active:cursor-grabbing',
            reorder?.isDropTarget && 'border-t-2 border-t-accent-500',
            selected
              ? 'bg-accent-100 shadow-[inset_0_0_0_1px_var(--color-accent-300)] dark:bg-accent-800/50 dark:shadow-[inset_0_0_0_1px_var(--color-accent-700)]'
              : 'hover:bg-surface-50 dark:hover:bg-surface-800/50',
            className
          )}
        >
          {children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-md border border-surface-200 bg-surface-50 p-1 text-sm shadow-lg dark:border-surface-700 dark:bg-surface-800">
          {(
            [
              ['Start', act('torrent-start')],
              ['Start now', act('torrent-start-now')],
              ['Pause', act('torrent-stop')],
              ['Verify local data', act('torrent-verify')],
              ['Ask tracker for more peers', act('torrent-reannounce')],
              ['Set labels…', () => dispatch(openLabelsEditor({ profileId, ids: ctxIds }))]
            ] as [string, () => void][]
          ).map(([label, fn]) => (
            <ContextMenu.Item
              key={label}
              onSelect={fn}
              className="rounded px-2 py-1.5 outline-none select-none data-highlighted:bg-surface-100 dark:data-highlighted:bg-surface-700"
            >
              {label}
            </ContextMenu.Item>
          ))}
          <ContextMenu.Separator className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="flex items-center rounded px-2 py-1.5 outline-none select-none data-highlighted:bg-surface-100 data-[state=open]:bg-surface-100 dark:data-highlighted:bg-surface-700 dark:data-[state=open]:bg-surface-700">
              Queue
              <span className="ml-auto text-surface-400">›</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="z-50 min-w-36 rounded-md border border-surface-200 bg-surface-50 p-1 text-sm shadow-lg dark:border-surface-700 dark:bg-surface-800">
                {(
                  [
                    ['Move to top', 'queue-move-top'],
                    ['Move up', 'queue-move-up'],
                    ['Move down', 'queue-move-down'],
                    ['Move to bottom', 'queue-move-bottom']
                  ] as const
                ).map(([label, direction]) => (
                  <ContextMenu.Item
                    key={direction}
                    onSelect={() => void queueMove({ profileId, ids: ctxIds, direction })}
                    className="rounded px-2 py-1.5 outline-none select-none data-highlighted:bg-surface-100 dark:data-highlighted:bg-surface-700"
                  >
                    {label}
                  </ContextMenu.Item>
                ))}
                <ContextMenu.Separator className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
                <ContextMenu.Item
                  onSelect={() =>
                    dispatch(
                      openQueueEditor({
                        profileId,
                        id: torrent.id,
                        current: torrent.queuePosition,
                        name: torrent.name
                      })
                    )
                  }
                  className="rounded px-2 py-1.5 outline-none select-none data-highlighted:bg-surface-100 dark:data-highlighted:bg-surface-700"
                >
                  Set position…
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
          <ContextMenu.Item
            onSelect={() => dispatch(openRemoveConfirm({ profileId, ids: ctxIds }))}
            className="rounded px-2 py-1.5 text-danger-600 outline-none select-none data-highlighted:bg-surface-100 dark:text-danger-400 dark:data-highlighted:bg-surface-700"
          >
            Remove…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/** One torrent as a card row (the default 'cards' view). */
export function TorrentRow({
  torrent,
  profileId,
  onLabelClick,
  reorder,
  orderedIds
}: {
  torrent: Torrent
  profileId: string
  onLabelClick?: (label: string) => void
  reorder?: RowReorder
  orderedIds?: string[]
}): React.JSX.Element {
  const selection = useAppSelector((s) => s.ui.selection)
  const selected = selection?.profileId === profileId && selection.ids.includes(torrent.id)
  return (
    <TorrentRowShell
      torrent={torrent}
      profileId={profileId}
      reorder={reorder}
      orderedIds={orderedIds}
      className={cn(
        'flex h-14 flex-col justify-center gap-1 border-l-2 px-3',
        statusColor(torrent).stripe
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className="shrink-0 text-[11px] text-surface-400 tabular-nums dark:text-surface-500"
          title="Queue position"
        >
          #{torrent.queuePosition + 1}
        </span>
        <span className={cn('torrent-name min-w-0 flex-1 truncate text-sm', selected && 'font-medium')}>
          {torrent.name}
        </span>
        <LabelChips labels={torrent.labels} onLabelClick={onLabelClick} />
      </span>
      <ProgressBar torrent={torrent} />
      <RowStats torrent={torrent} />
    </TorrentRowShell>
  )
}
