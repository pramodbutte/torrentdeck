/**
 * Error-only feedback for fire-and-forget mutations. Success needs no notice —
 * the list refetches and the row changes — but a REJECTED action used to vanish
 * silently (every `void torrentAction(...)` call site drops its result). This
 * listener turns such rejections into one non-modal notice (ActionErrorNotice)
 * via `ui.actionError`.
 *
 * Scope is deliberately narrow: only endpoints whose callers show nothing
 * themselves. Add, rename, port test, and blocklist update already render
 * their failure inline in their dialogs and are not matched here.
 */
import { createListenerMiddleware } from '@reduxjs/toolkit'
import type { RpcError, ServerProfile } from '@shared/types'
import { rpcApi } from '@/services/rpcApi'
import { actionFailed } from './uiSlice'

const ACTION_LABELS: Record<string, string> = {
  'torrent-start': 'Start',
  'torrent-start-now': 'Start now',
  'torrent-stop': 'Pause',
  'torrent-verify': 'Verify local data',
  'torrent-reannounce': 'Reannounce'
}

/** Human label for the thing that failed, from the endpoint and its args. */
export function actionLabel(endpoint: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  switch (endpoint) {
    case 'torrentAction':
      return ACTION_LABELS[String(a.action)] ?? 'Torrent action'
    case 'queueMove':
      return 'Queue move'
    case 'removeTorrent':
      return 'Remove'
    case 'setTorrent':
      return 'Torrent update'
    case 'setLocation':
      return a.move === false ? 'Find data' : 'Move data'
    case 'setSession':
      return 'Server settings'
    case 'setGroup':
      return 'Bandwidth group'
    default:
      return 'Action'
  }
}

/** One-line notice text: "<Action> failed on <server>: <daemon/transport message>". */
export function describeActionError(
  endpoint: string,
  args: unknown,
  error: Partial<RpcError> | undefined,
  serverName: string | undefined
): string {
  const where = serverName ? ` on ${serverName}` : ''
  const why = error?.message?.trim() || 'unknown error'
  return `${actionLabel(endpoint, args)} failed${where}: ${why}`
}

const { endpoints: e } = rpcApi

/** The mutations in scope — everything whose callers otherwise drop the result. */
const REJECTED = [
  e.torrentAction.matchRejected,
  e.queueMove.matchRejected,
  e.removeTorrent.matchRejected,
  e.setTorrent.matchRejected,
  e.setLocation.matchRejected,
  e.setSession.matchRejected,
  e.setGroup.matchRejected
] as const

type Guarded<F> = F extends (action: unknown) => action is infer T ? T : never
type RejectedMutation = Guarded<(typeof REJECTED)[number]>

export const actionErrorMiddleware = createListenerMiddleware()
actionErrorMiddleware.startListening({
  matcher: (action): action is RejectedMutation => REJECTED.some((m) => m(action)),
  effect: (action, api) => {
    // `condition: true` marks a run that was skipped, not one that failed.
    if (action.meta.condition) return
    const { endpointName, originalArgs } = action.meta.arg
    const state = api.getState() as { connection: { profiles: ServerProfile[] } }
    const profileId = (originalArgs as { profileId?: string }).profileId
    const serverName = state.connection.profiles.find((p) => p.id === profileId)?.name
    // The IPC baseQuery returns errors as values (→ payload); a thrown error
    // would land in `action.error` instead.
    const error: Partial<RpcError> = (action.payload as Partial<RpcError> | undefined) ?? {
      message: action.error?.message
    }
    api.dispatch(
      actionFailed({
        message: describeActionError(endpointName, originalArgs, error, serverName),
        at: Date.now()
      })
    )
  }
})
