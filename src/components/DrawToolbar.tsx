import { DRAWING_TOOLS, TOOL_LABELS, type DrawingTool } from '../lib/drawings'
import type { ActiveDrawingTool } from '../contexts/DrawingToolContext'

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
 */
export function DrawToolbar({
  activeTool,
  onSelectTool,
  magnet,
  onToggleMagnet,
}: {
  activeTool: ActiveDrawingTool
  onSelectTool: (tool: ActiveDrawingTool) => void
  magnet: boolean
  onToggleMagnet: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-600">Draw</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Draw tools">
        <ToolButton
          label="Cursor"
          glyph="↖"
          active={activeTool === 'none'}
          onClick={() => onSelectTool('none')}
        />
        {DRAWING_TOOLS.map((tool) => (
          <ToolButton
            key={tool}
            label={TOOL_LABELS[tool]}
            glyph={TOOL_GLYPH[tool]}
            active={activeTool === tool}
            onClick={() => onSelectTool(tool)}
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
          className={`ml-1 flex h-7 items-center gap-1.5 rounded border px-2 font-mono text-xs transition ${
            magnet
              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
              : 'border-zinc-700 text-zinc-300 hover:border-emerald-600 hover:text-emerald-400'
          }`}
        >
          <span aria-hidden="true" className="text-sm leading-none">
            🧲
          </span>
          <span className="hidden sm:inline">Magnet</span>
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
}: {
  label: string
  glyph: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded border px-2 font-mono text-xs transition ${
        active
          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
          : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
      }`}
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {glyph}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
