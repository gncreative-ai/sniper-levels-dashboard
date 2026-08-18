/**
 * Display formatting.
 *
 * Two rules from CLAUDE.md drive everything here:
 *   1. Never do date math in browser-local time.
 *   2. Postgres `date` values are calendar days, not instants.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Split a 'YYYY-MM-DD' calendar day without going through Date. */
function parseCalendarDay(isoDate: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return null

  const [, year, month, day] = match as unknown as [string, string, string, string]
  return { year: Number(year), month: Number(month), day: Number(day) }
}

/** '2025-09-01' -> '01 Sep 2025'. Returns the input unchanged if it isn't a plain date. */
export function formatSessionDate(isoDate: string): string {
  const parts = parseCalendarDay(isoDate)
  if (!parts) return isoDate

  const month = MONTHS[parts.month - 1] ?? String(parts.month)
  return `${String(parts.day).padStart(2, '0')} ${month} ${parts.year}`
}

/**
 * '2025-09-01' -> 'Mon'.
 *
 * Anchored at UTC noon so the weekday is derived from the calendar day itself
 * and cannot slip a day in either direction regardless of the viewer's zone.
 */
export function formatSessionWeekday(isoDate: string): string {
  const parts = parseCalendarDay(isoDate)
  if (!parts) return ''

  const utcNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
  return WEEKDAYS[utcNoon.getUTCDay()] ?? ''
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
