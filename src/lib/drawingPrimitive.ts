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
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import {
  FIB_LEVELS,
  distanceToRay,
  distanceToRectEdge,
  distanceToSegment,
  fibLevelPrice,
  formatBarSpan,
  formatPriceDelta,
  isInsideRect,
  type Drawing,
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

const STYLE: Record<DrawingTool, { stroke: string; fill: string }> = {
  trendline: { stroke: '#38bdf8', fill: 'transparent' },
  ray: { stroke: '#38bdf8', fill: 'transparent' },
  rectangle: { stroke: '#a78bfa', fill: 'rgba(167, 139, 250, 0.12)' },
  fib: { stroke: '#f472b6', fill: 'transparent' },
  // Measurement tools are recoloured by direction at draw time (see
  // measurementColors) — these are the neutral fallbacks.
  priceRange: { stroke: '#34d399', fill: 'rgba(52, 211, 153, 0.12)' },
  dateRange: { stroke: '#60a5fa', fill: 'rgba(96, 165, 250, 0.12)' },
}

const UP = { stroke: '#34d399', fill: 'rgba(52, 211, 153, 0.14)' }
const DOWN = { stroke: '#f87171', fill: 'rgba(248, 113, 113, 0.14)' }

/** Price range reads green when the move is up and red when it is down, like TradingView. */
function measurementColors(drawing: Drawing): { stroke: string; fill: string } {
  if (drawing.tool !== 'priceRange') return STYLE[drawing.tool]
  return drawing.points[1]!.price >= drawing.points[0]!.price ? UP : DOWN
}

// Selection highlight, in-progress preview and label plate all come from the
// active theme: a near-white selection stroke is invisible on a light chart.

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

    const style = measurementColors(drawing)
    const stroke = selected ? this.primitive.ui().selected : style.stroke

    ctx.save()
    ctx.lineWidth = selected ? 2 : 1.5
    ctx.strokeStyle = stroke
    ctx.fillStyle = style.fill

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
        this.drawPriceRange(ctx, drawing, pts, stroke)
        break
      case 'dateRange':
        this.drawDateRange(ctx, drawing, pts, stroke)
        break
      case 'fib':
        this.drawFib(ctx, drawing, pts, paneWidth, stroke)
        break
    }

    drawHandles(ctx, drawing.tool === 'ray' ? [pts[0]!] : pts, stroke, selected)
    ctx.restore()
  }

  /** A box spanning the two anchors, with a vertical arrow and the move as text. */
  private drawPriceRange(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    stroke: string,
  ): void {
    const [a, b] = pts as [PixelPoint, PixelPoint]
    strokeBox(ctx, a, b)

    const midX = (a.x + b.x) / 2
    strokeLine(ctx, { x: midX, y: a.y }, { x: midX, y: b.y })
    drawArrowHead(ctx, midX, b.y, b.y >= a.y ? 1 : -1, stroke)

    const label = formatPriceDelta(drawing.points[0]!.price, drawing.points[1]!.price)
    drawLabel(ctx, label, midX, (a.y + b.y) / 2, stroke, this.primitive.ui().labelBackground)
  }

  /** A box spanning the two anchors, with a horizontal arrow and the span as text. */
  private drawDateRange(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    stroke: string,
  ): void {
    const [a, b] = pts as [PixelPoint, PixelPoint]
    strokeBox(ctx, a, b)

    const midY = (a.y + b.y) / 2
    strokeLine(ctx, { x: a.x, y: midY }, { x: b.x, y: midY })
    drawArrowHead(ctx, b.x, midY, b.x >= a.x ? 1 : -1, stroke, 'horizontal')

    // Bar count comes from logical indices so the overnight gap between the
    // previous session and today is not counted as elapsed bars.
    const bars = this.primitive.barsBetween(a.x, b.x)
    const seconds = drawing.points[1]!.time - drawing.points[0]!.time
    const label =
      bars === null ? formatBarSpan(0, seconds) : formatBarSpan(bars, seconds)

    drawLabel(ctx, label, (a.x + b.x) / 2, midY, stroke, this.primitive.ui().labelBackground)
  }

  private drawFib(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    pts: PixelPoint[],
    paneWidth: number,
    stroke: string,
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
      ctx.fillStyle = stroke
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
