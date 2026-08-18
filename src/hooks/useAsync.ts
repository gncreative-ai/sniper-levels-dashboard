import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null; refreshing: false }
  /** `refreshing` is true when a newer request is in flight over stale-but-shown data. */
  | { status: 'ready'; data: T; error: null; refreshing: boolean }
  | { status: 'error'; data: null; error: Error; refreshing: false }

export interface UseAsyncOptions {
  /**
   * Keep rendering the previous result while the next one loads, instead of
   * dropping back to a loading state. Stops the scrubber from blanking out on
   * every date-range tweak.
   */
  keepPreviousData?: boolean
}

/**
 * Runs an async task and exposes loading / ready / error as one discriminated
 * union, so a component cannot render a state it has not handled.
 *
 * Errors are surfaced verbatim, never swallowed or replaced with a generic
 * message — a wrong Supabase key and an RLS denial need to look different.
 */
export function useAsync<T>(
  task: () => Promise<T>,
  deps: unknown[],
  options: UseAsyncOptions = {},
): { state: AsyncState<T>; reload: () => void } {
  const { keepPreviousData = false } = options

  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
    refreshing: false,
  })
  const [attempt, setAttempt] = useState(0)

  // Read through a ref so toggling the option never re-runs the task itself.
  const keepPrevious = useRef(keepPreviousData)
  keepPrevious.current = keepPreviousData

  // The task identity changes every render; deps are the real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(task, deps)

  useEffect(() => {
    let cancelled = false

    setState((previous) =>
      keepPrevious.current && previous.status === 'ready'
        ? { ...previous, refreshing: true }
        : { status: 'loading', data: null, error: null, refreshing: false },
    )

    run()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null, refreshing: false })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setState({ status: 'error', data: null, error, refreshing: false })
      })

    return () => {
      cancelled = true
    }
  }, [run, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, reload }
}
