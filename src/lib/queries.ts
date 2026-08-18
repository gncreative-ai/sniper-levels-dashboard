import type { PostgrestError } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'
import { toNum, toNumOrNull } from './num'
import type { SpotCandleDaily, SpotCandleDailyRow } from './types'

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
 * The most recent `limit` sessions, newest first.
 *
 * Ordered by candle_date in the database, not client-side: with 237 rows today
 * and a growing table, sorting belongs server-side.
 */
export async function fetchRecentDailyCandles(limit = 20): Promise<SpotCandleDaily[]> {
  const { data, error } = await requireSupabase()
    .from(TABLES.spotCandlesDaily)
    .select('candle_date, open, high, low, close, volume')
    .order('candle_date', { ascending: false })
    .limit(limit)

  if (error) throw queryError(`Reading ${TABLES.spotCandlesDaily}`, error)

  return (data ?? []).map((row) => toSpotCandleDaily(row as SpotCandleDailyRow))
}
