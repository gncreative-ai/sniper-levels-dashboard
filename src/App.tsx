import { useCallback, useMemo, useState } from 'react'
import { ActiveSessionPanel } from './components/ActiveSessionPanel'
import { DateRangeSelector, type DateRange } from './components/DateRangeSelector'
import { ControlBar } from './components/ControlBar'
import { LegQuadrantPanel } from './components/LegQuadrantPanel'
import { SessionScrubber } from './components/SessionScrubber'
import { SpotChartPanel } from './components/SpotChartPanel'
import { EmptyPanel, ErrorPanel, LoadingPanel } from './components/StatusPanels'
import { useAsync } from './hooks/useAsync'
import { addCalendarMonths, clampCalendarDay } from './lib/calendar'
import type { CalendarDay } from './lib/calendar'
import { formatCount } from './lib/format'
import { fetchSessionBounds, fetchSessionSetup, fetchSessionsInRange, TABLES } from './lib/queries'
import { supabaseProjectRef } from './lib/supabase'
import type { AtmBatch, SessionBounds } from './lib/types'
import { DEFAULT_OVERLAY_VISIBILITY, type OverlayId } from './lib/overlays'

/** Sessions shown on first load. The full range stays one click away. */
const DEFAULT_RANGE_MONTHS = 3

export default function App() {
  const { state, reload } = useAsync(fetchSessionBounds, [])

  return (
    <div className="min-h-full bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <Header
          projectRef={supabaseProjectRef}
          totalSessions={state.status === 'ready' && state.data ? state.data.total : null}
        />

        <main className="mt-6">
          {state.status === 'loading' && <LoadingPanel label="Loading session index…" />}

          {state.status === 'error' && (
            <ErrorPanel title="Supabase query failed" error={state.error} onRetry={reload} />
          )}

          {state.status === 'ready' &&
            (state.data === null ? (
              <EmptyPanel message={`${TABLES.spotCandlesDaily} contains no sessions.`} />
            ) : (
              <SessionBrowser bounds={state.data} />
            ))}
        </main>

        <footer className="mt-8 border-t border-zinc-900 pt-4">
          <p className="font-mono text-xs text-zinc-600">
            Phase 5 — four leg charts. Read-only: this dashboard never writes to Supabase.
          </p>
        </footer>
      </div>
    </div>
  )
}

/**
 * Owns the two pieces of selection state: the browsable window, and which
 * session inside it is active.
 *
 * Per spec 4.3 these are separate concerns — changing the range only changes
 * which dates the scrubber offers. The active session follows only when the
 * current one falls outside the new window.
 */
function SessionBrowser({ bounds }: { bounds: SessionBounds }) {
  const [range, setRange] = useState<DateRange>(() => ({
    from: clampCalendarDay(
      addCalendarMonths(bounds.last, -DEFAULT_RANGE_MONTHS),
      bounds.first,
      bounds.last,
    ),
    to: bounds.last,
  }))

  // null means "follow the range" — resolved to the newest session in view below.
  const [selectedDate, setSelectedDate] = useState<CalendarDay | null>(null)

  // Batch and overlay visibility are view preferences, so they persist across
  // session changes rather than resetting every time the scrubber moves.
  const [batch, setBatch] = useState<AtmBatch>('nearest')
  const [visibility, setVisibility] = useState(DEFAULT_OVERLAY_VISIBILITY)

  const toggleOverlay = useCallback((id: OverlayId) => {
    setVisibility((current) => ({ ...current, [id]: !current[id] }))
  }, [])

  const loadSessions = useCallback(
    () => fetchSessionsInRange(range.from, range.to),
    [range.from, range.to],
  )

  const { state, reload } = useAsync(loadSessions, [range.from, range.to], {
    keepPreviousData: true,
  })

  const sessions = state.status === 'ready' ? state.data : []

  /**
   * Derived rather than stored, so a range change can never strand the
   * selection on a date that is no longer in view.
   */
  const activeIndex = useMemo(() => {
    if (sessions.length === 0) return -1
    const found = sessions.findIndex((session) => session.candleDate === selectedDate)
    return found === -1 ? sessions.length - 1 : found
  }, [sessions, selectedDate])

  const activeSession = activeIndex === -1 ? null : sessions[activeIndex] ?? null

  const step = useCallback(
    (delta: number) => {
      const next = sessions[activeIndex + delta]
      if (next) setSelectedDate(next.candleDate)
    },
    [sessions, activeIndex],
  )

  return (
    <div className="flex flex-col gap-4">
      <DateRangeSelector bounds={bounds} range={range} onChange={setRange} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-mono text-sm text-zinc-400">Sessions</h2>
          <span className="font-mono text-xs text-zinc-600">
            {state.status === 'ready'
              ? `${formatCount(sessions.length)} in range · ${formatCount(bounds.total)} total`
              : '—'}
          </span>
        </div>

        {state.status === 'loading' && <LoadingPanel label="Loading sessions in range…" />}

        {state.status === 'error' && (
          <ErrorPanel title="Supabase query failed" error={state.error} onRetry={reload} />
        )}

        {state.status === 'ready' &&
          (sessions.length === 0 ? (
            <EmptyPanel message="No trading sessions fall inside the selected date range." />
          ) : (
            <SessionScrubber
              sessions={sessions}
              activeDate={activeSession?.candleDate ?? null}
              onSelect={setSelectedDate}
              refreshing={state.refreshing}
            />
          ))}
      </section>

      {activeSession && (
        <>
          <ActiveSessionPanel
            session={activeSession}
            index={activeIndex}
            total={sessions.length}
            onStep={step}
          />
          <SessionOverlays
            sessionDate={activeSession.candleDate}
            batch={batch}
            onBatchChange={setBatch}
            visibility={visibility}
            onToggleOverlay={toggleOverlay}
          />
        </>
      )}
    </div>
  )
}

/**
 * Fetches the session's three ATM batches and renders the control bar plus the
 * spot chart beneath it.
 *
 * Owns the setup fetch so the control bar and the chart's overlay lines read
 * from one result — showing a batch's numbers next to lines drawn from a
 * different fetch would be a subtle way to mislead.
 */
function SessionOverlays({
  sessionDate,
  batch,
  onBatchChange,
  visibility,
  onToggleOverlay,
}: {
  sessionDate: CalendarDay
  batch: AtmBatch
  onBatchChange: (batch: AtmBatch) => void
  visibility: typeof DEFAULT_OVERLAY_VISIBILITY
  onToggleOverlay: (id: OverlayId) => void
}) {
  const load = useCallback(() => fetchSessionSetup(sessionDate), [sessionDate])
  const { state, reload } = useAsync(load, [sessionDate], { keepPreviousData: true })

  const setup = state.status === 'ready' ? state.data : {}
  const hasAnyBatch = Object.keys(setup).length > 0

  return (
    <>
      {state.status === 'loading' && <LoadingPanel label="Loading session setup…" />}

      {state.status === 'error' && (
        <ErrorPanel title="Could not load session setup" error={state.error} onRetry={reload} />
      )}

      {state.status === 'ready' &&
        (hasAnyBatch ? (
          <ControlBar
            setup={setup}
            batch={batch}
            onBatchChange={onBatchChange}
            visibility={visibility}
            onVisibilityChange={onToggleOverlay}
          />
        ) : (
          <EmptyPanel message="No setup rows for this session, so there are no overlay levels to draw." />
        ))}

      {/* Deliberately not keyed on the session: remounting would tear down and
          rebuild the chart instance on every selection, losing the zoom and pan
          state that phase 7 builds on. The panel refetches and swaps its data. */}
      <SpotChartPanel sessionDate={sessionDate} setup={setup[batch]} visibility={visibility} />

      <LegQuadrantPanel setup={setup[batch]} batch={batch} />
    </>
  )
}

function Header({
  projectRef,
  totalSessions,
}: {
  projectRef: string
  totalSessions: number | null
}) {
  return (
    <header className="border-b border-zinc-800 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-zinc-100 sm:text-lg">
            Sniper Levels — Backtest Dashboard
          </h1>
          <p className="mt-1 font-mono text-[11px] text-zinc-500 sm:text-xs">
            Nifty 50 weekly options · read-only visual inspection
          </p>
        </div>

        {/* Left-aligned below sm: the project ref is a long unbroken string, and
            right-aligning it in a narrow viewport pushed it past the edge. */}
        <dl className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2">
          <Stat label="Sessions in table">
            {totalSessions === null ? '—' : formatCount(totalSessions)}
          </Stat>
          <Stat label="Supabase project">{projectRef || '—'}</Stat>
        </dl>
      </div>
    </header>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-left sm:text-right">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="break-all font-mono text-xs text-amber-400 sm:text-sm">{children}</dd>
    </div>
  )
}
