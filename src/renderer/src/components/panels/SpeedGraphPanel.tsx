import { useMemo } from 'react'
import { Check, ChevronDown, Server } from 'lucide-react'
import type { SpeedGraphConfig, WorkspaceItem } from '@shared/types'
import { useAppDispatch, useAppSelector, usePollingInterval } from '@/app/hooks'
import { useGetSessionStatsQuery } from '@/services/rpcApi'
import { panelConfigChanged } from '@/features/workspace/workspaceSlice'
import { getGraphConfig } from '@/features/workspace/panels'
import type { SpeedSample } from '@/features/stats/speedHistorySlice'
import { serverColor } from '@/features/connection/serverColor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown'
import { formatSpeed } from '@/lib/format'

const VB_W = 100
const VB_H = 40

function pathFor(
  samples: SpeedSample[],
  pick: (s: SpeedSample) => number,
  t0: number,
  t1: number,
  max: number
): { line: string; area: string } {
  if (samples.length === 0 || t1 <= t0) return { line: '', area: '' }
  const pts = samples.map((s) => {
    const x = ((s.t - t0) / (t1 - t0)) * VB_W
    const y = VB_H - (pick(s) / max) * (VB_H - 4)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const line = pts.join(' ')
  const first = pts[0].split(',')[0]
  const last = pts[pts.length - 1].split(',')[0]
  return { line, area: `${first},${VB_H} ${line} ${last},${VB_H}` }
}

/** Subscribing is what drives sampling for a server (see speedHistorySlice). */
function ServerSampler({ profileId }: { profileId: string }): null {
  const pollingInterval = usePollingInterval()
  useGetSessionStatsQuery({ profileId }, { pollingInterval })
  return null
}

const EMPTY: SpeedSample[] = []

/**
 * Live throughput graph for one or more servers. Pure SVG (no chart
 * dependency). Color identifies the server; direction is the line style —
 * download is a solid line with a soft fill, upload a dashed line — all
 * auto-scaled to the window's peak across the plotted servers.
 */
export function SpeedGraphPanel({ item }: { item: WorkspaceItem }): React.JSX.Element {
  const dispatch = useAppDispatch()
  const config: SpeedGraphConfig = getGraphConfig(item)
  const profiles = useAppSelector((s) => s.connection.profiles)
  const histories = useAppSelector((s) => s.speedHistory)

  const shown = useMemo(
    () =>
      config.servers === 'default'
        ? profiles
        : profiles.filter((p) => (config.servers as string[]).includes(p.id)),
    [profiles, config.servers]
  )

  const patch = (p: Partial<SpeedGraphConfig>): void => {
    dispatch(panelConfigChanged({ id: item.i, patch: p }))
  }

  const toggleServer = (id: string): void => {
    const current = config.servers === 'default' ? profiles.map((p) => p.id) : config.servers
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    if (next.length === 0) return
    patch({ servers: next })
  }

  const scopeLabel =
    config.servers === 'default'
      ? 'All servers'
      : shown.length === 1
        ? shown[0].name
        : `${shown.length} servers`

  const { series, max } = useMemo(() => {
    const now = Date.now()
    const t0 = now - config.windowSec * 1000
    const windowed = shown.map((p) => ({
      profileId: p.id,
      samples: (histories[p.id] ?? EMPTY).filter((s) => s.t >= t0)
    }))
    const peak = Math.max(
      1,
      ...windowed.flatMap((w) => w.samples.map((s) => Math.max(s.down, s.up)))
    )
    return {
      series: windowed.map((w) => ({
        profileId: w.profileId,
        down: pathFor(w.samples, (s) => s.down, t0, now, peak),
        up: pathFor(w.samples, (s) => s.up, t0, now, peak)
      })),
      max: peak
    }
  }, [histories, shown, config.windowSec])

  return (
    <div className="flex h-full flex-col">
      {shown.map((p) => (
        <ServerSampler key={p.id} profileId={p.id} />
      ))}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-200 px-2 py-1.5 dark:border-surface-700">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-6 px-1.5 text-xs" aria-label="Graph servers">
              <Server size={11} /> {scopeLabel} <ChevronDown size={10} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Servers plotted</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => patch({ servers: 'default' })}>
              <span className="w-3">{config.servers === 'default' ? <Check size={12} /> : null}</span>
              All servers
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {profiles.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => toggleServer(p.id)}>
                <span className="w-3">
                  {config.servers !== 'default' && shown.some((x) => x.id === p.id) ? (
                    <Check size={12} />
                  ) : null}
                </span>
                <span
                  className="mr-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: serverColor(p.id) }}
                  aria-hidden
                />
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <select
          value={config.windowSec}
          onChange={(e) => patch({ windowSec: Number(e.target.value) as SpeedGraphConfig['windowSec'] })}
          aria-label="Graph window"
          className="h-6 rounded border border-surface-300 bg-surface-50 px-1 text-xs dark:border-surface-600 dark:bg-surface-800"
        >
          <option value={60}>1 min</option>
          <option value={300}>5 min</option>
          <option value={900}>15 min</option>
        </select>
        <span
          className="ml-auto flex items-center gap-2 text-[11px] text-surface-500 dark:text-surface-400"
          aria-hidden
        >
          <span className="flex items-center gap-1">
            <svg width="16" height="6">
              <line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="2" />
            </svg>
            ↓ down
          </span>
          <span className="flex items-center gap-1">
            <svg width="16" height="6">
              <line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
            </svg>
            ↑ up
          </span>
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-surface-500">
          No server selected
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            <span className="absolute top-1 left-2 text-[10px] text-surface-400">
              peak {formatSpeed(max)}
            </span>
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              className="h-full w-full"
              role="img"
              aria-label="Speed over time"
            >
              <line x1="0" y1={VB_H / 2} x2={VB_W} y2={VB_H / 2} className="stroke-surface-200 dark:stroke-surface-800" strokeWidth="0.3" />
              {series.map((sr) => {
                const color = serverColor(sr.profileId)
                return (
                  <g key={sr.profileId} style={{ color }}>
                    {sr.down.area && <polygon points={sr.down.area} fill="currentColor" opacity="0.12" />}
                    {sr.up.line && (
                      <polyline
                        points={sr.up.line}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {sr.down.line && (
                      <polyline
                        points={sr.down.line}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-surface-200 px-2 py-1 text-[11px] dark:border-surface-700">
            {shown.map((p) => {
              const last = histories[p.id]?.at(-1)
              return (
                <li key={p.id} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: serverColor(p.id) }}
                    aria-hidden
                  />
                  <span className="max-w-32 truncate">{p.name}</span>
                  <span className="text-surface-500 tabular-nums dark:text-surface-400">
                    ↓ {formatSpeed(last?.down ?? 0)} · ↑ {formatSpeed(last?.up ?? 0)}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
