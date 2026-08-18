import type { PostgrestError } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'
import { toNum, toNumOrNull } from './num'
import type {
  AtmBatch,
  OptionCandle5m,
  OptionCandle5mRow,
  StrikeRef,
  StrikeRefRow,
  DailySetup,
  DailySetupRow,
  SessionSetup,
  SessionBounds,
  SessionSummary,
  SpotCandle5m,
  SpotCandle5mRow,
  SpotCandleDaily,
  SpotCandleDailyRow,
} from './types'
import type { CalendarDay } from './calendar'
import { isAtmBatch, isLegRole } from './types'
import { toEpochSeconds } from './time'

/**
 * The data-access layer. Every Supabase read in this app lives here.
 *
 * Two invariants:
 *   1. READ ONLY. Only .select() is ever called. No insert/update/delete/upsert.
 *   2. Nothing leaves this module un-coerced — callers receive domain objects
 *      with real numbers, never raw PostgREST strings.
 */

export const TABLES = {
  spotCandlesDaily: 'sniper_bt_spot_candles_daily',
  dailySetup: 'sniper_bt_daily_setup',
  spotCandles5m: 'sniper_bt_spot_candles_5m',
  strikeRefs: 'sniper_bt_strike_refs',
  optionCandles5m: 'sniper_bt_option_candles_5m',
} as const

/**
 * PostgREST caps how many rows one response may contain, so any query that can
 * exceed the cap must page explicitly or it is silently truncated. 231 of the
 * 233 sessions return more than 1000 option-candle rows, so this is not a
 * theoretical concern — see fetchOptionCandles5m.
 */
const PAGE_SIZE = 1000

/** Refuses to spin forever if the server ever stops honouring range requests. */
const MAX_PAGES = 20

/**
 * A Supabase read that failed, with Postgres' own details preserved.
 *
 * Nothing is swallowed or replaced with a friendly message: a wrong key, a
 * missing table and an RLS denial must stay distinguishable. The secondary
 * fields are kept separate from `message` so the UI can present them without
 * burying the one line that usually identifies the problem.
 */
export class QueryError extends Error {
  readonly code: string | null
  readonly detail: string | null
  readonly hint: string | null

  constructor(context: string, error: PostgrestError) {
    const code = error.code?.trim() || null
    super(`${context}${code ? ` [${code}]` : ''}: ${error.message || 'unknown Supabase error'}`)

    this.name = 'QueryError'
    this.code = code
    this.detail = error.details?.trim() || null
    this.hint = error.hint?.trim() || null
  }
}

function queryError(context: string, error: PostgrestError): QueryError {
  return new QueryError(context, error)
}

/** Exact row count of the daily spot table. Proves the connection and RLS read policy. */
export async function fetchDailyCandleCount(): Promise<number> {
  const { count, error } = await requireSupabase()
    .from(TABLES.spotCandlesDaily)
    .select('candle_date', { count: 'exact', head: true })

  if (error) throw queryError(`Counting ${TABLES.spotCandlesDaily}`, error)

  return count ?? 0
}

function toSpotCandleDaily(row: SpotCandleDailyRow): SpotCandleDaily {
  return {
    candleDate: row.candle_date,
    open: toNum(row.open, 'open'),
    high: toNum(row.high, 'high'),
    low: toNum(row.low, 'low'),
    close: toNum(row.close, 'close'),
    volume: toNumOrNull(row.volume, 'volume'),
  }
}


/**
 * The oldest and newest sessions available, for seeding the date range picker.
 *
 * Deliberately three tiny requests rather than pulling every date: per spec 5.2
 * the scrubber loads only the selected window, and this keeps that true even as
 * the table grows.
 */
export async function fetchSessionBounds(): Promise<SessionBounds | null> {
  const client = requireSupabase()

  const [oldest, newest, total] = await Promise.all([
    client
      .from(TABLES.spotCandlesDaily)
      .select('candle_date')
      .order('candle_date', { ascending: true })
      .limit(1),
    client
      .from(TABLES.spotCandlesDaily)
      .select('candle_date')
      .order('candle_date', { ascending: false })
      .limit(1),
    fetchDailyCandleCount(),
  ])

  if (oldest.error) throw queryError(`Reading the oldest session`, oldest.error)
  if (newest.error) throw queryError(`Reading the newest session`, newest.error)

  const first = oldest.data?.[0]?.candle_date
  const last = newest.data?.[0]?.candle_date

  // An empty table is a legitimate state, not an error — the caller renders it.
  if (!first || !last) return null

  return { first, last, total }
}

/**
 * Every session in [from, to], oldest first, flagged with whether its setup was
 * computed.
 *
 * The setup lookup is a separate narrow query rather than a join: PostgREST
 * would need an FK relationship to embed it, and pulling one column for the
 * same window is cheaper than reasoning about that.
 */
export async function fetchSessionsInRange(
  from: CalendarDay,
  to: CalendarDay,
): Promise<SessionSummary[]> {
  const client = requireSupabase()

  const [candles, setups] = await Promise.all([
    client
      .from(TABLES.spotCandlesDaily)
      .select('candle_date, open, high, low, close, volume')
      .gte('candle_date', from)
      .lte('candle_date', to)
      .order('candle_date', { ascending: true }),
    client
      .from(TABLES.dailySetup)
      .select('session_date')
      .gte('session_date', from)
      .lte('session_date', to),
  ])

  if (candles.error) throw queryError(`Reading ${TABLES.spotCandlesDaily}`, candles.error)
  if (setups.error) throw queryError(`Reading ${TABLES.dailySetup}`, setups.error)

  // 3 rows per session (one per ATM batch), so collapse to a set of dates.
  const datesWithSetup = new Set(
    (setups.data ?? []).map((row) => (row as { session_date: string }).session_date),
  )

  return (candles.data ?? []).map((row) => {
    const candle = toSpotCandleDaily(row as SpotCandleDailyRow)
    return { ...candle, hasSetup: datesWithSetup.has(candle.candleDate) }
  })
}

function toSpotCandle5m(row: SpotCandle5mRow): SpotCandle5m | null {
  const epochSeconds = toEpochSeconds(row.candle_timestamp)

  // A bar with an unparseable timestamp cannot be placed on a time axis. Drop
  // it rather than charting it at a wrong position — a missing bar is visible,
  // a misplaced one is not.
  if (epochSeconds === null) return null

  return {
    epochSeconds,
    open: toNum(row.open, 'open'),
    high: toNum(row.high, 'high'),
    low: toNum(row.low, 'low'),
    close: toNum(row.close, 'close'),
    volume: toNumOrNull(row.volume, 'volume'),
  }
}

/**
 * The active session's 5-minute spot bars, oldest first.
 *
 * Filtered on candle_date rather than a timestamp range: the column is indexed,
 * and it sidesteps having to express an IST session window (09:15–15:25) as a
 * UTC half-open interval at the query layer.
 *
 * A normal session is ~75 bars. Some are legitimately much shorter — the Diwali
 * Muhurat session on 2025-10-21 has 12 — so callers must not treat a short
 * series as an error.
 */
export async function fetchSpotCandles5m(sessionDate: CalendarDay): Promise<SpotCandle5m[]> {
  const { data, error } = await requireSupabase()
    .from(TABLES.spotCandles5m)
    .select('candle_timestamp, open, high, low, close, volume')
    .eq('candle_date', sessionDate)
    .order('candle_timestamp', { ascending: true })

  if (error) throw queryError(`Reading ${TABLES.spotCandles5m} for ${sessionDate}`, error)

  return (data ?? [])
    .map((row) => toSpotCandle5m(row as SpotCandle5mRow))
    .filter((candle): candle is SpotCandle5m => candle !== null)
}

function toDailySetup(row: DailySetupRow): DailySetup | null {
  // An unrecognised batch name means the pipeline's vocabulary has changed.
  // Skip it rather than coercing it into one of the three the UI knows about.
  if (!isAtmBatch(row.atm_batch)) return null

  return {
    sessionDate: row.session_date,
    atmBatch: row.atm_batch,
    prevSessionDate: row.prev_session_date,
    prevClose: toNum(row.prev_close, 'prev_close'),
    prevHigh: toNum(row.prev_high, 'prev_high'),
    prevLow: toNum(row.prev_low, 'prev_low'),
    atmCenter: toNum(row.atm_center, 'atm_center'),
    otmCeStrike: toNum(row.otm_ce_strike, 'otm_ce_strike'),
    otmPeStrike: toNum(row.otm_pe_strike, 'otm_pe_strike'),
    // These five are nullable together and stay null — see DailySetup.
    otmCeSettle: toNumOrNull(row.otm_ce_settle, 'otm_ce_settle'),
    otmPeSettle: toNumOrNull(row.otm_pe_settle, 'otm_pe_settle'),
    sniperPoint: toNumOrNull(row.sniper_point, 'sniper_point'),
    spotSniperUpper: toNumOrNull(row.spot_sniper_upper, 'spot_sniper_upper'),
    spotSniperLower: toNumOrNull(row.spot_sniper_lower, 'spot_sniper_lower'),
    weeklyExpiry: row.weekly_expiry,
  }
}

/**
 * All three ATM batches for one session, in a single request.
 *
 * Spec §4.3 describes the batch toggle as re-fetching that batch's setup. Three
 * rows is a trivial payload, so this fetches all of them at once and lets the
 * toggle switch client-side: one round trip instead of three, and flipping
 * between batches to compare them stays instant, which is the whole point of
 * having the toggle.
 */
export async function fetchSessionSetup(sessionDate: CalendarDay): Promise<SessionSetup> {
  const { data, error } = await requireSupabase()
    .from(TABLES.dailySetup)
    // One unbroken literal: the client parses this string at the type level, and
    // splitting it across concatenated pieces defeats that inference.
    .select('session_date, atm_batch, prev_session_date, prev_close, prev_high, prev_low, atm_center, otm_ce_strike, otm_pe_strike, otm_ce_settle, otm_pe_settle, sniper_point, spot_sniper_upper, spot_sniper_lower, weekly_expiry')
    .eq('session_date', sessionDate)

  if (error) throw queryError(`Reading ${TABLES.dailySetup} for ${sessionDate}`, error)

  const setup: SessionSetup = {}

  for (const row of data ?? []) {
    const parsed = toDailySetup(row as DailySetupRow)
    if (parsed) setup[parsed.atmBatch as AtmBatch] = parsed
  }

  return setup
}

function toStrikeRef(row: StrikeRefRow): StrikeRef | null {
  if (!isAtmBatch(row.atm_batch) || !isLegRole(row.leg_role)) return null

  return {
    sessionDate: row.session_date,
    atmBatch: row.atm_batch,
    legRole: row.leg_role,
    strike: toNum(row.strike, 'strike'),
    optionType: row.option_type,
    expiry: row.expiry,
    instrumentKey: row.instrument_key,
  }
}

/**
 * All 12 leg references for a session — every batch, every leg.
 *
 * Fetched together for the same reason the setup is: the batch toggle should
 * not wait on a round trip, and 12 rows is nothing.
 */
export async function fetchStrikeRefs(sessionDate: CalendarDay): Promise<StrikeRef[]> {
  const { data, error } = await requireSupabase()
    .from(TABLES.strikeRefs)
    .select('session_date, atm_batch, leg_role, strike, option_type, expiry, instrument_key')
    .eq('session_date', sessionDate)

  if (error) throw queryError(`Reading ${TABLES.strikeRefs} for ${sessionDate}`, error)

  return (data ?? [])
    .map((row) => toStrikeRef(row as StrikeRefRow))
    .filter((ref): ref is StrikeRef => ref !== null)
}

function toOptionCandle5m(row: OptionCandle5mRow): OptionCandle5m | null {
  const epochSeconds = toEpochSeconds(row.candle_timestamp)
  if (epochSeconds === null) return null

  return {
    instrumentKey: row.instrument_key,
    candleDate: row.candle_date,
    epochSeconds,
    open: toNum(row.open, 'open'),
    high: toNum(row.high, 'high'),
    low: toNum(row.low, 'low'),
    close: toNum(row.close, 'close'),
    volume: toNumOrNull(row.volume, 'volume'),
  }
}

/**
 * Premium bars for the given instruments across the given trading days.
 *
 * Queried by instrument_key and candle_date rather than scanning the table
 * (spec §5.2). A session's 8 distinct instruments over two days come to roughly
 * 1200 rows, which is over PostgREST's per-response cap, so this pages until a
 * short page arrives. Without that, the last legs to sort would silently lose
 * their bars — a chart that is wrong rather than obviously broken.
 *
 * The order is also what makes paging correct: it must be total and stable
 * across requests, or rows can be skipped or repeated between pages.
 */
export async function fetchOptionCandles5m(
  instrumentKeys: string[],
  candleDates: CalendarDay[],
): Promise<OptionCandle5m[]> {
  if (instrumentKeys.length === 0 || candleDates.length === 0) return []

  const client = requireSupabase()
  const rows: OptionCandle5mRow[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE

    const { data, error } = await client
      .from(TABLES.optionCandles5m)
      .select('instrument_key, candle_date, candle_timestamp, open, high, low, close, volume')
      .in('instrument_key', instrumentKeys)
      .in('candle_date', candleDates)
      .order('instrument_key', { ascending: true })
      .order('candle_timestamp', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw queryError(`Reading ${TABLES.optionCandles5m}`, error)

    const batch = (data ?? []) as OptionCandle5mRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) return finishOptionCandles(rows)
  }

  throw new Error(
    `Reading ${TABLES.optionCandles5m}: stopped after ${MAX_PAGES} pages ` +
      `(${rows.length} rows). Refusing to keep paging — the result would be incomplete either way.`,
  )
}

function finishOptionCandles(rows: OptionCandle5mRow[]): OptionCandle5m[] {
  return rows
    .map((row) => toOptionCandle5m(row))
    .filter((candle): candle is OptionCandle5m => candle !== null)
}
