import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Electron 44+ clipboard: readText() is async. The watcher must seed from the
// clipboard before polling, offer a *new* magnet exactly once, and stay quiet
// while the pref is off or a read fails.
const readText = vi.fn<() => Promise<string>>()
vi.mock('electron', () => ({ clipboard: { readText: () => readText() } }))
const prefs = { watchClipboardMagnets: true }
vi.mock('./profiles', () => ({ getPrefs: () => prefs }))

import { startClipboardWatch, stopClipboardWatch } from './clipboardWatch'

function fakeWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}
const TICK = 1500

describe('clipboard magnet watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    readText.mockReset()
    prefs.watchClipboardMagnets = true
  })
  afterEach(() => {
    stopClipboardWatch()
    vi.useRealTimers()
  })

  it('skips a magnet already on the clipboard at start, offers a new one once', async () => {
    const win = fakeWindow()
    readText.mockResolvedValue('magnet:?xt=urn:btih:AAA')
    startClipboardWatch(() => win as never)
    await vi.advanceTimersByTimeAsync(0) // seed resolves, polling starts
    await vi.advanceTimersByTimeAsync(TICK)
    expect(win.webContents.send).not.toHaveBeenCalled()

    readText.mockResolvedValue('  magnet:?xt=urn:btih:BBB \n')
    await vi.advanceTimersByTimeAsync(TICK)
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).toHaveBeenCalledWith('open-magnet', 'magnet:?xt=urn:btih:BBB')

    await vi.advanceTimersByTimeAsync(TICK * 3) // unchanged clipboard → no repeat
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while the pref is off, on read errors, and without a window', async () => {
    const win = fakeWindow()
    readText.mockResolvedValue('')
    let current: ReturnType<typeof fakeWindow> | null = win
    startClipboardWatch(() => current as never)
    await vi.advanceTimersByTimeAsync(0)

    prefs.watchClipboardMagnets = false
    readText.mockResolvedValue('magnet:?xt=urn:btih:CCC')
    await vi.advanceTimersByTimeAsync(TICK)
    expect(win.webContents.send).not.toHaveBeenCalled()

    prefs.watchClipboardMagnets = true
    readText.mockRejectedValue(new Error('clipboard unavailable'))
    await vi.advanceTimersByTimeAsync(TICK)
    expect(win.webContents.send).not.toHaveBeenCalled()

    current = null
    readText.mockResolvedValue('magnet:?xt=urn:btih:CCC')
    await vi.advanceTimersByTimeAsync(TICK)
    expect(win.webContents.send).not.toHaveBeenCalled()

    current = win
    await vi.advanceTimersByTimeAsync(TICK)
    expect(win.webContents.send).toHaveBeenCalledWith('open-magnet', 'magnet:?xt=urn:btih:CCC')
  })

  it('is idempotent: a second start does not create a second poller', async () => {
    const win = fakeWindow()
    readText.mockResolvedValue('')
    startClipboardWatch(() => win as never)
    startClipboardWatch(() => win as never)
    await vi.advanceTimersByTimeAsync(0)
    readText.mockClear()
    await vi.advanceTimersByTimeAsync(TICK)
    expect(readText).toHaveBeenCalledTimes(1)
  })
})
