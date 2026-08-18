import { useMemo } from 'react'
import { SpotChart } from './SpotChart'
import { EmptyPanel, ErrorPanel, LoadingPanel } from './StatusPanels'
import type { AsyncState } from '../hooks/useAsync'
import type { CalendarDay } from '../lib/calendar'
import { formatCount, formatSessionDate } from '../lib/format'
import { barsUpTo } from '../lib/replay'
import { formatIstTime } from '../lib/time'
import { absentOverlays, resolveOverlays, type OverlayVisibility } from '../lib/overlays'
import type { DailySetup, SpotCandle5m } from '../lib/types'

/**
 * Renders the active session's spot chart from a fetch owned by the parent.
 *
 * The fetch lives one level up (in SessionOverlays) rather than here, because
 * phase 6 replay needs this same candle array to compute the reveal cutoff
 * shared with the four leg charts — see lib/replay.ts. Keeping two independent
 * fetches in sync would be the alternative, and worse.
 */
export function SpotChartPanel({
  sessionDate,
  candlesState,
  reload,
  cutoff,
  setup,
  visibility,
}: {
  sessionDate: CalendarDay
  candlesState: AsyncState<SpotCandle5m[]>
  reload: () => void
  cutoff: number
  setup: DailySetup | undefined
  visibility: OverlayVisibility
}) {
  const candles = candlesState.status === 'ready' ? candlesState.data : []
  const visibleCandles = useMemo(() => barsUpTo(candles, cutoff), [candles, cutoff])
  const first = candles[0]
  const last = candles[candles.length - 1]

  // Memoised so the chart's overlay effect only re-runs when the lines actually
  // change, rather than on every render of this panel.
  const overlays = useMemo(() => resolveOverlays(setup, visibility), [setup, visibility])
  const absent = useMemo(() => absentOverlays(setup, visibility), [setup, visibility])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-sm text-zinc-400">
          Nifty 50 spot · 5&#8209;min · {formatSessionDate(sessionDate)}
        </h2>
        {candlesState.status === 'ready' && candles.length > 0 && first && last && (
          <span className="font-mono text-xs text-zinc-600">
            {formatCount(candles.length)} bars · {formatIstTime(first.epochSeconds)}–
            {formatIstTime(last.epochSeconds)} IST
          </span>
        )}
      </div>

      {candlesState.status === 'loading' && <LoadingPanel label="Loading 5-minute spot candles…" />}

      {candlesState.status === 'error' && (
        <ErrorPanel title="Could not load spot candles" error={candlesState.error} onRetry={reload} />
      )}

      {candlesState.status === 'ready' &&
        (candles.length === 0 ? (
          <EmptyPanel message={`No 5-minute spot candles stored for ${formatSessionDate(sessionDate)}.`} />
        ) : (
          <div
            className={`h-[340px] rounded-md border border-zinc-800 bg-zinc-900/20 p-1 transition-opacity sm:h-[440px] ${
              candlesState.refreshing ? 'opacity-50' : 'opacity-100'
            }`}
          >
            <SpotChart candles={visibleCandles} overlays={overlays} />
          </div>
        ))}

      {/* Absent overlays are stated rather than silently missing: a toggle that
          is on but draws nothing would otherwise look like a broken switch. */}
      {absent.length > 0 && (
        <p className="font-mono text-[11px] text-zinc-500">
          Not drawn for this batch — {absent.map((overlay) => overlay.label).join(', ')}: no value
          in the source data. Shown as absent rather than zero.
        </p>
      )}

      {/* A short session is real data, not a gap — say so rather than letting a
          sparse chart read as broken. The Diwali Muhurat session has 12 bars. */}
      {candlesState.status === 'ready' && candles.length > 0 && candles.length < 60 && (
        <p className="font-mono text-[11px] text-zinc-500">
          Short session — {formatCount(candles.length)} bars instead of the usual ~75. This is real
          market data, not missing bars.
        </p>
      )}
    </section>
  )
}
