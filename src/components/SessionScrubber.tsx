import { useEffect, useRef } from 'react'
import type { CalendarDay } from '../lib/calendar'
import { formatMonthLabel, formatSessionDate, formatSessionWeekday } from '../lib/format'
import type { SessionSummary } from '../lib/types'

/**
 * Horizontal strip of clickable session dates within the selected range
 * (spec 4.1). Clicking one makes it the active session.
 *
 * Chips are deliberately narrow: the full range is 233 sessions, so anything
 * wider turns browsing into a scrolling chore. The day number is enough to aim
 * at, month dividers give position, and the active session's full date is spelled
 * out in the panel below.
 *
 * Sessions without a computed setup are shown but visibly marked. They are real
 * trading days — the first day of the dataset has no prior day to derive a setup
 * from, and the most recent few are pending until their weekly expiry passes.
 * Hiding them would misrepresent the data; flagging them stops a later empty
 * overlay from reading as a bug.
 */
export function SessionScrubber({
  sessions,
  activeDate,
  onSelect,
  refreshing,
}: {
  sessions: SessionSummary[]
  activeDate: CalendarDay | null
  onSelect: (date: CalendarDay) => void
  refreshing: boolean
}) {
  const activeRef = useRef<HTMLButtonElement>(null)

  // Keep the active session visible when it changes from outside the strip
  // (prev/next buttons, keyboard, or a range change that moved the selection).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [activeDate])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = sessions.findIndex((session) => session.candleDate === activeDate)
    if (index === -1) return

    const target =
      event.key === 'ArrowLeft' ? index - 1
      : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0
      : event.key === 'End' ? sessions.length - 1
      : null

    if (target === null) return
    event.preventDefault()

    const next = sessions[Math.max(0, Math.min(sessions.length - 1, target))]
    if (next) onSelect(next.candleDate)
  }

  const withoutSetup = sessions.filter((session) => !session.hasSetup).length

  return (
    <div className="flex flex-col gap-1.5">
    <div
      role="listbox"
      aria-label="Trading sessions"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={`flex items-stretch overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900/30 px-2 py-2 transition-opacity ${
        refreshing ? 'opacity-50' : 'opacity-100'
      }`}
    >
      {sessions.map((session, index) => {
        const previous = sessions[index - 1]
        const startsMonth =
          previous !== undefined &&
          previous.candleDate.slice(0, 7) !== session.candleDate.slice(0, 7)

        return (
          <div key={session.candleDate} className="flex shrink-0 items-stretch">
            {startsMonth && <MonthDivider date={session.candleDate} />}
            <SessionChip
              ref={session.candleDate === activeDate ? activeRef : undefined}
              session={session}
              active={session.candleDate === activeDate}
              onSelect={onSelect}
            />
          </div>
        )
      })}
    </div>

      <Legend withoutSetup={withoutSetup} />
    </div>
  )
}

/** Explains the chip markings, which are otherwise just coloured hairlines. */
function Legend({ withoutSetup }: { withoutSetup: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[10px] text-zinc-600">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-px w-3 bg-emerald-500/70" />
        close ≥ open
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-px w-3 bg-red-500/70" />
        close &lt; open
      </span>
      {withoutSetup > 0 && (
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-zinc-700 opacity-40" />
          {withoutSetup} dimmed = no setup row (first session in dataset, or expiry not yet passed)
        </span>
      )}
      <span className="ml-auto">← → step · Home / End jump</span>
    </div>
  )
}

/** Vertical rule marking where a new month begins, so position stays readable. */
function MonthDivider({ date }: { date: CalendarDay }) {
  const [month, year] = formatMonthLabel(date).split(' ')

  return (
    <div
      aria-hidden="true"
      className="mx-1 flex flex-col items-center justify-center border-l border-zinc-700 pl-1.5"
    >
      <span className="font-mono text-[9px] uppercase leading-tight tracking-wider text-zinc-500">
        {month}
      </span>
      <span className="font-mono text-[9px] leading-tight text-zinc-700">
        {year?.slice(2)}
      </span>
    </div>
  )
}

function SessionChip({
  ref,
  session,
  active,
  onSelect,
}: {
  ref?: React.Ref<HTMLButtonElement>
  session: SessionSummary
  active: boolean
  onSelect: (date: CalendarDay) => void
}) {
  const up = session.close >= session.open
  const day = session.candleDate.slice(8)

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      aria-label={`${formatSessionDate(session.candleDate)}${session.hasSetup ? '' : ' — no setup'}`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(session.candleDate)}
      title={
        session.hasSetup
          ? `${formatSessionDate(session.candleDate)} · ${formatSessionWeekday(session.candleDate)}`
          : `${formatSessionDate(session.candleDate)} · no setup computed for this session`
      }
      className={`group relative flex w-8 shrink-0 flex-col items-center rounded-sm pb-1.5 pt-1 transition ${
        active ? 'bg-amber-500/15 ring-1 ring-amber-500' : 'hover:bg-zinc-800/70'
      } ${session.hasSetup ? '' : 'opacity-40'}`}
    >
      <span
        className={`font-mono text-xs leading-none ${active ? 'text-amber-300' : 'text-zinc-300'}`}
      >
        {day}
      </span>
      <span className="mt-0.5 font-mono text-[8px] uppercase leading-none text-zinc-600">
        {formatSessionWeekday(session.candleDate).slice(0, 2)}
      </span>

      {/* Direction bar: a per-chip reading of the day, not a separator. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-1 bottom-0.5 h-px ${up ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
      />

      {!session.hasSetup && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1.5 top-0 h-px bg-zinc-500"
          title="no setup"
        />
      )}
    </button>
  )
}
