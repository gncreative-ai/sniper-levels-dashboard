import type {
  CanvasRenderingTarget2D,
  MediaCoordinatesRenderingScope,
} from 'fancy-canvas'
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import {
  DASH_PATTERN,
  FIB_LEVELS,
  withAlpha,
  distanceToRay,
  distanceToRectEdge,
  distanceToSegment,
  fibLevelPrice,
  formatBarSpan,
  formatPriceDelta,
  isInsideRect,
  type Drawing,
  type DrawingStyle,
  type DrawingTool,
  type Point,
} from './drawings'
import { DRAWING_UI, type Theme } from './theme'

/**
 * Renders drawings (spec §4.5) directly into a chart's own canvas stack via
 * the Series Primitives API, and answers hit-tests for click-to-select and
 * drag-to-edit.
 *
 * One instance per chart, attached to that chart's candlestick series. Drawing
 * points are stored in (time, price) — converting to pixels happens here, on
 * every draw call, which is what keeps a drawing glued to the right place
 * through zoom, pan and resize without this class doing anything special for
 * any of those.
 *
 * State (drawings, selection, the in-progress pending drawing) is owned by
 * React in useDrawingTools — this class is a thin, mutable renderer that
 * React pushes updates into via the setters below, exactly like SpotChart
 * already pushes candle data into the series itself.
 */

const HIT_TOLERANCE_PX = 6

/** Anchor handles are grabbed more easily than they are drawn, deliberately. */
export const HANDLE_RADIUS_PX = 3.5
const HANDLE_GRAB_PX = 8

/** Which tools paint a filled body as well as a stroke. */
const FILLED: ReadonlySet<DrawingTool> = new Set<DrawingTool>([
  'rectangle',
  'priceRange',
  'dateRange',
])

const stroke = (style: DrawingStyle) => withAlpha(style.color, style.opacity)
const fill = (style: DrawingStyle) => withAlpha(style.color, style.opacity * 0.14)

/** The settings badge drawn beside a selected drawing. */
const GEAR_RADIUS_PX = 9
const GEAR_OFFSET_PX = 16

// The in-progress preview and the label plate come from the active theme: a
// near-white preview stroke is invisible on a light chart.

export interface PendingDrawing {
  tool: DrawingTool
  /** Points confirmed so far by click; always fewer than the tool needs. */
  points: Point[]
  /** Live cursor position, shown as the not-yet-confirmed next point. */
  cursor: Point | null
}

/** Which part of a drawing a pointer is over — drives move vs. reshape. */
export interface DrawingHandleHit {
  id: string
  /** Index into the drawing's own points array. */
  index: number
}

type PixelPoint = { x: number; y: number }

// This app only ever feeds UTCTimestamp values as Time (see lib/time.ts) —
// implementing against the library's own default (Time) is what actually
// matches ISeriesApi<'Candlestick'>'s real type, the same reasoning as chartSync.ts.
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null

  private drawings: Drawing[] = []
  private selectedId: string | null = null
  private pending: PendingDrawing | null = null
  private theme: Theme = 'dark'

  private readonly view = new DrawingsPaneView(this)

  attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.chart = param.chart as IChartApi
    this.series = param.series
    this.requestUpdate = param.requestUpdate
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }

  setDrawings(drawings: Drawing[]): void {
    this.drawings = drawings
    this.requestUpdate?.()
  }

  setSelectedId(id: string | null): void {
    this.selectedId = id
    this.requestUpdate?.()
  }

  setPending(pending: PendingDrawing | null): void {
    this.pending = pending
    this.requestUpdate?.()
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    this.requestUpdate?.()
  }

  /** Theme-dependent colours for the chrome around a drawing. */
  ui(): (typeof DRAWING_UI)[Theme] {
    return DRAWING_UI[this.theme]
  }

  /** Pixel position of a (time, price) point, or null if it has no visible coordinate right now. */
  toPixel(point: Point): PixelPoint | null {
    if (!this.chart || !this.series) return null

    const x = this.chart.timeScale().timeToCoordinate(point.time)
    const y = this.series.priceToCoordinate(point.price)
    if (x === null || y === null) return null

    return { x, y }
  }

  paneWidth(): number {
    return this.chart?.paneSize().width ?? 0
  }

  allDrawings(): readonly Drawing[] {
    return this.drawings
  }

  selected(): string | null {
    return this.selectedId
  }

  pendingDrawing(): PendingDrawing | null {
    return this.pending
  }

  /**
   * Whole bars between two pixel columns, via the time scale's logical index.
   *
   * Logical indices rather than clock arithmetic on the two timestamps: this
   * dashboard concatenates the previous session onto today, so there is a real
   * overnight gap in the middle of every leg chart. Wall-clock difference would
   * count that gap as elapsed bars; the logical index does not.
   */
  barsBetween(x1: number, x2: number): number | null {
    const timeScale = this.chart?.timeScale()
    if (!timeScale) return null

    const a = timeScale.coordinateToLogical(x1)
    const b = timeScale.coordinateToLogical(x2)
    if (a === null || b === null) return null

    return Math.abs(b - a)
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    let best: { id: string; distance: number } | null = null

    for (const drawing of this.drawings) {
      const distance = this.distanceTo(drawing, x, y)
      if (distance !== null && distance <= HIT_TOLERANCE_PX) {
        if (!best || distance < best.distance) best = { id: drawing.id, distance }
      }
    }

    if (!best) return null

    return {
      externalId: best.id,
      distance: best.distance,
      cursorStyle: 'pointer',
      zOrder: 'normal',
    }
  }

  /**
   * True when the pointer is over the selected drawing's settings gear.
   *
   * Checked before the handle and body hit-tests, since the gear is drawn on
   * top of them and a click there means "open settings", not "start a drag".
   */
  hitTestGear(x: number, y: number): string | null {
    const drawing = this.drawings.find((d) => d.id === this.selectedId)
    if (!drawing) return null

    const anchor = this.toPixel(drawing.points[0]!)
    if (!anchor) return null

    const centre = gearCentre(anchor)
    return Math.hypot(centre.x - x, centre.y - y) <= GEAR_RADIUS_PX ? drawing.id : null
  }

  /**
   * Price-axis tags for drawings whose style asks for one.
   *
   * Lightweight Charts calls this on every axis repaint, so it stays a cheap
   * map over the drawings rather than anything cached.
   */
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const views: ISeriesPrimitiveAxisView[] = []

    for (const drawing of this.drawings) {
      if (!drawing.style.priceLabel) continue

      for (const point of drawing.points) {
        const y = this.series?.priceToCoordinate(point.price)
        if (y === null || y === undefined) continue

        views.push(new DrawingPriceAxisView(y, point.price, drawing.style.color))
      }
    }

    return views
  }

  /**
   * The anchor handle under a pointer, if any.
   *
   * Only the selected drawing's handles are grabbable, matching what is drawn:
   * handles are rendered for the selection alone, and a control the user cannot
   * see should not be one they can accidentally catch.
   */
  hitTestHandle(x: number, y: number): DrawingHandleHit | null {
    const drawing = this.drawings.find((d) => d.id === this.selectedId)
    if (!drawing) return null

    let best: DrawingHandleHit | null = null
    let bestDistance = HANDLE_GRAB_PX

    drawing.points.forEach((point, index) => {
      const pixel = this.toPixel(point)
      if (!pixel) return

      const distance = Math.hypot(pixel.x - x, pixel.y - y)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = { id: drawing.id, index }
      }
    })

    return best
  }

  /** Distance from a screen point to a drawing's nearest visible geometry, in CSS pixels. */
  private distanceTo(drawing: Drawing, x: number, y: number): number | null {
    const pixels = drawing.points.map((p) => this.toPixel(p))
    if (pixels.some((p) => p === null)) return null
    const pts = pixels as PixelPoint[]

    switch (drawing.tool) {
      case 'trendline':
        return distanceToSegment(x, y, pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y)
      case 'ray':
        return distanceToRay(x, y, pts[0]!.x, pts[0]!.y)
      case 'rectangle':
      case 'priceRange':
      case 'dateRange': {
        const edge = distanceToRectEdge(x, y, pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y)
        // A click anywhere inside the box selects it, not just on its border.
        if (isInsideRect(x, y, pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y)) {
          return Math.min(edge, HIT_TOLERANCE_PX)
        }
        return edge
      }
      case 'fib': {
        const width = this.paneWidth()
        const [a, b] = pts as [PixelPoint, PixelPoint]
        const leftX = Math.min(a.x, b.x)
        let min = Infinity
        for (const fraction of FIB_LEVELS) {
          const price = fibLevelPrice(drawing.points[0]!.price, drawing.points[1]!.price, fraction)
          const y2 = this.series?.priceToCoordinate(price)
          if (y2 === null || y2 === undefined) continue
          min = Math.min(min, distanceToSegment(x, y, leftX, y2, width, y2))
        }
        return Number.isFinite(min) ? min : null
      }
      default:
        return null
    }
  }
}

/** One price tag on the axis, for a drawing with `priceLabel` enabled. */
class DrawingPriceAxisView implements ISeriesPrimitiveAxisView {
  private readonly y: number
  private readonly price: number
  private readonly color: string

  constructor(y: number, price: number, color: string) {
    this.y = y
    this.price = price
    this.color = color
  }

  coordinate(): number {
    return this.y
  }

  text(): string {
    return this.price.toFixed(2)
  }

  textColor(): string {
    // Dark text on light plates and vice versa, judged from the tag colour's
    // own luminance rather than from the app theme: the plate is the drawing's
    // colour, so that is what the text has to stay readable against.
    return isLight(this.color) ? '#18181b' : '#fafafa'
  }

  backColor(): string {
    return this.color
  }
}

/** Rough perceptual luminance of a `#rrggbb` colour. */
function isLight(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return false

  const value = parseInt(match[1]!, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

class DrawingsPaneView implements IPrimitivePaneView {
  private readonly primitive: DrawingsPrimitive

  constructor(primitive: DrawingsPrimitive) {
    this.primitive = primitive
  }

  renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        target.useMediaCoordinateSpace((scope) => this.drawAll(scope))
      },
    }
  }

  private drawAll(scope: MediaCoordinatesRenderingScope): void {
    const { context, mediaSize } = scope
    const selectedId = this.primitive.selected()

    for (const drawing of this.primitive.allDrawings()) {
      this.drawOne(context, drawing, mediaSize.width, drawing.id === selectedId)
    }

    const pending = this.primitive.pendingDrawing()
    if (pending) this.drawPending(context, pending, mediaSize.width)
  }

  private drawOne(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    paneWidth: number,
    selected: boolean,
  ): void {
    const pixels = drawing.points.map((p) => this.primitive.toPixel(p))
    if (pixels.some((p) => p === null)) return
    const pts = pixels as PixelPoint[]

    const style = drawing.style
    const ink = stroke(style)

    ctx.save()

    // Selection is shown as a translucent halo UNDER the drawing rather than by
    // recolouring it. Recolouring would hide the very colour the settings
    // dialog exists to change — and the dialog previews live, so the drawing
    // has to keep its own colour while it is selected and being edited.
    if (selected) {
      ctx.save()
      ctx.strokeStyle = withAlpha(this.primitive.ui().selected === '#f4f4f5' ? '#f4f4f5' : '#18181b', 0.35)
      ctx.lineWidth = style.width + 5
      ctx.setLineDash([])
      this.drawGeometry(ctx, drawing, pts, paneWidth, ink, true)
      ctx.restore()
    }

    ctx.lineWidth = style.width
    ctx.strokeStyle = ink
    ctx.fillStyle = FILLED.has(drawing.tool) ? fill(style) : 'transparent'
    ctx.setLineDash(DASH_PATTERN[style.lineStyle])

    this.drawGeometry(ctx, drawing, pts, paneWidth, ink, false)

    ctx.setLineDash([])
    drawHandles(ctx, drawing.tool === 'ray' ? [pts[0]!] : pts, ink, selected)

    if (selected) this.drawGearBadge(ctx, pts[0]!)

    ctx.restore()
  }

  /**
   * The tool's own shape, with whatever stroke/fill/dash the caller has set.
   *
   * Split out so the selection halo can re-run the exact same geometry with a
   * fatter, translucent stroke underneath — one definition of each shape rather
   * than two that can drift apart. `haloPass` suppresses the text and arrow
   * decorations, which would only smear under the real pass.
   */
  private drawGeometry(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    paneWidth: number,
    ink: string,
    haloPass: boolean,
  ): void {
    switch (drawing.tool) {
      case 'trendline':
        strokeLine(ctx, pts[0]!, pts[1]!)
        break
      case 'ray':
        strokeLine(ctx, pts[0]!, { x: paneWidth, y: pts[0]!.y })
        break
      case 'rectangle':
        strokeBox(ctx, pts[0]!, pts[1]!)
        break
      case 'priceRange':
        this.drawPriceRange(ctx, drawing, pts, ink, haloPass)
        break
      case 'dateRange':
        this.drawDateRange(ctx, drawing, pts, ink, haloPass)
        break
      case 'fib':
        this.drawFib(ctx, drawing, pts, paneWidth, ink, haloPass)
        break
    }
  }

  /** A small gear beside the selected drawing — the second way into settings. */
  private drawGearBadge(ctx: CanvasRenderingContext2D, anchor: PixelPoint): void {
    const { x, y } = gearCentre(anchor)
    const ui = this.primitive.ui()

    ctx.save()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(x, y, GEAR_RADIUS_PX, 0, Math.PI * 2)
    ctx.fillStyle = ui.labelBackground
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = ui.selected
    ctx.stroke()

    ctx.fillStyle = ui.selected
    ctx.font = '11px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('⚙', x, y + 0.5)
    ctx.restore()
  }

  /** A box spanning the two anchors, with a vertical arrow and the move as text. */
  private drawPriceRange(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    ink: string,
    haloPass: boolean,
  ): void {
    const [a, b] = pts as [PixelPoint, PixelPoint]
    strokeBox(ctx, a, b)

    const midX = (a.x + b.x) / 2
    strokeLine(ctx, { x: midX, y: a.y }, { x: midX, y: b.y })
    if (haloPass) return
    drawArrowHead(ctx, midX, b.y, b.y >= a.y ? 1 : -1, ink)

    const label = formatPriceDelta(drawing.points[0]!.price, drawing.points[1]!.price)
    drawLabel(ctx, label, midX, (a.y + b.y) / 2, ink, this.primitive.ui().labelBackground)
  }

  /** A box spanning the two anchors, with a horizontal arrow and the span as text. */
  private drawDateRange(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    ink: string,
    haloPass: boolean,
  ): void {
    const [a, b] = pts as [PixelPoint, PixelPoint]
    strokeBox(ctx, a, b)

    const midY = (a.y + b.y) / 2
    strokeLine(ctx, { x: a.x, y: midY }, { x: b.x, y: midY })
    if (haloPass) return
    drawArrowHead(ctx, b.x, midY, b.x >= a.x ? 1 : -1, ink, 'horizontal')

    // Bar count comes from logical indices so the overnight gap between the
    // previous session and today is not counted as elapsed bars.
    const bars = this.primitive.barsBetween(a.x, b.x)
    const seconds = drawing.points[1]!.time - drawing.points[0]!.time
    const label =
      bars === null ? formatBarSpan(0, seconds) : formatBarSpan(bars, seconds)

    drawLabel(ctx, label, (a.x + b.x) / 2, midY, ink, this.primitive.ui().labelBackground)
  }

  private drawFib(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    paneWidth: number,
    ink: string,
    haloPass: boolean,
  ): void {
    const leftX = Math.min(pts[0]!.x, pts[1]!.x)
    const fromPrice = drawing.points[0]!.price
    const toPrice = drawing.points[1]!.price

    ctx.font = '10px ui-monospace, monospace'
    ctx.textBaseline = 'bottom'

    for (const fraction of FIB_LEVELS) {
      const price = fibLevelPrice(fromPrice, toPrice, fraction)
      const y = this.primitive.toPixel({ time: drawing.points[0]!.time, price })?.y
      if (y === undefined) continue

      ctx.globalAlpha = fraction === 0 || fraction === 1 ? 0.9 : 0.55
      strokeLine(ctx, { x: leftX, y }, { x: paneWidth, y })

      ctx.globalAlpha = 1
      if (haloPass) continue
      ctx.fillStyle = ink
      ctx.fillText(`${(fraction * 100).toFixed(1)}%  ${price.toFixed(2)}`, leftX + 4, y - 2)
    }
  }

  private drawPending(ctx: CanvasRenderingContext2D, pending: PendingDrawing, paneWidth: number): void {
    if (pending.points.length === 0) return

    const anchor = this.primitive.toPixel(pending.points[0]!)
    if (!anchor) return

    const cursor = pending.cursor ? this.primitive.toPixel(pending.cursor) : null

    const pendingStroke = this.primitive.ui().pending

    ctx.save()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = pendingStroke
    ctx.setLineDash([4, 4])

    if (pending.tool === 'ray') {
      strokeLine(ctx, anchor, { x: paneWidth, y: anchor.y })
    } else if (cursor) {
      if (
        pending.tool === 'rectangle' ||
        pending.tool === 'priceRange' ||
        pending.tool === 'dateRange'
      ) {
        strokeBox(ctx, anchor, cursor)
      } else {
        strokeLine(ctx, anchor, cursor)
      }
    }

    ctx.setLineDash([])
    drawHandles(ctx, cursor ? [anchor, cursor] : [anchor], pendingStroke, false)
    ctx.restore()
  }
}

/** Where the settings gear sits relative to a drawing's first anchor. */
function gearCentre(anchor: PixelPoint): PixelPoint {
  return { x: anchor.x + GEAR_OFFSET_PX, y: anchor.y - GEAR_OFFSET_PX }
}

function strokeLine(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

/** Fill-then-stroke a rectangle defined by any two opposite corners. */
function strokeBox(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint): void {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const width = Math.abs(b.x - a.x)
  const height = Math.abs(b.y - a.y)

  ctx.fillRect(x, y, width, height)
  ctx.strokeRect(x, y, width, height)
}

/** A small solid triangle at the measuring end of a range arrow. */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: 1 | -1,
  color: string,
  axis: 'vertical' | 'horizontal' = 'vertical',
): void {
  const size = 5

  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()

  if (axis === 'vertical') {
    ctx.moveTo(x, y)
    ctx.lineTo(x - size * 0.6, y - size * direction)
    ctx.lineTo(x + size * 0.6, y - size * direction)
  } else {
    ctx.moveTo(x, y)
    ctx.lineTo(x - size * direction, y - size * 0.6)
    ctx.lineTo(x - size * direction, y + size * 0.6)
  }

  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Centred text on an opaque plate, so a measurement stays readable over candles. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  color: string,
  background: string,
): void {
  ctx.save()
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const width = ctx.measureText(text).width
  const padX = 4
  const height = 14

  ctx.fillStyle = background
  ctx.fillRect(centerX - width / 2 - padX, centerY - height / 2, width + padX * 2, height)

  ctx.fillStyle = color
  ctx.fillText(text, centerX, centerY)
  ctx.restore()
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  color: string,
  selected: boolean,
): void {
  if (!selected) return

  ctx.save()
  ctx.fillStyle = color
  for (const p of points) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, HANDLE_RADIUS_PX, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
