import { useEffect, useMemo, useRef, useState } from 'react'
import type { TorrentFilePayload } from '@shared/types'
import { MB, unwantedBySizeThreshold } from '@shared/sizeFilter'
import { extractMagnets, isMagnet, magnetInfohash, magnetLabel } from '@shared/magnet'
import { useAppDispatch, useAppSelector, useFirstProfileId } from '@/app/hooks'
import { addMagnets, closeAddTorrent, removeMagnet } from '@/features/ui/uiSlice'
import { useAddTorrentMutation, useFreeSpaceQuery, useGetSessionQuery } from '@/services/rpcApi'
import { parseTorrentPreview } from '@shared/bencode'
import { formatBytes } from '@/lib/format'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { Checkbox, LabeledCheckbox } from '@/components/ui/checkbox'
import { useServerCapabilities, can } from '@/features/connection/useCapabilities'

/** Remembers the last server a torrent was added to, across restarts. */
const LAST_ADD_KEY = 'lastAddProfileId'
/** Per-server remembered destination folder (presence = "remember" is on). */
const rememberDirKey = (profileId: string): string => `rememberAddDir:${profileId}`

/** Log-ish snap stops for the size slider, in MB (0 = Off). */
const STOPS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000]
const nearestStopIndex = (mb: number): number => {
  let best = 0
  for (let i = 1; i < STOPS.length; i++) {
    if (Math.abs(STOPS[i] - mb) < Math.abs(STOPS[best] - mb)) best = i
  }
  return best
}

const NO_FILES: TorrentFilePayload[] = []

export function AddTorrentDialog(): React.JSX.Element | null {
  const dispatch = useAppDispatch()
  const payload = useAppSelector((s) => s.ui.addTorrent)
  const profiles = useAppSelector((s) => s.connection.profiles)
  const firstProfileId = useFirstProfileId()
  const [profileId, setProfileId] = useState<string | null>(null)
  const { data: session } = useGetSessionQuery(profileId ? { profileId } : { profileId: '' }, {
    skip: !profileId
  })
  const [addTorrent, { isLoading: adding }] = useAddTorrentMutation()
  const caps = useServerCapabilities(profileId)

  const [mode, setMode] = useState<'magnet' | 'file'>('magnet')
  const [pickedFiles, setPickedFiles] = useState<TorrentFilePayload[] | null>(null)
  const [draftMagnet, setDraftMagnet] = useState('')
  /** Per-magnet outcome after a batch add, keyed by infohash (or raw string). */
  const [results, setResults] = useState<Record<string, 'ok' | 'dup' | 'fail'>>({})
  const [batchSummary, setBatchSummary] = useState<string | null>(null)
  const [dir, setDir] = useState('')
  const [labels, setLabels] = useState('')
  const [paused, setPaused] = useState(false)
  const [sequential, setSequential] = useState(false)
  const [topOfQueue, setTopOfQueue] = useState(false)
  const [skipHash, setSkipHash] = useState(false)
  const [rememberDir, setRememberDir] = useState(false)
  const [unwanted, setUnwanted] = useState<Set<number>>(new Set())
  const [thresholdMB, setThresholdMB] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const open = payload !== null
  const files = pickedFiles ?? payload?.files ?? NO_FILES
  const magnets = payload?.magnets ?? []
  const isMagnetMode = mode === 'magnet'
  const magnetKey = (m: string): string => magnetInfohash(m) ?? m.trim()

  const commitDraft = (): void => {
    const found = extractMagnets(draftMagnet)
    if (found.length) {
      dispatch(addMagnets(found))
      setDraftMagnet('')
    }
  }

  const preview = useMemo(
    () => (files.length === 1 ? parseTorrentPreview(files[0].base64) : null),
    [files]
  )

  const applyServer = (id: string): void => {
    setProfileId(id)
    // Prefill the remembered folder for this server, if the user opted in before.
    const saved = localStorage.getItem(rememberDirKey(id))
    if (saved) {
      setDir(saved)
      setRememberDir(true)
    } else {
      setDir('') // the session effect fills the server's default download folder
      setRememberDir(false)
    }
  }

  // Reset the form only on the closed→open transition. While the dialog stays
  // open, accumulating magnets (clipboard/OS handoff) changes `payload` but must
  // NOT wipe what the user has typed — so guard on the open edge, not payload.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      // Default to the last server added to (if it still exists), else the current server.
      const last = localStorage.getItem(LAST_ADD_KEY)
      const chosen =
        last && profiles.some((p) => p.id === last) ? last : (firstProfileId ?? profiles[0]?.id ?? null)
      if (chosen) applyServer(chosen)
      else setProfileId(null)
      setMode(payload?.files?.length ? 'file' : 'magnet')
      setPickedFiles(null)
      setDraftMagnet('')
      setResults({})
      setBatchSummary(null)
      setLabels('')
      setPaused(false)
      setSequential(false)
      setTopOfQueue(false)
      setSkipHash(false)
      setUnwanted(new Set())
      setThresholdMB(0)
      setError(null)
      // Manual open with an empty magnet: seed the batch from a magnet already
      // sitting on the clipboard.
      if (payload?.magnet === '' && !payload?.magnets?.length) {
        void window.api.readClipboardText().then((text) => {
          if (isMagnet(text)) dispatch(addMagnets([text.trim()]))
        })
      }
    }
    wasOpen.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload])

  useEffect(() => {
    if (open && !dir && session) setDir(session['download-dir'])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, open])

  // When a .torrent is loaded (or the server changes), seed the threshold from
  // that server's Size Filter and derive the initial not-wanted set from it.
  useEffect(() => {
    if (!preview) return
    const p = profiles.find((x) => x.id === profileId)
    const mb = p?.sizeThresholdBytes ? Math.round(p.sizeThresholdBytes / MB) : 0
    setThresholdMB(mb)
    setUnwanted(new Set(unwantedBySizeThreshold(preview.files, mb * MB)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, profileId])

  const { data: freeSpace } = useFreeSpaceQuery(
    { profileId: profileId ?? '', path: dir },
    { skip: !profileId || !dir || !open }
  )

  if (!open || !profileId) return null

  const close = (): void => {
    dispatch(closeAddTorrent())
  }

  const changeServer = (id: string): void => {
    applyServer(id)
    localStorage.setItem(LAST_ADD_KEY, id)
  }

  const chooseFile = async (): Promise<void> => {
    const picked = await window.api.pickTorrentFiles()
    if (picked.length) {
      setPickedFiles(picked)
      setMode('file')
    }
  }

  // Slider is master: moving it re-derives the whole checked set purely by size.
  const applyThreshold = (mb: number): void => {
    setThresholdMB(mb)
    if (preview) setUnwanted(new Set(unwantedBySizeThreshold(preview.files, mb * MB)))
  }

  const toggleUnwanted = (index: number, wanted: boolean): void => {
    if (!preview) return
    const next = new Set(unwanted)
    if (wanted) next.delete(index)
    else {
      // Never leave the torrent with nothing to download.
      if (next.size + 1 >= preview.files.length) return
      next.add(index)
    }
    setUnwanted(next)
  }

  // Live selection summary for the file list.
  const summary = preview
    ? preview.files.reduce(
        (acc, f, i) => {
          if (unwanted.has(i)) acc.skipped++
          else {
            acc.selected++
            acc.selectedBytes += f.length
          }
          return acc
        },
        { selected: 0, skipped: 0, selectedBytes: 0 }
      )
    : null

  const serverThresholdMB = (() => {
    const p = profiles.find((x) => x.id === profileId)
    return p?.sizeThresholdBytes ? Math.round(p.sizeThresholdBytes / MB) : 0
  })()

  const submit = async (): Promise<void> => {
    setError(null)
    setBatchSummary(null)
    if (profileId) {
      localStorage.setItem(LAST_ADD_KEY, profileId)
      if (rememberDir && dir) localStorage.setItem(rememberDirKey(profileId), dir)
      else localStorage.removeItem(rememberDirKey(profileId))
    }
    const labelList = labels
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const common = {
      profileId,
      downloadDir: dir || undefined,
      paused,
      labels: labelList.length ? labelList : undefined,
      sequentialDownload: sequential || undefined,
      addToTopOfQueue: topOfQueue || undefined,
      skipHashCheck: skipHash || undefined
    }
    if (isMagnetMode) {
      // Batch: add every collected magnet, never aborting on one failure or
      // duplicate. Tally outcomes, drop the ones that landed, and keep the rest
      // visible (marked) so the user sees what didn't take.
      if (!magnets.length) {
        setError('Add at least one magnet link')
        return
      }
      const outcome: Record<string, 'ok' | 'dup' | 'fail'> = {}
      let added = 0
      let dup = 0
      let failed = 0
      for (const m of magnets) {
        const key = magnetKey(m)
        try {
          const res = await addTorrent({ ...common, magnet: m }).unwrap()
          if (res.duplicate) {
            outcome[key] = 'dup'
            dup++
          } else {
            outcome[key] = 'ok'
            added++
          }
        } catch {
          outcome[key] = 'fail'
          failed++
        }
      }
      setResults(outcome)
      if (dup === 0 && failed === 0) {
        close()
        return
      }
      // Clear the successes; leave duplicates/failures for another try.
      for (const m of magnets) if (outcome[magnetKey(m)] === 'ok') dispatch(removeMagnet(m))
      setBatchSummary(
        [added && `${added} added`, dup && `${dup} already on server`, failed && `${failed} failed`]
          .filter(Boolean)
          .join(' · ')
      )
      return
    }
    try {
      if (!files.length) {
        setError('Choose a .torrent file')
        return
      }
      for (const f of files) {
        await addTorrent({
          ...common,
          metainfoBase64: f.base64,
          unwantedIndices: files.length === 1 ? [...unwanted] : undefined
        }).unwrap()
      }
      close()
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Adding the torrent failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent title="Add torrent" wide={!!preview}>
        <div className="space-y-3">
          {profiles.length > 1 && (
            <Field label="Add to server">
              <select
                value={profileId ?? ''}
                onChange={(e) => changeServer(e.target.value)}
                className="h-9 w-full rounded-md border border-surface-300 bg-surface-50 px-2 text-sm dark:border-surface-600 dark:bg-surface-900"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Source: magnet link or a local .torrent file */}
          <div className="inline-flex rounded-md border border-surface-300 p-0.5 text-xs dark:border-surface-600">
            <button
              type="button"
              onClick={() => setMode('magnet')}
              className={`rounded px-3 py-1 ${isMagnetMode ? 'bg-accent-500 text-white' : 'text-surface-600 dark:text-surface-300'}`}
            >
              Magnet link{!isMagnetMode && magnets.length > 0 ? ` (${magnets.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`rounded px-3 py-1 ${!isMagnetMode ? 'bg-accent-500 text-white' : 'text-surface-600 dark:text-surface-300'}`}
            >
              .torrent file
            </button>
          </div>

          {isMagnetMode ? (
            <>
              <Field label={magnets.length > 1 ? `Magnet links (${magnets.length})` : 'Magnet link'}>
                <Input
                  value={draftMagnet}
                  onChange={(e) => {
                    const v = e.target.value
                    // A paste that carries whitespace (multi-line / trailing) is
                    // split into rows immediately; otherwise keep typing.
                    if (/\s/.test(v) && extractMagnets(v).length) {
                      dispatch(addMagnets(extractMagnets(v)))
                      setDraftMagnet('')
                    } else setDraftMagnet(v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitDraft()
                    }
                  }}
                  onBlur={commitDraft}
                  placeholder="Paste magnet:?xt=urn:btih:… (add several)"
                  autoFocus
                />
              </Field>
              {magnets.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-surface-200 p-1 dark:border-surface-700">
                  {magnets.map((m) => {
                    const status = results[magnetKey(m)]
                    return (
                      <li
                        key={magnetKey(m)}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-100 dark:hover:bg-surface-800"
                      >
                        <span className="min-w-0 flex-1 truncate" title={m}>
                          {magnetLabel(m)}
                        </span>
                        {status === 'dup' && (
                          <span className="shrink-0 text-amber-600 dark:text-amber-400">
                            already added
                          </span>
                        )}
                        {status === 'fail' && (
                          <span className="shrink-0 text-danger-600 dark:text-danger-400">failed</span>
                        )}
                        <button
                          type="button"
                          onClick={() => dispatch(removeMagnet(m))}
                          aria-label="Remove magnet"
                          className="shrink-0 rounded px-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400"
                        >
                          ✕
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {serverThresholdMB > 0 && (
                <p className="text-xs text-surface-500">
                  This server&apos;s Size Filter ({serverThresholdMB} MB) will skip small files
                  automatically once the daemon fetches the file list.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void chooseFile()}>
                  Choose .torrent…
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-surface-500">
                  {files.length === 0
                    ? 'No file chosen'
                    : files.length === 1
                      ? (preview?.name ?? files[0].name)
                      : `${files.length} torrents`}
                </span>
              </div>
              {files.length > 1 && (
                <ul className="max-h-24 list-inside list-disc overflow-y-auto text-xs text-surface-500">
                  {files.map((f) => (
                    <li key={f.name}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Field label="Destination folder">
            <Input value={dir} onChange={(e) => setDir(e.target.value)} />
          </Field>
          {freeSpace && freeSpace['size-bytes'] >= 0 && (
            <p className="text-xs text-surface-500">
              Free space: {formatBytes(freeSpace['size-bytes'])}
            </p>
          )}

          {/* Per-file selection + size slider, for a single .torrent */}
          {preview && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-xs text-surface-500">Skip files under</span>
                <input
                  type="range"
                  min={0}
                  max={STOPS.length - 1}
                  step={1}
                  value={nearestStopIndex(thresholdMB)}
                  onChange={(e) => applyThreshold(STOPS[Number(e.target.value)])}
                  aria-label="Skip files under (size)"
                  className="flex-1 accent-accent-500"
                />
                <span className="flex shrink-0 items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    value={thresholdMB}
                    onChange={(e) => applyThreshold(Math.max(0, Number(e.target.value) || 0))}
                    className="h-7 w-16 text-right text-xs"
                  />
                  <span className="text-xs text-surface-500">MB</span>
                </span>
              </div>
              {summary && (
                <p className="text-xs text-surface-500">
                  {thresholdMB === 0 ? 'Filter off — ' : ''}
                  {summary.selected} of {preview.files.length} files ·{' '}
                  {formatBytes(summary.selectedBytes)} selected
                  {summary.skipped > 0 ? ` · ${summary.skipped} skipped` : ''}
                </p>
              )}
              <div className="max-h-52 overflow-y-auto rounded border border-surface-200 dark:border-surface-700">
                {preview.files.map((f, i) => (
                  <div
                    key={f.path}
                    className="flex items-center gap-2 border-b border-surface-100 px-2 py-1.5 last:border-b-0 dark:border-surface-800"
                  >
                    <Checkbox
                      checked={!unwanted.has(i)}
                      onCheckedChange={(v) => toggleUnwanted(i, v)}
                      aria-label={`Download ${f.path}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs" title={f.path}>
                      {f.path}
                    </span>
                    <span className="shrink-0 text-[11px] text-surface-500">{formatBytes(f.length)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Field label="Labels (comma separated, optional)">
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="isos, linux" />
          </Field>

          <LabeledCheckbox checked={paused} onCheckedChange={setPaused} label="Add paused" />
          {can(caps, 'sequentialDownload') && (
            <LabeledCheckbox
              checked={sequential}
              onCheckedChange={setSequential}
              label="Download in sequential order"
            />
          )}
          <LabeledCheckbox
            checked={topOfQueue}
            onCheckedChange={setTopOfQueue}
            label="Add to top of queue"
          />
          {can(caps, 'skipHashCheck') && (
            <LabeledCheckbox checked={skipHash} onCheckedChange={setSkipHash} label="Skip hash check" />
          )}
          <LabeledCheckbox
            checked={rememberDir}
            onCheckedChange={setRememberDir}
            label="Remember this folder for this server"
          />

          {error && <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}
          {batchSummary && (
            <p className="text-xs text-surface-500 dark:text-surface-400">{batchSummary}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={adding || (isMagnetMode ? magnets.length === 0 : files.length === 0)}
            >
              {adding
                ? 'Adding…'
                : isMagnetMode && magnets.length > 1
                  ? `Add ${magnets.length} torrents`
                  : 'Add torrent'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
