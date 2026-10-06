import { describe, expect, it } from 'vitest'
import type { SpeedGraphConfig, TorrentsPanelConfig, WorkspaceLayout } from '@shared/types'
import {
  CURRENT_LAYOUT_VERSION,
  defaultLayout,
  defaultPanelConfig,
  normalizeLayout,
  placeNewItem,
  PANELS
} from './panels'
import reducer, {
  gridChanged,
  panelAdded,
  panelRemoved,
  panelConfigChanged,
  layoutReset,
  type WorkspaceState
} from './workspaceSlice'

describe('defaultLayout', () => {
  it('is valid under its own normalizer and carries panel config', () => {
    const layout = defaultLayout()
    expect(normalizeLayout(layout)).toEqual(layout)
    expect(layout.items.map((i) => i.type)).toEqual(['torrent-list', 'detail'])
    expect(layout.items[0].config).toEqual(defaultPanelConfig())
    const ids = new Set(layout.items.map((i) => i.i))
    expect(ids.size).toBe(2)
  })
})

describe('normalizeLayout migrations', () => {
  it('rejects future versions outright', () => {
    const layout = { ...defaultLayout(), version: CURRENT_LAYOUT_VERSION + 1 }
    expect(normalizeLayout(layout)).toBeNull()
  })

  it('rejects null, garbage, and empty layouts', () => {
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout('nonsense')).toBeNull()
    expect(normalizeLayout({ version: CURRENT_LAYOUT_VERSION, items: [] })).toBeNull()
  })

  it('migrates a v1 layout: drops the retired filters panel, stamps config, seeds sort', () => {
    const v1 = {
      version: 1,
      items: [
        { i: 'a', type: 'filters', x: 0, y: 0, w: 2, h: 14 },
        { i: 'b', type: 'torrent-list', x: 2, y: 0, w: 7, h: 14 },
        { i: 'c', type: 'detail', x: 9, y: 0, w: 3, h: 14 }
      ]
    }
    const result = normalizeLayout(v1, { key: 'name', desc: false })
    expect(result).not.toBeNull()
    expect(result!.version).toBe(CURRENT_LAYOUT_VERSION)
    expect(result!.items.map((i) => i.type)).toEqual(['torrent-list', 'detail'])
    const listCfg = result!.items[0].config as TorrentsPanelConfig
    expect(listCfg.servers).toBe('default')
    expect(listCfg.sort).toEqual({ key: 'name', desc: false })
    expect(listCfg.filters.status).toBe('all')
    expect(result!.items[1].config).toBeUndefined()
  })

  it('drops unknown panel types item-by-item, keeping the rest', () => {
    const good = defaultLayout()
    const layout = {
      version: CURRENT_LAYOUT_VERSION,
      items: [...good.items, { i: 'x', type: 'geo-map', x: 0, y: 0, w: 2, h: 2 }]
    }
    const result = normalizeLayout(layout)
    expect(result?.items).toHaveLength(2)
  })

  it('fills partial configs from defaults', () => {
    const layout = {
      version: CURRENT_LAYOUT_VERSION,
      items: [
        {
          i: 'b',
          type: 'torrent-list',
          x: 0,
          y: 0,
          w: 9,
          h: 14,
          config: { servers: ['p1'], filters: { status: 'seeding' } }
        }
      ]
    }
    const cfg = normalizeLayout(layout)!.items[0].config as TorrentsPanelConfig
    expect(cfg.servers).toEqual(['p1'])
    expect(cfg.filters).toEqual({ status: 'seeding', tracker: null, label: null, search: '' })
    expect(cfg.view).toBe('cards')
    expect(cfg.sort).toEqual({ key: 'addedDate', desc: true })
  })
})

describe('placeNewItem', () => {
  it('falls through to the bottom-left when nothing fits alongside', () => {
    const items = defaultLayout().items // full-width top rows leave no gap
    const it = placeNewItem('detail', items)
    expect(it.y).toBe(14)
    expect(it.x).toBe(0)
    expect(it.w).toBe(PANELS.detail.w)
    expect(it.h).toBe(PANELS.detail.h)
    expect(it.config).toBeUndefined()
  })

  it('tucks a new panel into a horizontal gap when one fits', () => {
    const existing = [
      { i: 'a', type: 'stats', x: 0, y: 0, w: 3, h: 4 },
      { i: 'b', type: 'stats', x: 6, y: 0, w: 3, h: 4 }
    ] as ReturnType<typeof defaultLayout>['items']
    const it = placeNewItem('stats', existing) // stats is 3 wide → fits the x3–5 gap
    expect({ x: it.x, y: it.y }).toEqual({ x: 3, y: 0 })
  })

  it('stamps default server config onto new stats panels', () => {
    const it = placeNewItem('stats', defaultLayout().items)
    expect(it.config).toEqual({ server: 'default' })
  })

  it('stamps default config onto new torrent-list panels', () => {
    const it = placeNewItem('torrent-list', [])
    expect(it.config).toEqual(defaultPanelConfig())
  })
})

describe('workspaceSlice', () => {
  const state = (): WorkspaceState => ({ layout: defaultLayout() })

  it('adds and removes panels', () => {
    let s = reducer(state(), panelAdded('stats'))
    expect(s.layout?.items).toHaveLength(3)
    const statsId = s.layout!.items.find((i) => i.type === 'stats')!.i
    s = reducer(s, panelRemoved(statsId))
    expect(s.layout?.items.map((i) => i.type)).not.toContain('stats')
  })

  it('merges grid positions by id without touching panel types', () => {
    const s0 = state()
    const target = s0.layout!.items[0]
    const s = reducer(s0, gridChanged({ [target.i]: { x: 5, y: 2, w: 4, h: 8 } }))
    const moved = s.layout!.items.find((i) => i.i === target.i)!
    expect(moved).toMatchObject({ x: 5, y: 2, w: 4, h: 8, type: target.type })
    expect(s.layout!.items[1]).toEqual(s0.layout!.items[1])
  })

  it('patches panel config in place', () => {
    const s0 = state()
    const listId = s0.layout!.items[0].i
    const s = reducer(
      s0,
      panelConfigChanged({ id: listId, patch: { servers: ['a', 'b'], view: 'table' } })
    )
    const cfg = s.layout!.items[0].config as TorrentsPanelConfig
    expect(cfg.servers).toEqual(['a', 'b'])
    expect(cfg.view).toBe('table')
    expect(cfg.filters.status).toBe('all')
  })

  it('reset restores the default arrangement', () => {
    let s = reducer(state(), panelRemoved(state().layout!.items[0].i))
    s = reducer(s, layoutReset())
    expect(s.layout?.items).toHaveLength(2)
  })
})

describe('speed-graph config', () => {
  it('accepts speed-graph items and fills default config', () => {
    const layout = {
      version: CURRENT_LAYOUT_VERSION,
      items: [{ i: 'g', type: 'speed-graph', x: 0, y: 0, w: 4, h: 6 }]
    }
    const cfg = normalizeLayout(layout)!.items[0].config as SpeedGraphConfig
    expect(cfg).toEqual({ servers: 'default', windowSec: 300 })
  })

  it('rejects invalid window values back to default', () => {
    const layout = {
      version: CURRENT_LAYOUT_VERSION,
      items: [{ i: 'g', type: 'speed-graph', x: 0, y: 0, w: 4, h: 6, config: { windowSec: 42 } }]
    }
    const cfg = normalizeLayout(layout)!.items[0].config as SpeedGraphConfig
    expect(cfg.windowSec).toBe(300)
  })

  it('migrates the legacy single-server config', () => {
    const layout = {
      version: CURRENT_LAYOUT_VERSION,
      items: [{ i: 'g', type: 'speed-graph', x: 0, y: 0, w: 4, h: 6, config: { server: 'p1' } }]
    }
    const cfg = normalizeLayout(layout)!.items[0].config as SpeedGraphConfig
    expect(cfg.servers).toEqual(['p1'])
  })
})

describe('layout persistence shape', () => {
  it('round-trips through JSON (structured-clone-safe for IPC)', () => {
    const layout: WorkspaceLayout = defaultLayout()
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout)
  })
})
