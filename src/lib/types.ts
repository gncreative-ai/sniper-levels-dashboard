/**
 * Two shapes per table, deliberately:
 *
 *   *Row  — exactly what Supabase's REST API hands back. Numerics are strings.
 *   (domain) — what the rest of the app is allowed to see. Numerics are numbers.
 *
 * Keeping both makes the coercion boundary visible to the compiler: you cannot
 * accidentally chart a *Row, because its `close` is not a number.
 */

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
