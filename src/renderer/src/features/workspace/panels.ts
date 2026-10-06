/**
 * The panel registry's metadata half: everything about panel types EXCEPT
 * their React components (those live in registry.tsx, keeping this module
 * import-cycle-free and unit-testable). This single table drives the "Add
 * panel" picker, layout validation/migration, and default sizing — one source
 * of truth, per ADR-0002.
 */
import type {
  PanelTypeId,
  SortPref,
  SpeedGraphConfig,
  StatsPanelConfig,
  TorrentsPanelConfig,
  WorkspaceItem,
  WorkspaceLayout
} from '@shared/types'

export type PanelCategory = 'Torrents' | 'Torrent detail' | 'Server' | 'Tools'

export interface PanelMeta {
  type: PanelTypeId
  title: string
  category: PanelCategory
  /** Default size in grid units when added */
  w: number
  h: number
  minW: number
  minH: number
  /** May the user place more than one instance? */
  multiInstance: boolean
}

export const GRID_COLS = 12
export const GRID_ROW_HEIGHT = 40

export const PANELS: Record<PanelTypeId, PanelMeta> = {
  'torrent-list': {
    type: 'torrent-list',
    title: 'Torrents',
    category: 'Torrents',
    w: 9,
    h: 14,
    minW: 4,
    minH: 5,
    multiInstance: true
  },
  detail: {
    type: 'detail',
    title: 'Torrent detail',
    category: 'Torrent detail',
    w: 3,
    h: 14,
    minW: 3,
    minH: 6,
    multiInstance: false
  },
  'detail-general': {
    type: 'detail-general',
    title: 'General',
    category: 'Torrent detail',
    w: 3,
    h: 10,
    minW: 2,
    minH: 4,
    multiInstance: false
  },
  'detail-files': {
    type: 'detail-files',
    title: 'Files',
    category: 'Torrent detail',
    w: 3,
    h: 10,
    minW: 2,
    minH: 4,
    multiInstance: false
  },
  'detail-peers': {
    type: 'detail-peers',
    title: 'Peers',
    category: 'Torrent detail',
    w: 3,
    h: 10,
    minW: 2,
    minH: 4,
    multiInstance: false
  },
  'detail-trackers': {
    type: 'detail-trackers',
    title: 'Trackers',
    category: 'Torrent detail',
    w: 3,
    h: 10,
    minW: 2,
    minH: 4,
    multiInstance: false
  },
  'detail-pieces': {
    type: 'detail-pieces',
    title: 'Pieces',
    category: 'Torrent detail',
    w: 3,
    h: 8,
    minW: 2,
    minH: 4,
    multiInstance: false
  },
  stats: {
    type: 'stats',
    title: 'Session stats',
    category: 'Server',
    w: 3,
    h: 6,
    minW: 2,
    minH: 4,
    multiInstance: false
  },
  'speed-graph': {
    type: 'speed-graph',
    title: 'Speed graph',
    category: 'Server',
    w: 4,
    h: 6,
    minW: 3,
    minH: 4,
    multiInstance: true
  },
  logs: {
    type: 'logs',
    title: 'Logs',
    category: 'Tools',
    w: 6,
    h: 8,
    minW: 3,
    minH: 4,
    multiInstance: false
  }
}

export const PANEL_CATEGORIES: PanelCategory[] = ['Torrents', 'Torrent detail', 'Server', 'Tools']

export const CURRENT_LAYOUT_VERSION = 2

export function defaultPanelConfig(sort?: SortPref): TorrentsPanelConfig {
  return {
    servers: 'default',
    filters: { status: 'all', tracker: null, label: null, search: '' },
    sort: sort ?? { key: 'addedDate', desc: true },
    view: 'cards'
  }
}

/** The out-of-the-box workspace: one Torrents panel plus the tabbed detail. */
export function defaultLayout(): WorkspaceLayout {
  return {
    version: CURRENT_LAYOUT_VERSION,
    items: [
      {
        i: crypto.randomUUID(),
        type: 'torrent-list',
        x: 0,
        y: 0,
        w: 9,
        h: 14,
        config: defaultPanelConfig()
      },
      { i: crypto.randomUUID(), type: 'detail', x: 9, y: 0, w: 3, h: 14 }
    ]
  }
}

function isValidItem(raw: unknown): raw is WorkspaceItem {
  if (typeof raw !== 'object' || raw === null) return false
  const it = raw as Record<string, unknown>
  return (
    typeof it.i === 'string' &&
    typeof it.type === 'string' &&
    it.type in PANELS &&
    [it.x, it.y, it.w, it.h].every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

export function defaultGraphConfig(): SpeedGraphConfig {
  return { servers: 'default', windowSec: 300 }
}

export function defaultStatsConfig(): StatsPanelConfig {
  return { server: 'default' }
}

/** Narrow a workspace item's config to the Session Stats shape. */
export function getStatsConfig(item: WorkspaceItem): StatsPanelConfig {
  return (item.config as StatsPanelConfig | undefined) ?? defaultStatsConfig()
}

/**
 * Which server(s) a panel currently represents, for header color-coding.
 * Torrents 'default' scope = all servers; Stats/Speed 'default' = the first;
 * detail panels follow the selected torrent's server. Ids not in `allProfileIds`
 * are dropped (stale config).
 */
export function panelServerIds(
  item: WorkspaceItem,
  allProfileIds: string[],
  detailProfileId: string | null
): string[] {
  const keep = (ids: (string | null | undefined)[]): string[] =>
    ids.filter((id): id is string => !!id && allProfileIds.includes(id))
  switch (item.type) {
    case 'torrent-list': {
      const cfg = getListConfig(item)
      return keep(cfg.servers === 'default' ? allProfileIds : cfg.servers)
    }
    case 'speed-graph': {
      const cfg = getGraphConfig(item)
      return keep(cfg.servers === 'default' ? allProfileIds : cfg.servers)
    }
    case 'stats': {
      const server = getStatsConfig(item).server
      return keep([server === 'default' ? allProfileIds[0] : server])
    }
    case 'detail':
    case 'detail-general':
    case 'detail-files':
    case 'detail-peers':
    case 'detail-trackers':
    case 'detail-pieces':
      return keep([detailProfileId])
    default:
      return []
  }
}

/** Narrow a workspace item's config to the Torrents panel shape (filled by withConfig). */
export function getListConfig(item: WorkspaceItem): TorrentsPanelConfig {
  return (item.config as TorrentsPanelConfig | undefined) ?? defaultPanelConfig()
}

/** Narrow a workspace item's config to the Speed Graph shape (filled by withConfig). */
export function getGraphConfig(item: WorkspaceItem): SpeedGraphConfig {
  return (item.config as SpeedGraphConfig | undefined) ?? defaultGraphConfig()
}

/** Ensure config-carrying items have a complete config (fills gaps from defaults). */
function withConfig(item: WorkspaceItem, seedSort?: SortPref): WorkspaceItem {
  if (item.type === 'speed-graph') {
    const base = defaultGraphConfig()
    // `server` is the pre-multi-server shape: one id → that single server.
    const cfg = (item.config ?? {}) as Partial<SpeedGraphConfig> & { server?: string }
    const servers =
      Array.isArray(cfg.servers) && cfg.servers.every((x) => typeof x === 'string') && cfg.servers.length
        ? cfg.servers
        : typeof cfg.server === 'string' && cfg.server !== 'default'
          ? [cfg.server]
          : base.servers
    return {
      ...item,
      config: {
        servers,
        windowSec: cfg.windowSec === 60 || cfg.windowSec === 900 ? cfg.windowSec : base.windowSec
      }
    }
  }
  if (item.type === 'stats') {
    const cfg = (item.config ?? {}) as Partial<StatsPanelConfig>
    return {
      ...item,
      config: { server: typeof cfg.server === 'string' ? cfg.server : defaultStatsConfig().server }
    }
  }
  if (item.type !== 'torrent-list') return item
  const base = defaultPanelConfig(seedSort)
  const cfg = (item.config ?? {}) as Partial<TorrentsPanelConfig>
  return {
    ...item,
    config: {
      servers: Array.isArray(cfg.servers) || cfg.servers === 'default' ? cfg.servers : base.servers,
      filters: { ...base.filters, ...(cfg.filters ?? {}) },
      sort: cfg.sort ?? base.sort,
      view: cfg.view === 'table' ? 'table' : 'cards',
      visibleColumns: cfg.visibleColumns,
      collapsedServers: cfg.collapsedServers
    }
  }
}

/**
 * Validate and migrate a persisted layout. Returns null when unusable —
 * callers fall back to defaultLayout(). Unknown panel types are dropped
 * item-by-item (this is also how v1's retired 'filters' panel disappears);
 * an unknown *future* version rejects the whole layout.
 *
 * @param seedSort sort applied to migrated v1 list panels, so a user's old
 * global sort preference carries over into the per-panel world.
 */
export function normalizeLayout(raw: unknown, seedSort?: SortPref): WorkspaceLayout | null {
  if (typeof raw !== 'object' || raw === null) return null
  const layout = raw as { version?: unknown; items?: unknown }
  if (typeof layout.version !== 'number' || layout.version > CURRENT_LAYOUT_VERSION) return null
  if (!Array.isArray(layout.items)) return null
  const items = layout.items.filter(isValidItem).map((it) => withConfig(it, seedSort))
  if (items.length === 0) return null
  return { version: CURRENT_LAYOUT_VERSION, items }
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * First empty w×h slot in the grid, scanning top-to-bottom then left-to-right,
 * so a new panel tucks into a gap beside existing panels instead of always
 * starting a new row. Falls through to the bottom-left (always free) when
 * nothing fits alongside — the loop is bounded by the current lowest edge.
 */
export function firstFreeSlot(existing: Rect[], w: number, h: number, cols = GRID_COLS): { x: number; y: number } {
  const maxY = existing.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!existing.some((it) => overlaps({ x, y, w, h }, it))) return { x, y }
    }
  }
  return { x: 0, y: maxY }
}

/** Grid position for a newly added panel: the first empty slot that fits. */
export function placeNewItem(type: PanelTypeId, existing: WorkspaceItem[]): WorkspaceItem {
  const meta = PANELS[type]
  const { x, y } = firstFreeSlot(existing, meta.w, meta.h)
  const item: WorkspaceItem = { i: crypto.randomUUID(), type, x, y, w: meta.w, h: meta.h }
  if (type === 'torrent-list') return { ...item, config: defaultPanelConfig() }
  if (type === 'speed-graph') return { ...item, config: defaultGraphConfig() }
  if (type === 'stats') return { ...item, config: defaultStatsConfig() }
  return item
}
