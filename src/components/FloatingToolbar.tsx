import { useContext } from 'react'
import type { Replay } from '../hooks/useReplay'
import { ToolbarContext } from '../contexts/ToolbarContext'
import { ChartSyncContext } from '../contexts/ChartSyncContext'
import { TimeframeContext } from '../contexts/TimeframeContext'
import { TIMEFRAMES, TIMEFRAME_LABELS } from '../lib/timeframe'
import type { ActiveDrawingTool } from '../contexts/DrawingToolContext'
import { ReplayControls } from './ReplayControls'
import { DrawToolbar } from './DrawToolbar'

/**
 * The replay and draw controls, docked so they stay reachable while scrolling.
 *
 * These two were in the control bar with the batch and overlay toggles, which
 * was fine until the four leg charts pushed them off-screen: changing tool or
 * stepping the replay meant scrolling back to the top, losing sight of the
 * chart you were working on. Fixed positioning solves that; the batch and
 * overlay toggles stay in the control bar because they are set once per
 * session rather than used continuously.
 *
 * Two docks, not free dragging. A dragged panel needs bounds handling, a
 * persisted position that can end up off-screen after a resize, and a way to
 * recover from that — none of which buys anything over "top" and "left" when
 * those are the two places a chart toolbar ever sensibly goes.
 */
export function FloatingToolbar({
  replay,
  activeDrawingTool,
  onSelectDrawingTool,
  magnet,
  onToggleMagnet,
}: {
  replay: Replay
  activeDrawingTool: ActiveDrawingTool
  onSelectDrawingTool: (tool: ActiveDrawingTool) => void
  magnet: boolean
  onToggleMagnet: () => void
}) {
  const { orientation, toggleOrientation } = useContext(ToolbarContext)
  const chartSync = useContext(ChartSyncContext)
  const { timeframe, setTimeframe } = useContext(TimeframeContext)
  const vertical = orientation === 'vertical'

  return (
    <div
      role="toolbar"
      aria-label="Replay and draw tools"
      aria-orientation={orientation}
      // whitespace-nowrap is inherited: without it, flex-nowrap squeezed the
      // buttons and the labels broke internally instead ("Trend / Line"),
      // which made the row taller rather than the bar wider.
      className={`fixed z-40 flex whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-900/95 p-2 shadow-lg shadow-black/20 backdrop-blur ${
        vertical
          ? // Anchored to the viewport's vertical centre, and allowed to
            // scroll internally rather than overflow off-screen on a short one.
            'left-2 top-1/2 max-h-[calc(100vh-1rem)] -translate-y-1/2 flex-col items-center gap-2 overflow-y-auto'
          : // flex-nowrap, not wrap: allowed to wrap, the draw tools stacked into
            // three rows and the bar became a 129px-tall block over the header.
            // A single row that scrolls sideways on a narrow viewport is the
            // shape a top dock should have.
            'left-1/2 top-2 max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-row flex-nowrap items-center gap-3 overflow-x-auto'
      }`}
    >
      <OrientationButton vertical={vertical} onClick={toggleOrientation} />

      {/* Re-frames all five charts at once — the counterpart to free zoom/pan,
          which can leave the data scrolled off-screen. */}
      <button
        type="button"
        aria-label="Fit all charts to their data"
        title="Fit all charts to their data"
        onClick={() => chartSync?.fitAll()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-700 text-sm text-zinc-400 transition hover:border-amber-600 hover:text-amber-400"
      >
        <span aria-hidden="true">⤢</span>
      </button>

      <Divider vertical={vertical} />

      {/* Both timeframes cover the same two sessions — this is a change of
          resolution, not of range. See lib/timeframe.ts. */}
      <div
        className={vertical ? 'flex flex-col gap-1' : 'flex gap-1'}
        role="group"
        aria-label="Timeframe"
      >
        {TIMEFRAMES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={timeframe === option}
            aria-label={`${TIMEFRAME_LABELS[option]} candles`}
            title={
              option === '5m'
                ? '5-minute candles'
                : 'One candle per session — previous and current day'
            }
            onClick={() => setTimeframe(option)}
            className={`h-7 shrink-0 rounded border px-1.5 font-mono text-[11px] transition ${
              timeframe === option
                ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
            }`}
          >
            {TIMEFRAME_LABELS[option]}
          </button>
        ))}
      </div>

      <Divider vertical={vertical} />

      <ReplayControls replay={replay} orientation={orientation} />

      <Divider vertical={vertical} />

      <DrawToolbar
        activeTool={activeDrawingTool}
        onSelectTool={onSelectDrawingTool}
        magnet={magnet}
        onToggleMagnet={onToggleMagnet}
        orientation={orientation}
      />
    </div>
  )
}

/** Separates the groups, since the vertical dock drops their headings. */
function Divider({ vertical }: { vertical: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={vertical ? 'h-px w-6 shrink-0 bg-zinc-800' : 'h-8 w-px shrink-0 bg-zinc-800'}
    />
  )
}

function OrientationButton({
  vertical,
  onClick,
}: {
  vertical: boolean
  onClick: () => void
}) {
  const label = vertical ? 'Dock horizontally at the top' : 'Dock vertically at the left'

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-700 text-sm text-zinc-400 transition hover:border-amber-600 hover:text-amber-400"
    >
      {/* Shows the layout it will switch TO, not the current one. */}
      <span aria-hidden="true">{vertical ? '⇄' : '⇅'}</span>
    </button>
  )
}
