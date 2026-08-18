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

/**
 * The three ATM batches computed for every session (spec §3).
 *
 * Each is the prior close rounded to the nearest 100, then offset: 'nearest' is
 * the rounded strike itself, 'before' is −100, 'after' is +100. Each carries its
 * own legs and its own sniper point, computed independently.
 */
export const ATM_BATCHES = ['nearest', 'before', 'after'] as const
export type AtmBatch = (typeof ATM_BATCHES)[number]

export const ATM_BATCH_LABELS: Record<AtmBatch, string> = {
  nearest: 'Nearest',
  before: 'Before',
  after: 'After',
}

export function isAtmBatch(value: string): value is AtmBatch {
  return (ATM_BATCHES as readonly string[]).includes(value)
}

/** sniper_bt_daily_setup — three rows per session, one per ATM batch. */
export interface DailySetupRow {
  session_date: string
  atm_batch: string
  prev_session_date: string
  prev_close: RawNumeric
  prev_high: RawNumeric
  prev_low: RawNumeric
  atm_center: RawNumeric
  otm_ce_strike: RawNumeric
  otm_pe_strike: RawNumeric
  otm_ce_settle: RawNumericNullable
  otm_pe_settle: RawNumericNullable
  sniper_point: RawNumericNullable
  spot_sniper_upper: RawNumericNullable
  spot_sniper_lower: RawNumericNullable
  weekly_expiry: string
}

/**
 * One batch's frozen evening calculation for a session.
 *
 * The nullable fields cascade together and their absence is real data, not a
 * gap to paper over: when an OTM leg had no trades in the lookback window its
 * settle is null, which makes sniper_point null, which makes both spot bands
 * null. Those overlays must then be drawn as absent — never as zero.
 */
export interface DailySetup {
  sessionDate: CalendarDay
  atmBatch: AtmBatch
  prevSessionDate: CalendarDay
  prevClose: number
  prevHigh: number
  prevLow: number
  atmCenter: number
  otmCeStrike: number
  otmPeStrike: number
  otmCeSettle: number | null
  otmPeSettle: number | null
  sniperPoint: number | null
  spotSniperUpper: number | null
  spotSniperLower: number | null
  weeklyExpiry: CalendarDay
}

/** All three batches for one session, keyed by batch. A batch may be missing. */
export type SessionSetup = Partial<Record<AtmBatch, DailySetup>>

/** The four legs tracked per ATM batch. */
export const LEG_ROLES = ['ATM_CE', 'ATM_PE', 'OTM_CE', 'OTM_PE'] as const
export type LegRole = (typeof LEG_ROLES)[number]

export const LEG_ROLE_LABELS: Record<LegRole, string> = {
  ATM_CE: 'ATM CE',
  ATM_PE: 'ATM PE',
  OTM_CE: 'OTM CE',
  OTM_PE: 'OTM PE',
}

export function isLegRole(value: string): value is LegRole {
  return (LEG_ROLES as readonly string[]).includes(value)
}

/** sniper_bt_strike_refs — 12 rows per session (3 batches x 4 legs). */
export interface StrikeRefRow {
  session_date: string
  atm_batch: string
  leg_role: string
  strike: RawNumeric
  option_type: string
  expiry: string
  instrument_key: string
}

/**
 * One leg's contract for a session and batch.
 *
 * The same instrument_key legitimately appears under several (batch, leg_role)
 * pairs — one batch's OTM leg is a neighbouring batch's ATM leg. Every session
 * has 12 leg rows covering exactly 8 distinct instruments. That is the dedup
 * design working, not duplicate data.
 */
export interface StrikeRef {
  sessionDate: CalendarDay
  atmBatch: AtmBatch
  legRole: LegRole
  strike: number
  optionType: string
  expiry: CalendarDay
  instrumentKey: string
}

/** sniper_bt_option_candles_5m — keyed by instrument, not by session or leg. */
export interface OptionCandle5mRow {
  instrument_key: string
  candle_date: string
  candle_timestamp: string
  open: RawNumeric
  high: RawNumeric
  low: RawNumeric
  close: RawNumeric
  volume: RawNumericNullable
}

export interface OptionCandle5m {
  instrumentKey: string
  /** Which trading day this bar belongs to — used to split prev from today. */
  candleDate: CalendarDay
  epochSeconds: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}
