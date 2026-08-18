import { useCallback, useEffect, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: Error }

/**
 * Runs an async task and exposes loading / ready / error as one discriminated
 * union, so a component cannot render a state it has not handled.
 *
 * Errors are surfaced verbatim, never swallowed or replaced with a generic
 * message — a wrong Supabase key and an RLS denial need to look different.
 */
export function useAsync<T>(task: () => Promise<T>, deps: unknown[]): {
  state: AsyncState<T>
  reload: () => void
} {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null })
  const [attempt, setAttempt] = useState(0)

  // The task identity changes every render; deps are the real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(task, deps)

  useEffect(() => {
    let cancelled = false

    setState({ status: 'loading', data: null, error: null })

    run()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setState({ status: 'error', data: null, error })
      })

    return () => {
      cancelled = true
    }
  }, [run, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, reload }
}
