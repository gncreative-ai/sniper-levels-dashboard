import { addCalendarMonths, clampCalendarDay, compareCalendarDays, isCalendarDay } from '../lib/calendar'
import type { CalendarDay } from '../lib/calendar'
import { formatSessionDate } from '../lib/format'
import type { SessionBounds } from '../lib/types'

export interface DateRange {
  from: CalendarDay
  to: CalendarDay
}

const PRESET_MONTHS = [1, 3, 6, 12] as const

/**
 * Picks the window of sessions the scrubber can browse (spec 4.1).
 *
 * Per spec 4.3 this only changes which dates appear in the scrubber — it never
 * touches the active session directly.
 */
export function DateRangeSelector({
  bounds,
  range,
  onChange,
}: {
  bounds: SessionBounds
  range: DateRange
  onChange: (range: DateRange) => void
}) {
  function setFrom(value: string) {
    if (!isCalendarDay(value)) return
    const from = clampCalendarDay(value, bounds.first, bounds.last)
    // Dragging `from` past `to` pushes `to` along rather than inverting the range.
    const to = compareCalendarDays(from, range.to) > 0 ? from : range.to
    onChange({ from, to })
  }

  function setTo(value: string) {
    if (!isCalendarDay(value)) return
    const to = clampCalendarDay(value, bounds.first, bounds.last)
    const from = compareCalendarDays(to, range.from) < 0 ? to : range.from
    onChange({ from, to })
  }

  function applyPreset(months: number) {
    onChange({
      from: clampCalendarDay(addCalendarMonths(bounds.last, -months), bounds.first, bounds.last),
      to: bounds.last,
    })
  }

  function applyAll() {
    onChange({ from: bounds.first, to: bounds.last })
  }

  const isAll = range.from === bounds.first && range.to === bounds.last

  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="From" value={range.from} bounds={bounds} onChange={setFrom} />
        <Field label="To" value={range.to} bounds={bounds} onChange={setTo} />

        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-zinc-600">Presets</span>
          <div className="flex flex-wrap gap-1">
            {PRESET_MONTHS.map((months) => (
              <button
                key={months}
                type="button"
                onClick={() => applyPreset(months)}
                className="rounded border border-zinc-700 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-amber-600 hover:text-amber-400"
              >
                {months}M
              </button>
            ))}
            <button
              type="button"
              onClick={applyAll}
              aria-pressed={isAll}
              className={`rounded border px-2 py-1 font-mono text-xs transition ${
                isAll
                  ? 'border-amber-600 bg-amber-950/40 text-amber-400'
                  : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
              }`}
            >
              All
            </button>
          </div>
        </div>

        <p className="ml-auto font-mono text-[12px] text-zinc-600">
          Data spans {formatSessionDate(bounds.first)} → {formatSessionDate(bounds.last)}
        </p>
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  bounds,
  onChange,
}: {
  label: string
  value: CalendarDay
  bounds: SessionBounds
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-zinc-600">{label}</span>
      <input
        type="date"
        value={value}
        min={bounds.first}
        max={bounds.last}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 outline-none transition focus:border-amber-600 [color-scheme:dark]"
      />
    </label>
  )
}
