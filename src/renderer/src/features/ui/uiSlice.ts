/**
 * Ephemeral view state: selection, detail target, panel focus, and open
 * dialogs. Filters/sort/search moved into each Torrents panel's persisted
 * config in v0.3 (see TorrentsPanelConfig) — they no longer live here.
 *
 * Selection is server-qualified (ADR-0003): torrent ids are only unique per
 * daemon, so selection always carries the profileId it belongs to, and
 * multi-select never spans servers (every bulk action stays a single RPC).
 *
 * Dialog-state conventions: `addTorrent` null = closed; `profileEditorId`
 * undefined = closed, null = "create new", string = edit that profile;
 * `removeConfirm`/`labelsEditor` null = closed.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { TorrentFilePayload } from '@shared/types'
import { dedupeMagnets, isMagnet, magnetInfohash } from '@shared/magnet'

export interface Selection {
  profileId: string
  /** Torrent identities = infohash strings (ADR-0004). */
  ids: string[]
}

export interface AddTorrentPayload {
  /** Empty string = opened manually (prefill from clipboard); a `magnet:` URI
   *  = opened for that link. Callers keep passing one magnet; the reducer folds
   *  it into `magnets` and accumulates when the dialog is already open. */
  magnet?: string
  /** Accumulated magnet links (deduped by infohash) for a batch add. */
  magnets?: string[]
  files?: TorrentFilePayload[]
}

export interface RenameTarget {
  profileId: string
  id: string
  /** Full path within the torrent of the thing being renamed */
  path: string
  /** Its current basename (prefill) */
  currentName: string
}

export interface UiState {
  selection: Selection | null
  detailTarget: { profileId: string; id: string } | null
  focusedPanelId: string | null
  detailTab: 'general' | 'files' | 'peers' | 'trackers' | 'pieces'
  addTorrent: AddTorrentPayload | null
  profileEditorId: string | null | undefined
  removeConfirm: Selection | null
  labelsEditor: Selection | null
  renameTarget: RenameTarget | null
  queueEditor: { profileId: string; id: string; current: number; name: string } | null
  sessionSettingsOpen: boolean
  prefsOpen: boolean
  shortcutsOpen: boolean
  groupsOpen: boolean
  /** Version of a downloaded, ready-to-install update (null = none). */
  updateReadyVersion: string | null
}

const initialState: UiState = {
  selection: null,
  detailTarget: null,
  focusedPanelId: null,
  detailTab: 'general',
  addTorrent: null,
  profileEditorId: undefined,
  removeConfirm: null,
  labelsEditor: null,
  renameTarget: null,
  queueEditor: null,
  sessionSettingsOpen: false,
  prefsOpen: false,
  shortcutsOpen: false,
  groupsOpen: false,
  updateReadyVersion: null
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    selectTorrent(
      state,
      action: PayloadAction<{ profileId: string; id: string; additive: boolean }>
    ) {
      const { profileId, id, additive } = action.payload
      const sameServer = state.selection?.profileId === profileId
      if (additive && sameServer && state.selection) {
        state.selection.ids = state.selection.ids.includes(id)
          ? state.selection.ids.filter((x) => x !== id)
          : [...state.selection.ids, id]
        if (state.selection.ids.length === 0) state.selection = null
      } else {
        state.selection = { profileId, ids: [id] }
      }
      state.detailTarget = state.selection?.ids.includes(id) ? { profileId, id } : null
    },
    selectMany(state, action: PayloadAction<Selection>) {
      const { profileId, ids } = action.payload
      state.selection = ids.length ? { profileId, ids } : null
      state.detailTarget = ids.length ? { profileId, id: ids[ids.length - 1] } : null
    },
    /** Shift-click range select: set the selection but keep detailTarget (the
     *  anchor) fixed, so successive shift-clicks extend from the same origin. */
    selectRange(state, action: PayloadAction<Selection>) {
      const { profileId, ids } = action.payload
      state.selection = ids.length ? { profileId, ids } : null
    },
    clearSelection(state) {
      state.selection = null
      state.detailTarget = null
    },
    setFocusedPanel(state, action: PayloadAction<string | null>) {
      state.focusedPanelId = action.payload
    },
    setDetailTab(state, action: PayloadAction<UiState['detailTab']>) {
      state.detailTab = action.payload
    },
    openAddTorrent(state, action: PayloadAction<AddTorrentPayload>) {
      const p = action.payload
      const incoming = p.magnet && isMagnet(p.magnet) ? p.magnet : null
      // A real magnet arriving while the dialog is already open accumulates
      // (clipboard/OS handoff), rather than clobbering an in-progress add.
      if (incoming && state.addTorrent) {
        const existing = state.addTorrent.magnets ?? []
        state.addTorrent.magnets = dedupeMagnets([...existing, incoming])
        return
      }
      state.addTorrent = incoming ? { magnets: [incoming] } : p
    },
    closeAddTorrent(state) {
      state.addTorrent = null
    },
    /** Append magnets to the open Add dialog's batch (manual paste/type),
     *  deduped by infohash. No-op if the dialog isn't open. */
    addMagnets(state, action: PayloadAction<string[]>) {
      if (!state.addTorrent) return
      const existing = state.addTorrent.magnets ?? []
      state.addTorrent.magnets = dedupeMagnets([
        ...existing,
        ...action.payload.filter((m) => isMagnet(m))
      ])
    },
    /** Remove one magnet from the batch by infohash (or exact string). */
    removeMagnet(state, action: PayloadAction<string>) {
      const list = state.addTorrent?.magnets
      if (!list) return
      const key = magnetInfohash(action.payload) ?? action.payload.trim()
      state.addTorrent!.magnets = list.filter((m) => (magnetInfohash(m) ?? m.trim()) !== key)
    },
    openProfileEditor(state, action: PayloadAction<string | null>) {
      state.profileEditorId = action.payload
    },
    closeProfileEditor(state) {
      state.profileEditorId = undefined
    },
    openRemoveConfirm(state, action: PayloadAction<Selection>) {
      state.removeConfirm = action.payload
    },
    closeRemoveConfirm(state) {
      state.removeConfirm = null
    },
    openLabelsEditor(state, action: PayloadAction<Selection>) {
      state.labelsEditor = action.payload
    },
    closeLabelsEditor(state) {
      state.labelsEditor = null
    },
    openRename(state, action: PayloadAction<RenameTarget>) {
      state.renameTarget = action.payload
    },
    closeRename(state) {
      state.renameTarget = null
    },
    openQueueEditor(
      state,
      action: PayloadAction<{ profileId: string; id: string; current: number; name: string }>
    ) {
      state.queueEditor = action.payload
    },
    closeQueueEditor(state) {
      state.queueEditor = null
    },
    setSessionSettingsOpen(state, action: PayloadAction<boolean>) {
      state.sessionSettingsOpen = action.payload
    },
    setPrefsOpen(state, action: PayloadAction<boolean>) {
      state.prefsOpen = action.payload
    },
    setShortcutsOpen(state, action: PayloadAction<boolean>) {
      state.shortcutsOpen = action.payload
    },
    setGroupsOpen(state, action: PayloadAction<boolean>) {
      state.groupsOpen = action.payload
    },
    setUpdateReady(state, action: PayloadAction<string>) {
      state.updateReadyVersion = action.payload
    }
  }
})

export const {
  selectTorrent,
  selectMany,
  selectRange,
  clearSelection,
  setFocusedPanel,
  setDetailTab,
  openAddTorrent,
  closeAddTorrent,
  addMagnets,
  removeMagnet,
  openProfileEditor,
  closeProfileEditor,
  openRemoveConfirm,
  closeRemoveConfirm,
  openLabelsEditor,
  closeLabelsEditor,
  openRename,
  closeRename,
  openQueueEditor,
  closeQueueEditor,
  setSessionSettingsOpen,
  setPrefsOpen,
  setShortcutsOpen,
  setGroupsOpen,
  setUpdateReady
} = uiSlice.actions
export default uiSlice.reducer
