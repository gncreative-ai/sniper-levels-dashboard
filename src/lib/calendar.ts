/**
 * Calendar-day arithmetic for Postgres `date` values.
 *
 * A trading session date is a calendar day, not an instant. It has no time and
 * no zone. The rule from CLAUDE.md — never do date math in browser-local time —
 * is enforced here by keeping every value as a 'YYYY-MM-DD' string and anchoring
 * the one place a Date is unavoidable at UTC noon, far enough from either
 * midnight that no offset can push it onto an adjacent day.
 *
 * Nothing in this module is affected by where the viewer is sitting.
 */

/** A calendar day as 'YYYY-MM-DD'. */
export type CalendarDay = string

const CALENDAR_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface CalendarParts {
  year: number
  month: number
  day: number
}

export function parseCalendarDay(value: string): CalendarParts | null {
  const match = CALENDAR_DAY_PATTERN.exec(value)
  if (!match) return null

  const [, year, month, day] = match as unknown as [string, string, string, string]
  const parts = { year: Number(year), month: Number(month), day: Number(day) }

  // Reject values that parse structurally but are not real days (e.g. 2026-02-31).
  return formatCalendarDay(parts) === value ? parts : null
}

export function isCalendarDay(value: string): boolean {
  return parseCalendarDay(value) !== null
}

export function formatCalendarDay({ year, month, day }: CalendarParts): CalendarDay {
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * UTC noon anchor for a calendar day.
 *
 * Only for deriving a weekday or shifting by months — never for display.
 */
export function calendarDayToUtcNoon(parts: CalendarParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
}

/**
 * Shift by whole months, clamping to the end of the target month.
 * '2026-03-31' minus one month is '2026-02-28', not a rollover into March.
 */
export function addCalendarMonths(value: CalendarDay, delta: number): CalendarDay {
  const parts = parseCalendarDay(value)
  if (!parts) return value

  const zeroBasedMonth = parts.year * 12 + (parts.month - 1) + delta
  const year = Math.floor(zeroBasedMonth / 12)
  const month = (zeroBasedMonth % 12) + 1

  const lastDayOfMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate()

  return formatCalendarDay({ year, month, day: Math.min(parts.day, lastDayOfMonth) })
}

/**
 * Compare two calendar days. Lexicographic ordering is correct for zero-padded
 * ISO dates, which is exactly why this format is worth preserving as a string.
 */
export function compareCalendarDays(a: CalendarDay, b: CalendarDay): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function clampCalendarDay(
  value: CalendarDay,
  min: CalendarDay,
  max: CalendarDay,
): CalendarDay {
  if (compareCalendarDays(value, min) < 0) return min
  if (compareCalendarDays(value, max) > 0) return max
  return value
}

export function isWithinRange(value: CalendarDay, from: CalendarDay, to: CalendarDay): boolean {
  return compareCalendarDays(value, from) >= 0 && compareCalendarDays(value, to) <= 0
}
