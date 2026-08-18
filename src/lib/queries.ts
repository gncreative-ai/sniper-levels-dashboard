import type { PostgrestError } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'
import { toNum, toNumOrNull } from './num'
import type {
  SessionBounds,
  SessionSummary,
  SpotCandleDaily,
  SpotCandleDailyRow,
} from './types'
import type { CalendarDay } from './calendar'

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
} as const

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
