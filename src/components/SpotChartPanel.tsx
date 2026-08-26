import { useMemo } from 'react'
import { SpotChart } from './SpotChart'
import { EmptyPanel, ErrorPanel, LoadingPanel } from './StatusPanels'
import type { CalendarDay } from '../lib/calendar'
import { formatCount, formatSessionDate } from '../lib/format'
import { barsUpTo } from '../lib/replay'
import { formatIstTime } from '../lib/time'
import { absentOverlays, resolveOverlays, type OverlayVisibility } from '../lib/overlays'
import type { DailySetup } from '../lib/types'
import type { SpotSeries } from '../lib/spot'
import { TIMEFRAME_LABELS, type Timeframe } from '../lib/timeframe'

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
  prevSessionDate,
  series,
  loading,
  error,
  refreshing,
  reload,
  cutoff,
  setup,
  visibility,
  timeframe,
}: {
  sessionDate: CalendarDay
  prevSessionDate: CalendarDay | null
  series: SpotSeries
  loading: boolean
  error: Error | null
  refreshing: boolean
  reload: () => void
  cutoff: number
  setup: DailySetup | undefined
  visibility: OverlayVisibility
  timeframe: Timeframe
}) {
  // Prev is never replayed — it is what the market already did before the open,
  // and the sniper levels on this chart are derived from it.
  const visibleToday = useMemo(() => barsUpTo(series.todayBars, cutoff), [series.todayBars, cutoff])
  const candles = useMemo(
    () => [...series.prevBars, ...visibleToday],
    [series.prevBars, visibleToday],
  )

  const today = series.todayBars
  const first = today[0]
  const last = today[today.length - 1]

  // Memoised so the chart's overlay effect only re-runs when the lines actually
  // change, rather than on every render of this panel.
  const overlays = useMemo(() => resolveOverlays(setup, visibility), [setup, visibility])
  const absent = useMemo(() => absentOverlays(setup, visibility), [setup, visibility])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-sm text-zinc-400">
          Nifty 50 spot · {TIMEFRAME_LABELS[timeframe]} ·{' '}
          {prevSessionDate ? `${formatSessionDate(prevSessionDate)} → ` : ''}
          {formatSessionDate(sessionDate)}
        </h2>
        {!loading && !error && today.length > 0 && first && last && (
          <span className="font-mono text-xs text-zinc-600">
            {formatCount(series.prevBars.length)} prev · {formatCount(today.length)} today
            {timeframe === '5m' && (
              <>
                {' '}
                · {formatIstTime(first.epochSeconds)}–{formatIstTime(last.epochSeconds)} IST
              </>
            )}
          </span>
        )}
      </div>

      {loading && <LoadingPanel label="Loading spot candles…" />}

      {error && <ErrorPanel title="Could not load spot candles" error={error} onRetry={reload} />}

      {!loading &&
        !error &&
        (candles.length === 0 ? (
          <EmptyPanel message={`No spot candles stored for ${formatSessionDate(sessionDate)}.`} />
        ) : (
          <div
            className={`h-[340px] rounded-md border border-zinc-800 bg-zinc-900/20 p-1 transition-opacity sm:h-[440px] ${
              refreshing ? 'opacity-50' : 'opacity-100'
            }`}
          >
            <SpotChart
              candles={candles}
              firstTodayEpoch={today[0]?.epochSeconds ?? null}
              overlays={overlays}
              sessionDate={sessionDate}
            />
          </div>
        ))}

      {/* Absent overlays are stated rather than silently missing: a toggle that
          is on but draws nothing would otherwise look like a broken switch. */}
      {absent.length > 0 && (
        <p className="font-mono text-[12px] text-zinc-500">
          Not drawn for this batch — {absent.map((overlay) => overlay.label).join(', ')}: no value
          in the source data. Shown as absent rather than zero.
        </p>
      )}

      {/* A short session is real data, not a gap — say so rather than letting a
          sparse chart read as broken. The Diwali Muhurat session has 12 bars. */}
      {!loading && !error && timeframe === '5m' && today.length > 0 && today.length < 60 && (
        <p className="font-mono text-[12px] text-zinc-500">
          Short session — {formatCount(today.length)} bars instead of the usual ~75. This is real
          market data, not missing bars.
        </p>
      )}
    </section>
  )
}
