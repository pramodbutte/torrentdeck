/**
 * Auto-update via electron-updater, reading published GitHub releases (see the
 * `publish` block in electron-builder.yml → pramodbutte/torrentdeck). Each
 * release's `latest*.yml` + installer/blockmap is produced by
 * `electron-builder --publish always`. No dedicated update server is needed —
 * the public GitHub release *is* the backend.
 *
 * Three triggers:
 *  1. on launch (once, shortly after the app is ready),
 *  2. periodically (every 6 h while running),
 *  3. manually via the "Check for updates…" menu item (reports the result).
 *
 * Background checks (1, 2) are silent unless an update is found; a manual check
 * always tells the user the outcome. A downloaded update is a Pending Update:
 * it installs ONLY when the user explicitly asks (menu item / notification
 * click) — quitting or restarting never applies it. The nudge is quiet: one
 * notification per version, then just the badge on the app menu. macOS
 * requires the app to be signed + notarized for updates to apply, which
 * release builds are. All stages are logged for post-hoc diagnosis.
 */
import electronUpdater from 'electron-updater'
import { app, dialog, BrowserWindow, Notification } from 'electron'
import { log } from './logger'
import { setQuitting } from './appState'
import { getPrefs, setPrefs } from './profiles'

const { autoUpdater } = electronUpdater
const PERIODIC_MS = 6 * 60 * 60 * 1000 // 6 hours

// True only while a user-initiated check is in flight, so background checks
// stay silent while a manual one reports "up to date" / errors.
let manualCheck = false

function activeWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
}

function messageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = activeWindow()
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

export function initAutoUpdater(): void {
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  // A quit or restart must never silently apply a Pending Update — install is
  // always an explicit user action (menu / notification click).
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => log.info('updater: checking for update'))

  autoUpdater.on('update-available', (info) => {
    log.info(`updater: update available → ${info.version} (downloading)`)
    if (manualCheck) {
      manualCheck = false
      void messageBox({
        type: 'info',
        title: 'Update available',
        message: `TorrentDeck ${info.version} is available.`,
        detail: "It's downloading in the background — install it from the app menu (badge) whenever you like.",
        buttons: ['OK']
      })
    }
  })

  autoUpdater.on('update-not-available', () => {
    log.info('updater: already up to date')
    if (manualCheck) {
      manualCheck = false
      void messageBox({
        type: 'info',
        title: "You're up to date",
        message: `TorrentDeck ${app.getVersion()} is the latest version.`,
        buttons: ['OK']
      })
    }
  })

  autoUpdater.on('download-progress', (p) =>
    log.info(`updater: downloading ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`)
  )

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`updater: ${info.version} downloaded — ready to install (deferred)`)
    manualCheck = false
    // Non-blocking: tell the renderer (menu badge + "Restart to install") and
    // notify once per version. The user installs whenever they like; deferring
    // forever just means the badge is back next session.
    activeWindow()?.webContents.send('update-downloaded', { version: info.version })
    if (Notification.isSupported() && getPrefs().lastUpdateNotifiedVersion !== info.version) {
      setPrefs({ lastUpdateNotifiedVersion: info.version })
      const n = new Notification({
        title: 'Update ready',
        body: `TorrentDeck ${info.version} is ready. Click to install and restart now, or keep working — it stays available in the app menu.`
      })
      n.on('click', () => installUpdateNow())
      n.show()
    }
  })

  autoUpdater.on('error', (err) => {
    log.error('updater: error', err)
    if (manualCheck) {
      manualCheck = false
      void messageBox({
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: String(err?.message ?? err),
        buttons: ['OK']
      })
    }
  })

  void runCheck('launch')
  setInterval(() => void runCheck('periodic'), PERIODIC_MS)
}

/** Quit and apply a downloaded update now (from the menu / notification). */
export function installUpdateNow(): void {
  setQuitting(true)
  autoUpdater.quitAndInstall()
}

function runCheck(reason: string): Promise<unknown> {
  log.info(`updater: ${reason} check`)
  return autoUpdater.checkForUpdates().catch((err) => log.warn(`updater: ${reason} check failed`, err))
}

/** User-initiated check (menu). Reports the outcome via the event handlers. */
export async function checkForUpdatesManually(): Promise<void> {
  if (!app.isPackaged) {
    await messageBox({
      type: 'info',
      title: 'Updates unavailable',
      message: 'Auto-update only runs in a packaged build.',
      buttons: ['OK']
    })
    return
  }
  manualCheck = true
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // surfaced by the 'error' handler
    log.warn('updater: manual check failed', err)
  }
}
