import { DRAWING_TOOLS, TOOL_LABELS, type DrawingTool } from '../lib/drawings'
import type { ActiveDrawingTool } from '../contexts/DrawingToolContext'
import type { ToolbarOrientation } from '../lib/toolbarLayout'

const TOOL_GLYPH: Record<DrawingTool, string> = {
  trendline: '╱',
  ray: '→',
  rectangle: '▭',
  fib: '𝑓',
  priceRange: '↕',
  dateRange: '↔',
}

/**
 * Draw-tool picker (spec §4.5): one shared toolbar arms a tool for all five
 * charts at once — click the tool, then click a chart to start placing it.
 *
 * "Cursor" is the default (none) state: normal pan/zoom/crosshair, click an
 * existing drawing to select it, then drag its body to move it or one of its
 * handles to reshape it. Escape cancels a half-placed drawing or clears the
 * selection; Delete/Backspace removes the selection — all handled per-chart in
 * useDrawingTools, not here.
 *
 * "Magnet" is a separate toggle rather than a tool, because it modifies
 * whichever tool is armed instead of replacing it.
 *
 * Vertical drops every text label and shows glyphs alone, so the left dock
 * stays a narrow strip rather than a panel wide enough to read "Fib
 * Retracement". The names are still reachable: each button keeps its title
 * tooltip and its accessible name, which is what a screen reader announces
 * either way.
 */
export function DrawToolbar({
  activeTool,
  onSelectTool,
  magnet,
  onToggleMagnet,
  orientation = 'horizontal',
}: {
  activeTool: ActiveDrawingTool
  onSelectTool: (tool: ActiveDrawingTool) => void
  magnet: boolean
  onToggleMagnet: () => void
  orientation?: ToolbarOrientation
}) {
  const vertical = orientation === 'vertical'

  return (
    <div className="flex">
      <div
        className={vertical ? 'flex flex-col gap-1' : 'flex flex-nowrap gap-1'}
        role="group"
        aria-label="Draw tools"
      >
        <ToolButton
          label="Cursor"
          glyph="↖"
          active={activeTool === 'none'}
          onClick={() => onSelectTool('none')}
          vertical={vertical}
        />
        {DRAWING_TOOLS.map((tool) => (
          <ToolButton
            key={tool}
            label={TOOL_LABELS[tool]}
            glyph={TOOL_GLYPH[tool]}
            active={activeTool === tool}
            onClick={() => onSelectTool(tool)}
            vertical={vertical}
          />
        ))}

        <button
          type="button"
          role="switch"
          aria-checked={magnet}
          title={
            magnet
              ? 'Magnet on — points snap to the nearest bar’s open/high/low/close'
              : 'Magnet off — points land wherever you click'
          }
          onClick={onToggleMagnet}
          aria-label="Magnet"
          className={`flex h-7 items-center justify-center gap-1.5 rounded border font-mono text-xs transition ${
            vertical ? 'w-7' : 'ml-1 px-2'
          } ${
            magnet
              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
              : 'border-zinc-700 text-zinc-300 hover:border-emerald-600 hover:text-emerald-400'
          }`}
        >
          <span aria-hidden="true" className="text-sm leading-none">
            🧲
          </span>
          {!vertical && <span className="hidden sm:inline">Magnet</span>}
        </button>
      </div>
    </div>
  )
}

function ToolButton({
  label,
  glyph,
  active,
  onClick,
  vertical,
}: {
  label: string
  glyph: string
  active: boolean
  onClick: () => void
  vertical: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-7 items-center justify-center gap-1.5 rounded border font-mono text-xs transition ${
        vertical ? 'w-7' : 'px-2'
      } ${
        active
          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
          : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
      }`}
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {glyph}
      </span>
      {!vertical && <span className="hidden sm:inline">{label}</span>}
    </button>
  )
}
