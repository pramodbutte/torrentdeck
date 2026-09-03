import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { TorrentDetail } from '@shared/transmission'
import { useAppDispatch } from '@/app/hooks'
import { openRename } from '@/features/ui/uiSlice'
import {
  useSetTorrentMutation,
  useSetLocationMutation,
  useTorrentActionMutation
} from '@/services/rpcApi'
import { can, useServerCapabilities } from '@/features/connection/useCapabilities'
import { statusText } from '@/features/torrents/derive'
import { formatBytes, formatDate, formatEta, formatPercent, formatRatio } from '@/lib/format'
import { Input, Field } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PiecesMap } from './PiecesMap'
import { TorrentLimits } from './TorrentLimits'

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-surface-500 dark:text-surface-400">{label}</span>
      <span className="truncate text-right" title={value}>
        {value}
      </span>
    </div>
  )
}

export function GeneralTab({
  torrent,
  profileId
}: {
  torrent: TorrentDetail
  profileId: string
}): React.JSX.Element {
  const dispatch = useAppDispatch()
  const [setTorrent] = useSetTorrentMutation()
  const [setLocation] = useSetLocationMutation()
  const [torrentAction] = useTorrentActionMutation()
  const caps = useServerCapabilities(profileId)
  const [labelsDraft, setLabelsDraft] = useState(torrent.labels.join(', '))
  const [locationDraft, setLocationDraft] = useState(torrent.downloadDir)

  useEffect(() => setLabelsDraft(torrent.labels.join(', ')), [torrent.id, torrent.labels])
  useEffect(() => setLocationDraft(torrent.downloadDir), [torrent.id, torrent.downloadDir])

  const saveLabels = (): void => {
    const labels = labelsDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    void setTorrent({ profileId, ids: [torrent.id], fields: { labels } })
  }

  const locationChanged = Boolean(locationDraft) && locationDraft !== torrent.downloadDir

  const moveData = (): void => {
    if (locationChanged) {
      void setLocation({ profileId, ids: [torrent.id], location: locationDraft, move: true })
    }
  }

  /**
   * "Find data": the files already live at the new path, so re-point the
   * torrent there without moving anything, then re-check them. This is the
   * fix for Transmission's "No data found" error (drive unmounted, folder
   * moved); verify alone is a no-op there on 4.0.x because the daemon skips
   * the check while it sees no files. A failure in either step surfaces
   * through the action-error notice.
   */
  const findData = async (): Promise<void> => {
    if (!locationChanged) return
    const res = await setLocation({
      profileId,
      ids: [torrent.id],
      location: locationDraft,
      move: false
    })
    if ('error' in res) return
    void torrentAction({ profileId, action: 'torrent-verify', ids: [torrent.id] })
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="flex items-start gap-1.5 text-sm font-medium break-all">
          <span className="torrent-name min-w-0">{torrent.name}</span>
          <button
            type="button"
            aria-label="Rename torrent"
            title="Rename torrent (renames the root file/folder on the server)"
            onClick={() =>
              dispatch(
                openRename({
                  profileId,
                  id: torrent.id,
                  path: torrent.name,
                  currentName: torrent.name
                })
              )
            }
            className="mt-0.5 shrink-0 rounded p-0.5 text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200"
          >
            <Pencil size={12} />
          </button>
        </p>
        {torrent.error !== 0 && (
          <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">{torrent.errorString}</p>
        )}
      </div>

      <div className="divide-y divide-surface-100 dark:divide-surface-800">
        <Row label="Status" value={statusText(torrent)} />
        <Row label="Progress" value={formatPercent(torrent.percentDone)} />
        <Row label="Size" value={formatBytes(torrent.totalSize)} />
        <Row label="Downloaded" value={formatBytes(torrent.downloadedEver)} />
        <Row label="Uploaded" value={formatBytes(torrent.uploadedEver)} />
        <Row label="Ratio" value={formatRatio(torrent.uploadRatio)} />
        <Row label="ETA" value={formatEta(torrent.eta)} />
        <Row
          label="Peers"
          value={`${torrent.peersConnected} connected (${torrent.peersSendingToUs} down, ${torrent.peersGettingFromUs} up)`}
        />
        <Row label="Pieces" value={`${torrent.pieceCount} × ${formatBytes(torrent.pieceSize)}`} />
        <Row label="Privacy" value={torrent.isPrivate ? 'Private torrent' : 'Public torrent'} />
        <Row label="Added" value={formatDate(torrent.addedDate)} />
        <Row label="Completed" value={formatDate(torrent.doneDate)} />
        <Row label="Last active" value={formatDate(torrent.activityDate)} />
        <Row label="Creator" value={torrent.creator || '—'} />
        <Row label="Comment" value={torrent.comment || '—'} />
        <Row label="Hash" value={torrent.hashString} />
      </div>

      <PiecesMap pieces={torrent.pieces} pieceCount={torrent.pieceCount} availability={torrent.availability} mode="strip" />

      <TorrentLimits torrent={torrent} profileId={profileId} />

      <Field label="Location">
        <div className="flex gap-1.5">
          <Input value={locationDraft} onChange={(e) => setLocationDraft(e.target.value)} />
          <Button
            variant="secondary"
            size="sm"
            disabled={!locationChanged}
            onClick={moveData}
            title="Move the downloaded files to this folder"
          >
            Move
          </Button>
          {can(caps, 'findData') && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!locationChanged}
              onClick={() => void findData()}
              title="The files are already in this folder: point the torrent there and verify them (nothing is moved)"
            >
              Find data
            </Button>
          )}
        </div>
        {torrent.error !== 0 && can(caps, 'findData') && (
          <span className="block text-[11px] text-surface-500 dark:text-surface-400">
            Files elsewhere? Enter their folder and use <b>Find data</b>, then start the torrent.
          </span>
        )}
      </Field>

      <Field label="Labels (comma separated)">
        <div className="flex gap-1.5">
          <Input
            value={labelsDraft}
            onChange={(e) => setLabelsDraft(e.target.value)}
            placeholder="isos, linux"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={labelsDraft === torrent.labels.join(', ')}
            onClick={saveLabels}
          >
            Save
          </Button>
        </div>
      </Field>
    </div>
  )
}
