import { describe, expect, it, vi } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import { rpcApi } from '@/services/rpcApi'
import uiReducer, { dismissActionError } from './uiSlice'
import { actionErrorMiddleware, actionLabel, describeActionError } from './actionErrors'

describe('actionLabel', () => {
  it('names torrent actions by their menu verb', () => {
    expect(actionLabel('torrentAction', { action: 'torrent-verify' })).toBe('Verify local data')
    expect(actionLabel('torrentAction', { action: 'torrent-stop' })).toBe('Pause')
    expect(actionLabel('torrentAction', { action: 'torrent-bogus' })).toBe('Torrent action')
  })

  it('distinguishes Move data from Find data by the move flag', () => {
    expect(actionLabel('setLocation', { move: true })).toBe('Move data')
    expect(actionLabel('setLocation', { move: false })).toBe('Find data')
  })

  it('falls back for unknown endpoints and missing args', () => {
    expect(actionLabel('somethingElse', undefined)).toBe('Action')
  })
})

describe('describeActionError', () => {
  it('composes action, server, and the daemon message', () => {
    expect(
      describeActionError(
        'torrentAction',
        { action: 'torrent-verify' },
        { kind: 'rpc', message: 'torrent not found' },
        'NAS'
      )
    ).toBe('Verify local data failed on NAS: torrent not found')
  })

  it('omits the server when unknown and tolerates a missing or blank message', () => {
    expect(describeActionError('queueMove', {}, undefined, undefined)).toBe(
      'Queue move failed: unknown error'
    )
    expect(describeActionError('removeTorrent', {}, { message: '   ' }, 'Seedbox')).toBe(
      'Remove failed on Seedbox: unknown error'
    )
  })
})

describe('actionErrorMiddleware', () => {
  const PROFILES = { profiles: [{ id: 'p1', name: 'NAS' }] }

  function makeStore(invoke: () => Promise<unknown>) {
    // The IPC bridge is the renderer's only transport; stub it for the store.
    ;(globalThis as unknown as { window: unknown }).window = { api: { invoke } }
    return configureStore({
      reducer: {
        [rpcApi.reducerPath]: rpcApi.reducer,
        ui: uiReducer,
        connection: () => PROFILES
      },
      middleware: (getDefault) =>
        getDefault().prepend(actionErrorMiddleware.middleware).concat(rpcApi.middleware)
    })
  }

  it('turns a rejected in-scope mutation into ui.actionError', async () => {
    const store = makeStore(() =>
      Promise.resolve({ ok: false, error: { kind: 'rpc', message: 'torrent not found' } })
    )
    await store.dispatch(
      rpcApi.endpoints.torrentAction.initiate({
        profileId: 'p1',
        action: 'torrent-verify',
        ids: ['h']
      })
    )
    expect(store.getState().ui.actionError?.message).toBe(
      'Verify local data failed on NAS: torrent not found'
    )
  })

  it('stays silent on success', async () => {
    const store = makeStore(() => Promise.resolve({ ok: true, data: {} }))
    store.dispatch(dismissActionError())
    await store.dispatch(
      rpcApi.endpoints.torrentAction.initiate({
        profileId: 'p1',
        action: 'torrent-stop',
        ids: ['h']
      })
    )
    expect(store.getState().ui.actionError).toBeNull()
  })

  it('leaves out-of-scope endpoints (handled inline by their dialogs) alone', async () => {
    const store = makeStore(() =>
      Promise.resolve({ ok: false, error: { kind: 'rpc', message: 'duplicate' } })
    )
    await store.dispatch(
      rpcApi.endpoints.addTorrent.initiate({ profileId: 'p1', magnet: 'magnet:?xt=x' })
    )
    expect(store.getState().ui.actionError).toBeNull()
  })

  it('routes mutations through the stubbed IPC bridge', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true, data: {} }))
    const store = makeStore(invoke)
    await store.dispatch(
      rpcApi.endpoints.queueMove.initiate({
        profileId: 'p1',
        ids: ['h'],
        direction: 'queue-move-top'
      })
    )
    expect(invoke).toHaveBeenCalledOnce()
  })
})
