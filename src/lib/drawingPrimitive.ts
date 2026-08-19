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
  isInsideRect,
  type Drawing,
  type DrawingTool,
  type Point,
} from './drawings'

/**
 * Renders drawings (spec §4.5) directly into a chart's own canvas stack via
 * the Series Primitives API, and answers hit-tests for click-to-select.
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

const STYLE: Record<DrawingTool, { stroke: string; fill: string }> = {
  trendline: { stroke: '#38bdf8', fill: 'transparent' },
  ray: { stroke: '#38bdf8', fill: 'transparent' },
  rectangle: { stroke: '#a78bfa', fill: 'rgba(167, 139, 250, 0.12)' },
  fib: { stroke: '#f472b6', fill: 'transparent' },
}

const SELECTED_STROKE = '#f4f4f5'
const PENDING_STROKE = 'rgba(244, 244, 245, 0.55)'

export interface PendingDrawing {
  tool: DrawingTool
  /** Points confirmed so far by click; always fewer than the tool needs. */
  points: Point[]
  /** Live cursor position, shown as the not-yet-confirmed next point. */
  cursor: Point | null
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
      case 'rectangle': {
        const edge = distanceToRectEdge(x, y, pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y)
        // A click anywhere inside a rectangle selects it, not just on its border.
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

    const style = STYLE[drawing.tool]
    const stroke = selected ? SELECTED_STROKE : style.stroke

    ctx.save()
    ctx.lineWidth = selected ? 2 : 1.5
    ctx.strokeStyle = stroke
    ctx.fillStyle = style.fill

    switch (drawing.tool) {
      case 'trendline':
        strokeLine(ctx, pts[0]!, pts[1]!)
        drawHandles(ctx, pts, stroke, selected)
        break
      case 'ray':
        strokeLine(ctx, pts[0]!, { x: paneWidth, y: pts[0]!.y })
        drawHandles(ctx, [pts[0]!], stroke, selected)
        break
      case 'rectangle':
        ctx.fillRect(
          Math.min(pts[0]!.x, pts[1]!.x),
          Math.min(pts[0]!.y, pts[1]!.y),
          Math.abs(pts[1]!.x - pts[0]!.x),
          Math.abs(pts[1]!.y - pts[0]!.y),
        )
        ctx.strokeRect(
          Math.min(pts[0]!.x, pts[1]!.x),
          Math.min(pts[0]!.y, pts[1]!.y),
          Math.abs(pts[1]!.x - pts[0]!.x),
          Math.abs(pts[1]!.y - pts[0]!.y),
        )
        drawHandles(ctx, pts, stroke, selected)
        break
      case 'fib':
        this.drawFib(ctx, drawing, pts, paneWidth, stroke)
        break
    }

    ctx.restore()
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

    drawHandles(ctx, pts, stroke, false)
  }

  private drawPending(ctx: CanvasRenderingContext2D, pending: PendingDrawing, paneWidth: number): void {
    if (pending.points.length === 0) return

    const anchor = this.primitive.toPixel(pending.points[0]!)
    if (!anchor) return

    const cursor = pending.cursor ? this.primitive.toPixel(pending.cursor) : null

    ctx.save()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = PENDING_STROKE
    ctx.setLineDash([4, 4])

    if (pending.tool === 'ray') {
      strokeLine(ctx, anchor, { x: paneWidth, y: anchor.y })
    } else if (cursor) {
      if (pending.tool === 'rectangle') {
        ctx.strokeRect(
          Math.min(anchor.x, cursor.x),
          Math.min(anchor.y, cursor.y),
          Math.abs(cursor.x - anchor.x),
          Math.abs(cursor.y - anchor.y),
        )
      } else {
        strokeLine(ctx, anchor, cursor)
      }
    }

    ctx.setLineDash([])
    drawHandles(ctx, cursor ? [anchor, cursor] : [anchor], PENDING_STROKE, false)
    ctx.restore()
  }
}

function strokeLine(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
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
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
