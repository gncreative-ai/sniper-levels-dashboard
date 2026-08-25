import type { CalendarDay } from './calendar'
import { sessionOpenEpoch } from './time'

/**
 * Chart timeframe: the 5-minute intraday feed, or one candle per session.
 *
 * Both timeframes show the same two sessions — the previous one and the active
 * one — so switching is a change of resolution, not of range. Daily therefore
 * has exactly two candles per chart, which is the point: it is for seeing where
 * the session sat against the day before, not for scanning history.
 *
 * Where the daily candle comes from differs between spot and the legs, and that
 * asymmetry is forced by the data rather than chosen:
 *
 * - Spot has a real daily table, and its close is the *official* one. The
 *   pipeline's `prev_close` — which the sniper bands are derived from — matches
 *   that daily close in 699/699 rows, so using it puts the Prev Close overlay
 *   exactly on the previous daily candle. The cost is that spot's daily close
 *   does not equal its own last 5-minute bar: the intraday feed stops at 15:25
 *   IST while the official close is the end-of-session value. That difference
 *   is documented in the README and is real data, not a rounding error.
 * - Options have no daily table — the spec dropped it as redundant and says so
 *   explicitly — so a leg's daily candle is aggregated from the 5-minute bars
 *   already fetched for it.
 */

export type Timeframe = '5m' | '1D'

export const TIMEFRAMES: readonly Timeframe[] = ['5m', '1D']

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '5m': '5m',
  '1D': '1D',
}

/**
 * The only shape a chart actually needs from a bar.
 *
 * Spot 5-minute, option 5-minute and aggregated daily candles all satisfy it,
 * which is what lets one chart component draw any of them.
 */
export interface ChartBar {
  epochSeconds: number
  open: number
  high: number
  low: number
  close: number
}

/**
 * Collapse one session's bars into a single OHLC candle.
 *
 * Open is the first bar's open and close the last bar's close, so the candle
 * spans exactly the bars given — callers pass one day's worth. The timestamp is
 * the session open rather than the first bar's own time, so every chart puts
 * that day at the same x position (see sessionOpenEpoch).
 *
 * Null for an empty input: a day with no bars has no candle, and inventing a
 * flat one would be fabricating a price.
 */
export function aggregateSession(
  bars: readonly ChartBar[],
  day: CalendarDay,
): ChartBar | null {
  if (bars.length === 0) return null

  const at = sessionOpenEpoch(day)
  if (at === null) return null

  const first = bars[0]!
  const last = bars[bars.length - 1]!

  let high = first.high
  let low = first.low
  for (const bar of bars) {
    if (bar.high > high) high = bar.high
    if (bar.low < low) low = bar.low
  }

  return { epochSeconds: at, open: first.open, high, low, close: last.close }
}

const STORAGE_KEY = 'sniper-timeframe'

/** Restores the last timeframe. Storage throws outright in some privacy modes. */
export function initialTimeframe(): Timeframe {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === '5m' || stored === '1D') return stored
  } catch {
    // Fall through to the default.
  }

  return '5m'
}

export function persistTimeframe(timeframe: Timeframe): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, timeframe)
  } catch {
    // A preference that cannot be saved is not worth surfacing.
  }
}
