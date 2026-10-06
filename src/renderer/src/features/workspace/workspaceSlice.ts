/**
 * Workspace state: which panels are on the grid and where. The persisted copy
 * lives in electron-store keyed by profile id; this slice holds the active
 * profile's layout. Persistence is a listener-middleware side effect (see
 * persistWorkspaceMiddleware) so reducers stay pure — the pattern carried
 * over from the reference implementation in ADR-0002.
 */
import {
  createAsyncThunk,
  createListenerMiddleware,
  createSlice,
  isAnyOf,
  type PayloadAction
} from '@reduxjs/toolkit'
import type {
  PanelTypeId,
  ServerProfile,
  SpeedGraphConfig,
  StatsPanelConfig,
  TorrentsPanelConfig,
  WorkspaceItem,
  WorkspaceItemConfig,
  WorkspaceLayout
} from '@shared/types'
import { defaultLayout, normalizeLayout, placeNewItem, PANELS } from './panels'

export interface WorkspaceState {
  /** Layout being shown; null until the first loadWorkspace resolves */
  /** The single app-wide layout; null until the first loadWorkspace resolves */
  layout: WorkspaceLayout | null
}

const initialState: WorkspaceState = { layout: null }

export const loadWorkspace = createAsyncThunk(
  'workspace/load',
  async (_: void, { getState }): Promise<{ layout: WorkspaceLayout }> => {
    const stored = await window.api.workspace.get()
    // Seed any migrated v1 panels with a profile's old sort preference
    const state = getState() as { connection: { profiles: ServerProfile[] } }
    const seedSort = state.connection.profiles[0]?.sort
    return { layout: normalizeLayout(stored, seedSort) ?? defaultLayout() }
  }
)

/** Positions from react-grid-layout keyed by item id (x/y/w/h only). */
export type GridPositions = Record<string, { x: number; y: number; w: number; h: number }>

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState,
  reducers: {
    gridChanged(state, action: PayloadAction<GridPositions>) {
      if (!state.layout) return
      state.layout.items = state.layout.items.map((it) => {
        const pos = action.payload[it.i]
        return pos ? { ...it, ...pos } : it
      })
    },
    panelAdded(state, action: PayloadAction<PanelTypeId>) {
      if (!state.layout) return
      const type = action.payload
      // Single-instance panels are added at most once (keeps "View logs…" and
      // the Panels menu idempotent).
      if (!PANELS[type].multiInstance && state.layout.items.some((it) => it.type === type)) return
      state.layout.items.push(placeNewItem(type, state.layout.items))
    },
    panelRemoved(state, action: PayloadAction<string>) {
      if (!state.layout) return
      state.layout.items = state.layout.items.filter((it) => it.i !== action.payload)
    },
    panelConfigChanged(
      state,
      action: PayloadAction<{
        id: string
        patch: Partial<TorrentsPanelConfig> | Partial<SpeedGraphConfig> | Partial<StatsPanelConfig>
      }>
    ) {
      if (!state.layout) return
      const item = state.layout.items.find((it) => it.i === action.payload.id)
      if (item?.config) {
        item.config = { ...item.config, ...action.payload.patch } as WorkspaceItemConfig
      }
    },
    layoutReset(state) {
      state.layout = defaultLayout()
    }
  },
  extraReducers: (builder) => {
    builder.addCase(loadWorkspace.fulfilled, (state, action) => {
      state.layout = action.payload.layout
    })
  }
})

export const { gridChanged, panelAdded, panelRemoved, panelConfigChanged, layoutReset } =
  workspaceSlice.actions
export default workspaceSlice.reducer

export function selectPanelInstances(items: WorkspaceItem[] | undefined): Set<PanelTypeId> {
  return new Set((items ?? []).map((it) => it.type))
}

/**
 * Write-through persistence: any user mutation saves the single app-wide
 * layout. loadWorkspace deliberately does NOT trigger a save.
 */
export const persistWorkspaceMiddleware = createListenerMiddleware()
persistWorkspaceMiddleware.startListening({
  matcher: isAnyOf(gridChanged, panelAdded, panelRemoved, panelConfigChanged, layoutReset),
  effect: async (_action, api) => {
    const state = api.getState() as { workspace: WorkspaceState }
    if (state.workspace.layout) await window.api.workspace.set(state.workspace.layout)
  }
})
