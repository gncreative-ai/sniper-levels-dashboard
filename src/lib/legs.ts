import type {
  AtmBatch,
  DailySetup,
  LegRole,
  OptionCandle5m,
  StrikeRef,
} from './types'
import type { CalendarDay } from './calendar'
import { dailyFromIntraday } from './spot'
import type { ChartBar, Timeframe } from './timeframe'

/**
 * Assembling the four leg charts for a batch.
 *
 * The quadrant order is a fixed reading convention, not a layout preference —
 * see CLAUDE.md. It is defined once here and consumed by the grid so no
 * component can quietly rearrange it:
 *
 *     ATM PE  |  OTM CE
 *     --------+--------
 *     ATM CE  |  OTM PE
 *
 * On narrow screens the same order stacks vertically, which is why this is a
 * flat array rather than rows — one source of truth for both layouts.
 */
export const QUADRANT_ORDER: readonly LegRole[] = ['ATM_PE', 'OTM_CE', 'ATM_CE', 'OTM_PE'] as const

/** Per spec §4.4 only the ATM legs carry the sniper level. */
export function legHasSniperLevel(role: LegRole): boolean {
  return role === 'ATM_CE' || role === 'ATM_PE'
}

export interface LegSeries {
  role: LegRole
  ref: StrikeRef
  /**
   * Prior session's bars. Always shown in full — never subject to replay.
   *
   * ChartBar rather than OptionCandle5m because the daily timeframe replaces
   * the run of 5-minute bars with one aggregated candle, which has no
   * instrument key or candle date of its own.
   */
  prevBars: ChartBar[]
  /** Active session's bars. Phase 6 reveals these progressively. */
  todayBars: ChartBar[]
  /**
   * This contract's own prior-session close and high, per spec §4.4 — the close
   * of the last prev-day bar and the max high across them.
   *
   * Derived from bars already fetched rather than queried: there is no daily
   * OHLC table for options, and the spec is explicit that adding one back is
   * not the answer. Null when the contract has no prior-day bars at all.
   */
  prevClose: number | null
  prevHigh: number | null
  /** sniper_point for the batch, on the premium scale. ATM legs only; may be null. */
  sniperLevel: number | null
}

/**
 * Build the four leg series for one batch.
 *
 * Candles are indexed by instrument once and shared: a single instrument backs
 * more than one leg across batches, and re-filtering the full array per leg
 * would rescan it four times for no reason.
 */
export function buildLegSeries(
  batch: AtmBatch,
  refs: StrikeRef[],
  candles: OptionCandle5m[],
  setup: DailySetup | undefined,
  timeframe: Timeframe = '5m',
): LegSeries[] {
  if (!setup) return []

  const byInstrument = new Map<string, OptionCandle5m[]>()
  for (const candle of candles) {
    const existing = byInstrument.get(candle.instrumentKey)
    if (existing) existing.push(candle)
    else byInstrument.set(candle.instrumentKey, [candle])
  }

  const refsByRole = new Map<LegRole, StrikeRef>()
  for (const ref of refs) {
    if (ref.atmBatch === batch) refsByRole.set(ref.legRole, ref)
  }

  return QUADRANT_ORDER.flatMap((role) => {
    const ref = refsByRole.get(role)
    if (!ref) return []

    const bars = byInstrument.get(ref.instrumentKey) ?? []
    const series = splitByDay(bars, setup.sessionDate, setup.prevSessionDate)

    return [
      {
        role,
        ref,
        ...series,
        // Aggregated AFTER prevClose/prevHigh are derived, so those two carry
        // the same values in either timeframe rather than being recomputed
        // from a candle that has already lost its intraday detail.
        ...(timeframe === '1D'
          ? {
              prevBars: dailyFromIntraday(series.prevBars, setup.prevSessionDate),
              todayBars: dailyFromIntraday(series.todayBars, setup.sessionDate),
            }
          : {}),
        sniperLevel: legHasSniperLevel(role) ? setup.sniperPoint : null,
      },
    ]
  })
}

function splitByDay(
  bars: OptionCandle5m[],
  sessionDate: CalendarDay,
  prevSessionDate: CalendarDay,
): Pick<LegSeries, 'prevBars' | 'todayBars' | 'prevClose' | 'prevHigh'> {
  const prevBars: OptionCandle5m[] = []
  const todayBars: OptionCandle5m[] = []

  for (const bar of bars) {
    if (bar.candleDate === prevSessionDate) prevBars.push(bar)
    else if (bar.candleDate === sessionDate) todayBars.push(bar)
  }

  // The query orders by timestamp, but sorting here keeps this function correct
  // on its own rather than dependent on the caller's ordering.
  prevBars.sort((a, b) => a.epochSeconds - b.epochSeconds)
  todayBars.sort((a, b) => a.epochSeconds - b.epochSeconds)

  const last = prevBars[prevBars.length - 1]

  return {
    prevBars,
    todayBars,
    prevClose: last ? last.close : null,
    prevHigh: prevBars.length > 0 ? Math.max(...prevBars.map((bar) => bar.high)) : null,
  }
}

/** Every distinct instrument across all batches, for one candle fetch. */
export function distinctInstrumentKeys(refs: StrikeRef[]): string[] {
  return [...new Set(refs.map((ref) => ref.instrumentKey))]
}
