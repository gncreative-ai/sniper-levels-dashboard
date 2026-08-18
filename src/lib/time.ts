import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Instant handling for the charts.
 *
 * There are two distinct kinds of number in this file and confusing them is the
 * whole reason it exists:
 *
 *   epoch seconds  — a real instant. What `candle_timestamp` actually means.
 *   chart time     — a *lie told to the charting library*, explained below.
 *
 * Lightweight Charts has no timezone support: it renders every `UTCTimestamp`
 * in UTC. The documented way to display another zone is to shift the value by
 * that zone's offset, so the library's UTC rendering coincidentally reads as
 * local time. That is what `toChartTime` does.
 *
 * This shortcut is only safe because IST is a fixed +05:30 with no daylight
 * saving — it has not changed since 1945. The same trick applied to a
 * DST-observing zone would silently drift by an hour twice a year. Do not
 * generalise this module to other zones without revisiting that.
 *
 * A chart time is NOT an instant. Never compare it to Date.now(), never store
 * it, never send it anywhere. Convert back with `fromChartTime` first.
 */

/** IST is UTC+05:30, fixed, no daylight saving. */
export const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60

/**
 * Parse a `timestamptz` from PostgREST into epoch seconds.
 *
 * Unlike the `date` columns, these carry an explicit offset
 * (`2026-08-14T03:45:00+00:00`), so `Date` parses them unambiguously — there is
 * no local-time hazard here. Returns null for anything unparseable rather than
 * yielding a NaN that would poison the chart.
 */
export function toEpochSeconds(timestamptz: string): number | null {
  const parsed = Date.parse(timestamptz)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000)
}

/**
 * Shift a real instant so Lightweight Charts' UTC axis reads as IST.
 * Display only — see the module comment.
 */
export function toChartTime(epochSeconds: number): UTCTimestamp {
  return (epochSeconds + IST_OFFSET_SECONDS) as UTCTimestamp
}

/** Undo `toChartTime`, recovering the real instant. */
export function fromChartTime(chartTime: UTCTimestamp): number {
  return (chartTime as number) - IST_OFFSET_SECONDS
}

const HH_MM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 'HH:mm' in IST, from a real instant. Used for axis ticks and readouts. */
export function formatIstTime(epochSeconds: number): string {
  return HH_MM.format(new Date(epochSeconds * 1000))
}
