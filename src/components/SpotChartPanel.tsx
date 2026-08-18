import { useCallback } from 'react'
import { SpotChart } from './SpotChart'
import { EmptyPanel, ErrorPanel, LoadingPanel } from './StatusPanels'
import { useAsync } from '../hooks/useAsync'
import type { CalendarDay } from '../lib/calendar'
import { formatCount, formatSessionDate } from '../lib/format'
import { fetchSpotCandles5m } from '../lib/queries'
import { formatIstTime } from '../lib/time'

/**
 * Owns fetching the active session's spot bars and the states around them.
 *
 * Re-fetches whenever the active session changes (spec 4.3). The chart itself
 * stays a dumb renderer so phases 4 and 6 can layer overlays and replay onto it
 * without this component growing responsibilities.
 */
export function SpotChartPanel({ sessionDate }: { sessionDate: CalendarDay }) {
  const load = useCallback(() => fetchSpotCandles5m(sessionDate), [sessionDate])
  const { state, reload } = useAsync(load, [sessionDate], { keepPreviousData: true })

  const candles = state.status === 'ready' ? state.data : []
  const first = candles[0]
  const last = candles[candles.length - 1]

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-sm text-zinc-400">
          Nifty 50 spot · 5&#8209;min · {formatSessionDate(sessionDate)}
        </h2>
        {state.status === 'ready' && candles.length > 0 && first && last && (
          <span className="font-mono text-xs text-zinc-600">
            {formatCount(candles.length)} bars · {formatIstTime(first.epochSeconds)}–
            {formatIstTime(last.epochSeconds)} IST
          </span>
        )}
      </div>

      {state.status === 'loading' && <LoadingPanel label="Loading 5-minute spot candles…" />}

      {state.status === 'error' && (
        <ErrorPanel title="Could not load spot candles" error={state.error} onRetry={reload} />
      )}

      {state.status === 'ready' &&
        (candles.length === 0 ? (
          <EmptyPanel message={`No 5-minute spot candles stored for ${formatSessionDate(sessionDate)}.`} />
        ) : (
          <div
            className={`h-[340px] rounded-md border border-zinc-800 bg-zinc-900/20 p-1 transition-opacity sm:h-[440px] ${
              state.refreshing ? 'opacity-50' : 'opacity-100'
            }`}
          >
            <SpotChart candles={candles} />
          </div>
        ))}

      {/* A short session is real data, not a gap — say so rather than letting a
          sparse chart read as broken. The Diwali Muhurat session has 12 bars. */}
      {state.status === 'ready' && candles.length > 0 && candles.length < 60 && (
        <p className="font-mono text-[11px] text-zinc-500">
          Short session — {formatCount(candles.length)} bars instead of the usual ~75. This is real
          market data, not missing bars.
        </p>
      )}
    </section>
  )
}
