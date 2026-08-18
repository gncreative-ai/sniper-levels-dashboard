/**
 * Two shapes per table, deliberately:
 *
 *   *Row  — exactly what Supabase's REST API hands back. Numerics are strings.
 *   (domain) — what the rest of the app is allowed to see. Numerics are numbers.
 *
 * Keeping both makes the coercion boundary visible to the compiler: you cannot
 * accidentally chart a *Row, because its `close` is not a number.
 */

import type { CalendarDay } from './calendar'

/** Raw shape of a numeric/bigint column as PostgREST serialises it. */
export type RawNumeric = string | number
export type RawNumericNullable = string | number | null

/** sniper_bt_spot_candles_daily — one row per trading session. */
export interface SpotCandleDailyRow {
  candle_date: string
  open: RawNumeric
  high: RawNumeric
  low: RawNumeric
  close: RawNumeric
  volume: RawNumericNullable
}

export interface SpotCandleDaily {
  /**
   * The IST trading date as 'YYYY-MM-DD'.
   *
   * Kept as a string on purpose. This is a Postgres `date`, not a timestamptz —
   * it has no time and no zone. Passing it through `new Date()` would parse it
   * as UTC midnight and render as the *previous day* for any viewer west of
   * UTC. Treat it as an opaque calendar-day key; format it as a string.
   */
  candleDate: string
  open: number
  high: number
  low: number
  close: number
  /** Usually null or 0 for an index — absence is expected here, not an error. */
  volume: number | null
}

/** The full extent of what the scrubber can browse, for seeding the range picker. */
export interface SessionBounds {
  /** Oldest session in sniper_bt_spot_candles_daily. */
  first: CalendarDay
  /** Newest session in sniper_bt_spot_candles_daily. */
  last: CalendarDay
  /** Total rows in the daily table — not all of these have a setup row. */
  total: number
}

/**
 * One session as the scrubber needs it: the daily bar, plus whether the
 * strategy setup was computed for that day.
 *
 * `hasSetup` is false for two legitimate reasons, neither of which is an error:
 * the very first session in the dataset (there is no prior day to derive a
 * setup from), and sessions whose weekly expiry has not yet passed. Marking
 * them here keeps a later empty overlay from reading as a bug.
 */
export interface SessionSummary extends SpotCandleDaily {
  hasSetup: boolean
}

/** sniper_bt_spot_candles_5m — Nifty spot intraday, one row per 5-minute bar. */
export interface SpotCandle5mRow {
  candle_timestamp: string
  open: RawNumeric
  high: RawNumeric
  low: RawNumeric
  close: RawNumeric
  volume: RawNumericNullable
}

export interface SpotCandle5m {
  /**
   * The bar's real instant, as epoch seconds UTC.
   *
   * Deliberately not a chart time — see `lib/time.ts`. The shift into the
   * charting library's fake-UTC space happens at the chart boundary, so
   * everything upstream keeps working with genuine instants.
   */
  epochSeconds: number
  open: number
  high: number
  low: number
  close: number
  /** Usually 0 or null for an index. */
  volume: number | null
}
