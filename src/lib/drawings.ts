import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Drawing tools (spec §4.5): trend lines, horizontal rays, rectangles,
 * fibonacci retracement, and the two measurement tools (price range, date
 * range), usable on all five charts. Types and pure geometry only — no React,
 * no Lightweight Charts primitive plumbing (that lives in drawingPrimitive.ts).
 *
 * Every drawing is anchored in (time, price) space, never pixels — the same
 * discipline the overlay lines and the leg-chart divider already follow, so a
 * drawing stays glued to the right place through zoom, pan, and resize.
 *
 * Scope: create, select, move/reshape, delete, magnet snapping, and per-drawing
 * style and coordinate editing. Still out of scope until asked for:
 * persistence across a reload, and undo/redo.
 */

export type DrawingTool =
  | 'trendline'
  | 'ray'
  | 'rectangle'
  | 'fib'
  | 'priceRange'
  | 'dateRange'

export const DRAWING_TOOLS: readonly DrawingTool[] = [
  'trendline',
  'ray',
  'rectangle',
  'fib',
  'priceRange',
  'dateRange',
]

export const TOOL_LABELS: Record<DrawingTool, string> = {
  trendline: 'Trend Line',
  ray: 'Horizontal Ray',
  rectangle: 'Rectangle',
  fib: 'Fib Retracement',
  priceRange: 'Price Range',
  dateRange: 'Date Range',
}

/** How many clicks each tool needs before a drawing is committed. */
export const TOOL_POINT_COUNT: Record<DrawingTool, 1 | 2> = {
  trendline: 2,
  ray: 1,
  rectangle: 2,
  fib: 2,
  priceRange: 2,
  dateRange: 2,
}

export interface Point {
  time: UTCTimestamp
  price: number
}

export interface Drawing {
  id: string
  tool: DrawingTool
  /** Exactly TOOL_POINT_COUNT[tool] points, in click order. */
  points: Point[]
  style: DrawingStyle
}

// --- Per-drawing style -----------------------------------------------------

export type LineStyleName = 'solid' | 'dashed' | 'dotted'

export const LINE_STYLE_NAMES: readonly LineStyleName[] = ['solid', 'dashed', 'dotted']

/** Canvas dash patterns. Solid is an empty pattern, not a very long dash. */
export const DASH_PATTERN: Record<LineStyleName, number[]> = {
  solid: [],
  dashed: [6, 4],
  dotted: [2, 3],
}

export const LINE_WIDTHS = [1, 2, 3, 4] as const
export type LineWidth = (typeof LINE_WIDTHS)[number]

export interface DrawingStyle {
  /** Opaque hex, `#rrggbb`. Opacity is separate so the swatch stays readable. */
  color: string
  /** 0–1. Applied to the stroke, and to the fill on top of its own tint. */
  opacity: number
  width: LineWidth
  lineStyle: LineStyleName
  /** Show this drawing's anchor price(s) on the price axis. */
  priceLabel: boolean
}

/** The picker grid. Ten hues over two tones, plus black and white at the ends. */
export const DRAWING_PALETTE: readonly string[] = [
  '#ffffff', '#d4d4d8', '#71717a', '#000000',
  '#f23645', '#f87171', '#fb923c', '#fbbf24',
  '#089981', '#34d399', '#22d3ee', '#38bdf8',
  '#3b82f6', '#818cf8', '#a78bfa', '#e879f9',
  '#f472b6', '#fda4af', '#a16207', '#065f46',
]

/**
 * A drawing's style at creation.
 *
 * Price Range takes its colour from the direction of the move, the way
 * TradingView does — but only once, here. After creation the colour belongs to
 * the user, so dragging an anchor through the other side later does NOT
 * silently repaint a drawing they may have deliberately coloured.
 *
 * The price label defaults on only for a horizontal ray, where the whole point
 * is the level it marks; on the other tools it would just crowd the axis.
 */
export function defaultStyle(tool: DrawingTool, points: readonly Point[]): DrawingStyle {
  const base: DrawingStyle = {
    color: TOOL_DEFAULT_COLOR[tool],
    opacity: 1,
    width: 2,
    lineStyle: 'solid',
    priceLabel: tool === 'ray',
  }

  if (tool !== 'priceRange') return base

  const rising = (points[1]?.price ?? 0) >= (points[0]?.price ?? 0)
  return { ...base, color: rising ? '#34d399' : '#f87171' }
}

const TOOL_DEFAULT_COLOR: Record<DrawingTool, string> = {
  trendline: '#38bdf8',
  ray: '#38bdf8',
  rectangle: '#a78bfa',
  fib: '#f472b6',
  priceRange: '#34d399',
  dateRange: '#60a5fa',
}

/**
 * `#rrggbb` plus an alpha, as an `rgba()` string.
 *
 * Returns the input untouched if it is not a six-digit hex, so a malformed
 * colour degrades to "drawn in whatever that is" rather than to an exception
 * inside a canvas render loop.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex

  const value = parseInt(match[1]!, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255

  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0, value))
}

let nextId = 0

/** Monotonic, not a UUID — drawings never leave this browser tab, let alone this page load. */
export function makeDrawingId(): string {
  nextId += 1
  return `drawing-${nextId}`
}

/** Fractions TradingView and every other charting tool draw for a retracement, in order. */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

/** The price at a given fib fraction between a drawing's two anchor points. */
export function fibLevelPrice(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction
}

// --- Magnet snapping -------------------------------------------------------

/** The subset of a candle this module needs; CandlestickData satisfies it structurally. */
export interface Bar {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
}

/** The bar closest to a chart time, by absolute distance. Null when there are none. */
export function nearestBar(bars: readonly Bar[], time: UTCTimestamp): Bar | null {
  let best: Bar | null = null
  let bestDistance = Infinity

  for (const bar of bars) {
    const distance = Math.abs(bar.time - time)
    if (distance < bestDistance) {
      bestDistance = distance
      best = bar
    }
  }

  return best
}

/**
 * Magnet snap (TradingView's magnet toggle): pull a raw cursor point onto the
 * nearest bar's nearest OHLC value.
 *
 * Note what this does and does not change. Horizontal position is already
 * quantised to a bar by the time scale itself — Lightweight Charts' click and
 * coordinate-to-time conversions both resolve to a bar's own time, magnet or
 * not. So the part magnet actually adds is the *price*: without it a point sits
 * wherever the pointer was, with it the point lands exactly on that bar's open,
 * high, low, or close — whichever is nearest.
 *
 * Returns the point unchanged when there are no bars, so an empty chart can
 * still be drawn on rather than swallowing the interaction.
 */
export function snapToBar(bars: readonly Bar[], point: Point): Point {
  const bar = nearestBar(bars, point.time)
  if (!bar) return point

  const candidates = [bar.open, bar.high, bar.low, bar.close]
  let price = candidates[0]!
  let bestDistance = Math.abs(price - point.price)

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - point.price)
    if (distance < bestDistance) {
      bestDistance = distance
      price = candidate
    }
  }

  return { time: bar.time, price }
}

// --- Measurement formatting (price range / date range) ---------------------

/**
 * Absolute and percentage move between two prices, e.g. `+123.45 (+2.34%)`.
 *
 * The percentage is omitted when the starting price is zero rather than
 * rendering `Infinity%` — a real case here, since a far-OTM option premium can
 * decay to near nothing by expiry.
 */
export function formatPriceDelta(from: number, to: number): string {
  const delta = to - from
  const sign = delta >= 0 ? '+' : '−'
  const absolute = `${sign}${Math.abs(delta).toFixed(2)}`

  if (from === 0) return absolute

  const percent = (Math.abs(delta) / Math.abs(from)) * 100
  return `${absolute} (${sign}${percent.toFixed(2)}%)`
}

/** A duration in seconds as `2d 3h`, `1h 5m`, or `45m`. Coarsest two units only. */
export function formatDuration(seconds: number): string {
  const total = Math.abs(Math.round(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** The label a date-range drawing carries: bar count plus elapsed time. */
export function formatBarSpan(bars: number, seconds: number): string {
  const count = Math.abs(Math.round(bars))
  return `${count} ${count === 1 ? 'bar' : 'bars'} · ${formatDuration(seconds)}`
}

// --- Hit-testing geometry, all in CSS-pixel (media) coordinates ---

export function distanceToPoint(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y)
}

/** Perpendicular distance from a point to a finite line SEGMENT (not the infinite line). */
export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) return distanceToPoint(px, py, x1, y1)

  // Project the point onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  return distanceToPoint(px, py, x1 + t * dx, y1 + t * dy)
}

/** Distance to a horizontal ray's stroke: 0 if within the y-tolerance and at or right of its start x. */
export function distanceToRay(px: number, py: number, startX: number, y: number): number {
  if (px < startX) return distanceToPoint(px, py, startX, y)
  return Math.abs(py - y)
}

export function isInsideRect(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  return px >= left && px <= right && py >= top && py <= bottom
}

/** Distance to a rectangle's nearest EDGE — used so a click just inside a large rectangle still resolves sensibly. */
export function distanceToRectEdge(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)

  return Math.min(
    distanceToSegment(px, py, left, top, right, top),
    distanceToSegment(px, py, right, top, right, bottom),
    distanceToSegment(px, py, right, bottom, left, bottom),
    distanceToSegment(px, py, left, bottom, left, top),
  )
}
