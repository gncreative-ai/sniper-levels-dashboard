/**
 * Display formatting.
 *
 * Two rules from CLAUDE.md drive everything here:
 *   1. Never do date math in browser-local time.
 *   2. Postgres `date` values are calendar days, not instants.
 */

import { calendarDayToUtcNoon, parseCalendarDay } from './calendar'
import type { CalendarDay } from './calendar'

export const IST_TIME_ZONE = 'Asia/Kolkata'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** '2025-09-01' -> '01 Sep 2025'. Returns the input unchanged if it isn't a plain date. */
export function formatSessionDate(isoDate: CalendarDay): string {
  const parts = parseCalendarDay(isoDate)
  if (!parts) return isoDate

  const month = MONTHS[parts.month - 1] ?? String(parts.month)
  return `${String(parts.day).padStart(2, '0')} ${month} ${parts.year}`
}

/** '2025-09-01' -> '01 Sep'. The compact form used on scrubber chips. */
export function formatSessionDateShort(isoDate: CalendarDay): string {
  const parts = parseCalendarDay(isoDate)
  if (!parts) return isoDate

  const month = MONTHS[parts.month - 1] ?? String(parts.month)
  return `${String(parts.day).padStart(2, '0')} ${month}`
}

/** '2025-09-01' -> 'Sep 2025'. Used for the scrubber's month group headings. */
export function formatMonthLabel(isoDate: CalendarDay): string {
  const parts = parseCalendarDay(isoDate)
  if (!parts) return isoDate

  const month = MONTHS[parts.month - 1] ?? String(parts.month)
  return `${month} ${parts.year}`
}

/**
 * '2025-09-01' -> 'Mon'.
 *
 * Derived from the calendar day itself via a UTC-noon anchor, so it cannot slip
 * a day in either direction regardless of the viewer's zone.
 */
export function formatSessionWeekday(isoDate: CalendarDay): string {
  const parts = parseCalendarDay(isoDate)
  if (!parts) return ''

  return WEEKDAYS[calendarDayToUtcNoon(parts).getUTCDay()] ?? ''
}

const istDateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * Render a true instant (timestamptz / Date) in IST.
 *
 * This is the helper for `candle_timestamp` from the 5-min tables. Use it for
 * anything that is an instant. Do NOT use it for a Postgres `date`.
 */
export function formatIstDateTime(instant: Date | string): string {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return '—'
  return `${istDateTime.format(date)} IST`
}

const price = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Prices. Renders an em dash for a genuine null rather than a misleading 0.00. */
export function formatPrice(value: number | null): string {
  return value === null ? '—' : price.format(value)
}

const integer = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export function formatCount(value: number): string {
  return integer.format(value)
}

/** Volume is legitimately null or 0 for an index — show that honestly. */
export function formatVolume(value: number | null): string {
  return value === null ? '—' : integer.format(value)
}

export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}
