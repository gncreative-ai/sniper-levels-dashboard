import { useCallback, useMemo } from 'react'
import { LegQuadrant } from './LegQuadrant'
import { EmptyPanel, ErrorPanel, LoadingPanel } from './StatusPanels'
import { useAsync } from '../hooks/useAsync'
import { buildLegSeries, distinctInstrumentKeys } from '../lib/legs'
import { fetchOptionCandles5m, fetchStrikeRefs } from '../lib/queries'
import { formatSessionDate } from '../lib/format'
import type { AtmBatch, DailySetup } from '../lib/types'

/**
 * Fetches the session's leg contracts and their premium bars, then hands the
 * assembled series to the quadrant grid.
 *
 * One fetch covers every batch. A session's 12 leg rows resolve to exactly 8
 * distinct instruments — one batch's OTM leg is a neighbouring batch's ATM leg —
 * so loading all of them costs little more than loading four, and makes the
 * batch toggle instant instead of a round trip.
 */
export function LegQuadrantPanel({
  setup,
  batch,
}: {
  setup: DailySetup | undefined
  batch: AtmBatch
}) {
  const sessionDate = setup?.sessionDate
  const prevSessionDate = setup?.prevSessionDate

  const load = useCallback(async () => {
    if (!sessionDate || !prevSessionDate) return { refs: [], candles: [] }

    const refs = await fetchStrikeRefs(sessionDate)
    const candles = await fetchOptionCandles5m(distinctInstrumentKeys(refs), [
      prevSessionDate,
      sessionDate,
    ])

    return { refs, candles }
  }, [sessionDate, prevSessionDate])

  const { state, reload } = useAsync(load, [sessionDate, prevSessionDate], {
    keepPreviousData: true,
  })

  const legs = useMemo(() => {
    if (state.status !== 'ready') return []
    return buildLegSeries(batch, state.data.refs, state.data.candles, setup)
  }, [state, batch, setup])

  if (!setup) {
    return (
      <EmptyPanel message="No setup row for this session, so its leg contracts are not defined." />
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-sm text-zinc-400">
          Option legs · {batch} batch · prev {formatSessionDate(setup.prevSessionDate)} →{' '}
          {formatSessionDate(setup.sessionDate)}
        </h2>
        <span className="font-mono text-xs text-zinc-600">
          shaded = previous session · expiry {setup.weeklyExpiry}
        </span>
      </div>

      {state.status === 'loading' && <LoadingPanel label="Loading leg contracts and premiums…" />}

      {state.status === 'error' && (
        <ErrorPanel title="Could not load option legs" error={state.error} onRetry={reload} />
      )}

      {state.status === 'ready' && (
        <div className={state.refreshing ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          <LegQuadrant legs={legs} />
        </div>
      )}
    </section>
  )
}
