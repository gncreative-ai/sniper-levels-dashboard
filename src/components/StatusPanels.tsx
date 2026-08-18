import { QueryError } from '../lib/queries'

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-8">
      <span
        className="size-3 animate-pulse rounded-full bg-amber-400"
        aria-hidden="true"
      />
      <span className="font-mono text-sm text-zinc-400">{label}</span>
    </div>
  )
}

/**
 * Renders the real error text. Never a friendly substitute — a wrong key, a
 * missing table and an RLS denial all need to be distinguishable at a glance.
 */
export function ErrorPanel({
  title,
  error,
  onRetry,
}: {
  title: string
  error: Error
  onRetry?: () => void
}) {
  return (
    <div className="rounded-md border border-red-900/70 bg-red-950/30 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-300">{title}</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-red-200/90">
            {error.message}
          </pre>
          {error instanceof QueryError && error.hint && (
            <p className="mt-2 font-mono text-xs text-red-200/70">hint: {error.hint}</p>
          )}
          {error instanceof QueryError && error.detail && (
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-xs text-red-300/60 hover:text-red-300">
                details
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-red-200/60">
                {error.detail}
              </pre>
            </details>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded border border-red-800 px-3 py-1 font-mono text-xs text-red-200 transition hover:bg-red-900/40"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Shown when a query succeeds but returns nothing. Says so plainly — this app
 * never fabricates rows to fill a gap.
 */
export function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/30 px-4 py-10 text-center">
      <p className="font-mono text-sm text-zinc-400">{message}</p>
      <p className="mt-1 font-mono text-xs text-zinc-600">
        No placeholder data is substituted.
      </p>
    </div>
  )
}
