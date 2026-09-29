/**
 * Optional clipboard watcher: while the `watchClipboardMagnets` pref is on and
 * the window is open, poll the clipboard and, when a *new* magnet link appears,
 * push it to the renderer via the existing `open-magnet` channel (which opens
 * the prefilled Add dialog). Opt-in and off by default — polling reads whatever
 * you copy, so it's a deliberate choice.
 *
 * `clipboard.readText()` is async since Electron 44 (W3C Clipboard API shape),
 * so the seed and each poll await it; a failed read just skips that tick.
 */
import { clipboard, type BrowserWindow } from 'electron'
import { getPrefs } from './profiles'

let started = false
let timer: ReturnType<typeof setInterval> | null = null
let lastMagnet = ''

async function readClipboardText(): Promise<string> {
  try {
    return (await clipboard.readText()).trim()
  } catch {
    return ''
  }
}

/**
 * Begin polling (idempotent). The interval always runs but only acts while the
 * pref is enabled, so toggling the setting takes effect on the next tick with
 * no extra wiring. Seeds the last-seen magnet from the current clipboard so a
 * link already sitting there at launch isn't offered unprompted; polling only
 * starts once that seed has been read.
 */
export function startClipboardWatch(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  void readClipboardText().then((cur) => {
    if (cur.startsWith('magnet:')) lastMagnet = cur
    timer = setInterval(() => void poll(getWindow), 1500)
  })
}

async function poll(getWindow: () => BrowserWindow | null): Promise<void> {
  if (!getPrefs().watchClipboardMagnets) return
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  const text = await readClipboardText()
  if (text.startsWith('magnet:') && text !== lastMagnet) {
    lastMagnet = text
    if (!win.isDestroyed()) win.webContents.send('open-magnet', text)
  }
}

/** Stop polling and forget state (tests; the app lets the interval die with the process). */
export function stopClipboardWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
  started = false
  lastMagnet = ''
}
