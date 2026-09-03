import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { dismissActionError } from '@/features/ui/uiSlice'

const AUTO_DISMISS_MS = 10_000

/**
 * Non-modal notice for a failed action (fed by features/ui/actionErrors.ts).
 * Sits above the status bar, is replaced when a newer failure arrives, and
 * clears on its own or on ✕. Nothing is ever shown for a success — the row
 * updating on the next poll is the acknowledgement.
 */
export function ActionErrorNotice(): React.JSX.Element | null {
  const dispatch = useAppDispatch()
  const error = useAppSelector((s) => s.ui.actionError)

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => dispatch(dismissActionError()), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [error, dispatch])

  if (!error) return null
  return (
    <div
      role="alert"
      className="fixed right-3 bottom-9 z-40 flex max-w-sm items-start gap-2 rounded-md border border-danger-300 bg-danger-50 px-3 py-2 text-xs text-danger-800 shadow-lg dark:border-danger-800 dark:bg-danger-950 dark:text-danger-200"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{error.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dispatch(dismissActionError())}
        className="-mr-1 shrink-0 rounded p-0.5 hover:bg-danger-100 dark:hover:bg-danger-900"
      >
        <X size={12} />
      </button>
    </div>
  )
}
