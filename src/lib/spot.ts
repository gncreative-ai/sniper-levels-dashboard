import type { CalendarDay } from './calendar'
import { sessionOpenEpoch } from './time'
import { aggregateSession, type ChartBar, type Timeframe } from './timeframe'
import type { SpotCandle5m, SpotCandleDaily } from './types'

/**
 * The main spot chart's series, split the same way the leg charts already are.
 *
 * The previous session sits alongside the active one so the two can be read
 * together — the sniper levels are derived from the previous session, and
 * having to switch sessions to see what they came from defeated the purpose.
 *
 * Prev is always drawn in full and never subject to replay, exactly as on the
 * legs: what the market already did before the open is known before the open.
 */
export interface SpotSeries {
  prevBars: ChartBar[]
  todayBars: ChartBar[]
}

const EMPTY: SpotSeries = { prevBars: [], todayBars: [] }

/**
 * Assemble the spot series for a timeframe.
 *
 * Daily reads the official daily table rather than aggregating the intraday
 * feed — see the note in timeframe.ts for why that difference is deliberate
 * and what it costs.
 *
 * `prevSessionDate` is null when the session has no setup row (the first day in
 * the dataset, or one whose expiry has not passed). That is a real state, not
 * an error: the chart then shows the active session alone, as it always did.
 */
export function buildSpotSeries(
  timeframe: Timeframe,
  sessionDate: CalendarDay,
  prevSessionDate: CalendarDay | null,
  fiveMinuteByDate: Map<CalendarDay, SpotCandle5m[]>,
  daily: readonly SpotCandleDaily[],
): SpotSeries {
  if (timeframe === '5m') {
    return {
      prevBars: prevSessionDate ? (fiveMinuteByDate.get(prevSessionDate) ?? []) : [],
      todayBars: fiveMinuteByDate.get(sessionDate) ?? [],
    }
  }

  const dailyBar = (day: CalendarDay | null): ChartBar[] => {
    if (!day) return []

    const row = daily.find((candle) => candle.candleDate === day)
    if (!row) return []

    const at = sessionOpenEpoch(day)
    if (at === null) return []

    return [{ epochSeconds: at, open: row.open, high: row.high, low: row.low, close: row.close }]
  }

  return { prevBars: dailyBar(prevSessionDate), todayBars: dailyBar(sessionDate) }
}

export const EMPTY_SPOT_SERIES = EMPTY

/**
 * Collapse a run of intraday bars into that session's single daily candle.
 *
 * Exported for the legs, which have no daily table to read from — see
 * timeframe.ts. Kept here beside the spot equivalent so the two ways a daily
 * candle can come into existence sit next to each other.
 */
export function dailyFromIntraday(bars: readonly ChartBar[], day: CalendarDay): ChartBar[] {
  const candle = aggregateSession(bars, day)
  return candle ? [candle] : []
}
