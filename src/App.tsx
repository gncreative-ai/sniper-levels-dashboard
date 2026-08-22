import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { fetchSessionBounds, fetchSessionSetup, fetchSessionsInRange, fetchSpotCandles5m, TABLES } from './lib/queries'
import { supabaseProjectRef } from './lib/supabase'
import type { AtmBatch, SessionBounds } from './lib/types'
import { DEFAULT_OVERLAY_VISIBILITY, type OverlayId } from './lib/overlays'
import { useReplay } from './hooks/useReplay'
import { computeRevealCutoff } from './lib/replay'
import { createChartSyncGroup } from './lib/chartSync'
import { ChartSyncContext } from './contexts/ChartSyncContext'
import { DrawingToolContext, type ActiveDrawingTool } from './contexts/DrawingToolContext'
import { ThemeContext } from './contexts/ThemeContext'
import { initialTheme, persistTheme, type Theme } from './lib/theme'

/** Sessions shown on first load. The full range stays one click away. */
const DEFAULT_RANGE_MONTHS = 3

export default function App() {
  const { state, reload } = useAsync(fetchSessionBounds, [])

  // Lazily initialised so the stored preference (or the OS setting) is read
  // once, not on every render.
  const [theme, setTheme] = useState<Theme>(initialTheme)

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      persistTheme(next)
      return next
    })
  }, [])

  // The light palette is keyed off this attribute (see index.css). Set on the
  // document element rather than a wrapper so it also covers the body
  // background, which sits outside the React tree.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const themeState = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return (
    <ThemeContext.Provider value={themeState}>
    <div className="min-h-full bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <Header
          projectRef={supabaseProjectRef}
          totalSessions={state.status === 'ready' && state.data ? state.data.total : null}
          theme={theme}
          onToggleTheme={toggleTheme}
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
            Draw tools, magnet snap, measurement tools, drag-to-edit, and light/dark
            themes. Read-only: this dashboard never writes to Supabase.
          </p>
        </footer>
      </div>
    </div>
    </ThemeContext.Provider>
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

  // Which draw tool is armed (spec §4.5) — one shared toolbar for all five
  // charts, so this lives at the same level as batch/visibility rather than
  // per-chart. Not reset on session/batch change: unlike the drawings
  // themselves (cleared per-chart in useDrawingTools), staying on "Trend
  // Line" while you browse sessions is the useful default, not a surprise.
  const [activeDrawingTool, setActiveDrawingTool] = useState<ActiveDrawingTool>('none')

  // Magnet snapping, same lifetime and reasoning as the armed tool: it is a
  // way of working, not a property of the session being looked at.
  const [magnet, setMagnet] = useState(false)
  const toggleMagnet = useCallback(() => setMagnet((on) => !on), [])

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
            activeDrawingTool={activeDrawingTool}
            onSelectDrawingTool={setActiveDrawingTool}
            magnet={magnet}
            onToggleMagnet={toggleMagnet}
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
  activeDrawingTool,
  onSelectDrawingTool,
  magnet,
  onToggleMagnet,
}: {
  sessionDate: CalendarDay
  batch: AtmBatch
  onBatchChange: (batch: AtmBatch) => void
  visibility: typeof DEFAULT_OVERLAY_VISIBILITY
  onToggleOverlay: (id: OverlayId) => void
  activeDrawingTool: ActiveDrawingTool
  onSelectDrawingTool: (tool: ActiveDrawingTool) => void
  magnet: boolean
  onToggleMagnet: () => void
}) {
  const loadSetup = useCallback(() => fetchSessionSetup(sessionDate), [sessionDate])
  const { state, reload } = useAsync(loadSetup, [sessionDate], { keepPreviousData: true })

  const setup = state.status === 'ready' ? state.data : {}
  const hasAnyBatch = Object.keys(setup).length > 0

  // Fetched here rather than inside SpotChartPanel: replay needs this same
  // array to compute the cutoff shared with the four leg charts (lib/replay.ts).
  const loadSpotCandles = useCallback(() => fetchSpotCandles5m(sessionDate), [sessionDate])
  const { state: spotState, reload: reloadSpot } = useAsync(loadSpotCandles, [sessionDate], {
    keepPreviousData: true,
  })
  const spotCandles = spotState.status === 'ready' ? spotState.data : []

  // Position is tracked in spot-bar units; per spec §4.3 both a session and a
  // batch change reset replay to bar 0 once it has been engaged.
  const replay = useReplay(spotCandles.length, `${sessionDate}::${batch}`)
  const cutoff = useMemo(
    () => computeRevealCutoff(spotCandles, replay.revealedCount),
    [spotCandles, replay.revealedCount],
  )

  // One sync group per session view (spec §4.5) — created once and shared by
  // the spot chart and all four leg charts via context, not per session or
  // batch: the underlying chart instances persist across those changes (see
  // the comment below on why SpotChartPanel isn't keyed), so the group must
  // too, or switching sessions would silently drop synchronisation.
  const chartSync = useMemo(() => createChartSyncGroup(), [])

  // Passed as a stable-shaped object per render; consumers read it via
  // context rather than each needing activeTool/onSelectDrawingTool threaded
  // through as two separate props.
  const drawingToolState = useMemo(
    () => ({
      activeTool: activeDrawingTool,
      setActiveTool: onSelectDrawingTool,
      magnet,
      setMagnet: () => onToggleMagnet(),
    }),
    [activeDrawingTool, onSelectDrawingTool, magnet, onToggleMagnet],
  )

  return (
    <ChartSyncContext.Provider value={chartSync}>
    <DrawingToolContext.Provider value={drawingToolState}>
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
            replay={replay}
            activeDrawingTool={activeDrawingTool}
            onSelectDrawingTool={onSelectDrawingTool}
            magnet={magnet}
            onToggleMagnet={onToggleMagnet}
          />
        ) : (
          <EmptyPanel message="No setup rows for this session, so there are no overlay levels to draw." />
        ))}

      {/* Deliberately not keyed on the session: remounting would tear down and
          rebuild the chart instance on every selection, losing the zoom and pan
          state that phase 7 builds on. The panel refetches and swaps its data. */}
      <SpotChartPanel
        sessionDate={sessionDate}
        candlesState={spotState}
        reload={reloadSpot}
        cutoff={cutoff}
        setup={setup[batch]}
        visibility={visibility}
      />

      <LegQuadrantPanel setup={setup[batch]} batch={batch} cutoff={cutoff} />
    </DrawingToolContext.Provider>
    </ChartSyncContext.Provider>
  )
}

function Header({
  projectRef,
  totalSessions,
  theme,
  onToggleTheme,
}: {
  projectRef: string
  totalSessions: number | null
  theme: Theme
  onToggleTheme: () => void
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

          <button
            type="button"
            role="switch"
            aria-checked={theme === 'light'}
            aria-label="Light theme"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={onToggleTheme}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded border border-zinc-700 px-2 font-mono text-xs text-zinc-300 transition hover:border-amber-600 hover:text-amber-400"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {theme === 'dark' ? '☀' : '☾'}
            </span>
            <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
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
