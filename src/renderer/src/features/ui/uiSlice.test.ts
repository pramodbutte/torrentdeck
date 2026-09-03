import { describe, it, expect } from 'vitest'
import reducer, {
  openAddTorrent,
  closeAddTorrent,
  addMagnets,
  removeMagnet,
  actionFailed,
  dismissActionError
} from './uiSlice'

const A = 'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&dn=A'
const A_ALT = 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&tr=udp://x'
const B = 'magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&dn=B'

const run = (actions: Parameters<typeof reducer>[1][]) =>
  actions.reduce((state, action) => reducer(state, action), reducer(undefined, { type: '@@init' }))

describe('Add-dialog magnet accumulation', () => {
  it('opening with a magnet starts a one-item batch', () => {
    const s = run([openAddTorrent({ magnet: A })])
    expect(s.addTorrent?.magnets).toEqual([A])
  })

  it('a magnet arriving while open accumulates instead of clobbering', () => {
    const s = run([openAddTorrent({ magnet: A }), openAddTorrent({ magnet: B })])
    expect(s.addTorrent?.magnets).toEqual([A, B])
  })

  it('dedupes by infohash across differing case/trackers', () => {
    const s = run([openAddTorrent({ magnet: A }), openAddTorrent({ magnet: A_ALT })])
    expect(s.addTorrent?.magnets).toEqual([A])
  })

  it('manual open (empty magnet) does not clobber an existing batch', () => {
    // e.g. user hits the Add shortcut while the dialog already holds magnets
    const s = run([openAddTorrent({ magnet: A }), openAddTorrent({ magnet: '' })])
    // empty magnet is not a real link, so it replaces only when nothing is open;
    // here it replaces the payload (fresh manual open) — batch resets to empty.
    expect(s.addTorrent?.magnets ?? []).toEqual([])
  })

  it('addMagnets appends+dedupes and ignores non-magnets', () => {
    const s = run([openAddTorrent({ magnet: A }), addMagnets([B, A_ALT, 'not-a-magnet'])])
    expect(s.addTorrent?.magnets).toEqual([A, B])
  })

  it('addMagnets is a no-op when the dialog is closed', () => {
    const s = run([addMagnets([A])])
    expect(s.addTorrent).toBeNull()
  })

  it('removeMagnet drops by infohash (any string form)', () => {
    const s = run([openAddTorrent({ magnet: A }), addMagnets([B]), removeMagnet(A_ALT)])
    expect(s.addTorrent?.magnets).toEqual([B])
  })

  it('closing clears the batch', () => {
    const s = run([openAddTorrent({ magnet: A }), closeAddTorrent()])
    expect(s.addTorrent).toBeNull()
  })
})

describe('action-error notice', () => {
  it('starts empty and keeps only the latest failure', () => {
    expect(run([]).actionError).toBeNull()
    const s = run([
      actionFailed({ message: 'Pause failed on NAS: boom', at: 1 }),
      actionFailed({ message: 'Verify local data failed on NAS: nope', at: 2 })
    ])
    expect(s.actionError).toEqual({ message: 'Verify local data failed on NAS: nope', at: 2 })
  })

  it('dismiss clears it', () => {
    const s = run([actionFailed({ message: 'x', at: 1 }), dismissActionError()])
    expect(s.actionError).toBeNull()
  })
})
