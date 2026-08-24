import { useEffect, useRef, useState } from 'react'
import {
  DASH_PATTERN,
  DRAWING_PALETTE,
  LINE_STYLE_NAMES,
  LINE_WIDTHS,
  TOOL_LABELS,
  withAlpha,
  type Bar,
  type Drawing,
  type LineStyleName,
  type LineWidth,
} from '../lib/drawings'
import { formatIstDayTime, fromChartTime } from '../lib/time'

/**
 * Per-drawing settings, modelled on TradingView's drawing dialog: a Style tab
 * (colour, opacity, thickness, line style, price label) and a Coordinates tab.
 *
 * Edits apply live rather than on OK, so the chart previews them as you go —
 * which is also why Cancel matters: the hook snapshots the drawing when the
 * dialog opens and restores it if you back out.
 *
 * Time is chosen from the chart's own bars rather than typed. Anchors are
 * quantised to bars anyway (the time scale resolves any coordinate to a bar),
 * so a free-text timestamp could only ever be rounded to one of these — and a
 * dropdown cannot be typed into an invalid state.
 */
export function DrawingSettingsDialog({
  drawing,
  bars,
  onChange,
  onCancel,
  onDone,
}: {
  drawing: Drawing
  bars: readonly Bar[]
  onChange: (id: string, patch: Partial<Drawing>) => void
  onCancel: () => void
  onDone: () => void
}) {
  const [tab, setTab] = useState<'style' | 'coordinates'>('style')
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape closes without keeping the edits, matching Cancel. Captured so it
  // beats the chart's own Escape handling (which clears the selection).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  const style = drawing.style
  const setStyle = (patch: Partial<typeof style>) =>
    onChange(drawing.id, { style: { ...style, ...patch } })

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`${TOOL_LABELS[drawing.tool]} settings`}
      className="fixed right-4 top-24 z-50 w-72 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/40"
    >
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h3 className="font-mono text-xs font-semibold text-zinc-100">
          {TOOL_LABELS[drawing.tool]}
        </h3>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:text-zinc-200"
        >
          ✕
        </button>
      </header>

      <div className="flex gap-1 border-b border-zinc-800 px-3 pt-2" role="tablist">
        <Tab label="Style" active={tab === 'style'} onClick={() => setTab('style')} />
        <Tab
          label="Coordinates"
          active={tab === 'coordinates'}
          onClick={() => setTab('coordinates')}
        />
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        {tab === 'style' ? (
          <StyleTab style={style} onChange={setStyle} />
        ) : (
          <CoordinatesTab drawing={drawing} bars={bars} onChange={onChange} />
        )}
      </div>

      <footer className="flex justify-end gap-2 border-t border-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-zinc-700 px-3 py-1 font-mono text-xs text-zinc-300 transition hover:border-zinc-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-amber-500 bg-amber-500/15 px-3 py-1 font-mono text-xs text-amber-300 transition hover:bg-amber-500/25"
        >
          Ok
        </button>
      </footer>
    </div>
  )
}

function Tab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-t border-b-2 px-2 py-1 font-mono text-[12px] transition ${
        active
          ? 'border-amber-500 text-amber-300'
          : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  )
}

function StyleTab({
  style,
  onChange,
}: {
  style: Drawing['style']
  onChange: (patch: Partial<Drawing['style']>) => void
}) {
  return (
    <>
      <Row label="Colour">
        <div className="grid grid-cols-10 gap-1">
          {DRAWING_PALETTE.map((colour) => (
            <button
              key={colour}
              type="button"
              aria-label={colour}
              aria-pressed={style.color.toLowerCase() === colour.toLowerCase()}
              title={colour}
              onClick={() => onChange({ color: colour })}
              className={`h-4 w-4 rounded-sm border transition ${
                style.color.toLowerCase() === colour.toLowerCase()
                  ? 'border-amber-400 ring-1 ring-amber-400'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
              style={{ backgroundColor: colour }}
            />
          ))}
        </div>
      </Row>

      <Row label={`Opacity ${Math.round(style.opacity * 100)}%`}>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(style.opacity * 100)}
          aria-label="Opacity"
          onChange={(event) => onChange({ opacity: Number(event.target.value) / 100 })}
          className="w-full accent-amber-500"
        />
      </Row>

      <Row label="Thickness">
        <div className="flex gap-1" role="group" aria-label="Thickness">
          {LINE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              aria-label={`${width}px`}
              aria-pressed={style.width === width}
              title={`${width}px`}
              onClick={() => onChange({ width: width as LineWidth })}
              className={`flex h-7 flex-1 items-center justify-center rounded border transition ${
                style.width === width
                  ? 'border-amber-500 bg-amber-500/15'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <span
                aria-hidden="true"
                className="w-6 rounded-full bg-zinc-300"
                style={{ height: `${width}px` }}
              />
            </button>
          ))}
        </div>
      </Row>

      <Row label="Line">
        <div className="flex gap-1" role="group" aria-label="Line style">
          {LINE_STYLE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={style.lineStyle === name}
              onClick={() => onChange({ lineStyle: name as LineStyleName })}
              className={`h-7 flex-1 rounded border font-mono text-[11px] capitalize transition ${
                style.lineStyle === name
                  ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </Row>

      <label className="flex items-center gap-2 font-mono text-[12px] text-zinc-300">
        <input
          type="checkbox"
          checked={style.priceLabel}
          onChange={(event) => onChange({ priceLabel: event.target.checked })}
          className="h-3.5 w-3.5 accent-amber-500"
        />
        Price label
      </label>

      <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-2">
        <span className="text-[11px] uppercase tracking-wider text-zinc-600">Preview</span>
        <svg viewBox="0 0 200 20" className="mt-1 h-5 w-full" aria-hidden="true">
          <line
            x1="4"
            y1="10"
            x2="196"
            y2="10"
            stroke={withAlpha(style.color, style.opacity)}
            strokeWidth={style.width}
            strokeDasharray={DASH_PATTERN[style.lineStyle].join(' ') || undefined}
          />
        </svg>
      </div>
    </>
  )
}

function CoordinatesTab({
  drawing,
  bars,
  onChange,
}: {
  drawing: Drawing
  bars: readonly Bar[]
  onChange: (id: string, patch: Partial<Drawing>) => void
}) {
  function setPoint(index: number, patch: { time?: number; price?: number }) {
    const points = drawing.points.map((point, i) =>
      i === index ? { ...point, ...patch } : point,
    ) as Drawing['points']

    onChange(drawing.id, { points })
  }

  if (bars.length === 0) {
    return (
      <p className="font-mono text-[12px] text-zinc-500">
        This chart has no bars, so there are no times to anchor to.
      </p>
    )
  }

  return (
    <>
      {drawing.points.map((point, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-zinc-600">
            {drawing.points.length === 1 ? 'Anchor' : `Point ${index + 1}`}
          </span>

          <label className="flex items-center gap-2 font-mono text-[12px] text-zinc-400">
            <span className="w-10 shrink-0">Time</span>
            <select
              aria-label={`Point ${index + 1} time`}
              value={String(point.time)}
              onChange={(event) => setPoint(index, { time: Number(event.target.value) })}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
            >
              {bars.map((bar) => (
                <option key={bar.time} value={String(bar.time)}>
                  {barLabel(bar)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 font-mono text-[12px] text-zinc-400">
            <span className="w-10 shrink-0">Price</span>
            <input
              type="number"
              step="0.05"
              aria-label={`Point ${index + 1} price`}
              value={point.price}
              onChange={(event) => {
                const next = Number(event.target.value)
                // An empty or half-typed field parses as NaN; ignoring it keeps
                // the drawing on its last good price instead of un-rendering it.
                if (Number.isFinite(next)) setPoint(index, { price: next })
              }}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
            />
          </label>
        </div>
      ))}
    </>
  )
}

/** `11 Aug · 10:35` — the date matters because leg charts span two sessions. */
function barLabel(bar: Bar): string {
  return formatIstDayTime(fromChartTime(bar.time))
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-zinc-600">{label}</span>
      {children}
    </div>
  )
}
