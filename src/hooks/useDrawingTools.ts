import { useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { DrawingToolContext } from '../contexts/DrawingToolContext'
import { ThemeContext } from '../contexts/ThemeContext'
import { DrawingsPrimitive, type PendingDrawing } from '../lib/drawingPrimitive'
import {
  TOOL_POINT_COUNT,
  defaultStyle,
  makeDrawingId,
  snapToBar,
  type Bar,
  type Drawing,
  type Point,
} from '../lib/drawings'

/**
 * Wires one chart into the drawing-tools system (spec §4.5): attaches its
 * DrawingsPrimitive, keeps that primitive's state in sync with React state,
 * and turns pointer input into create / select / move / reshape / delete.
 *
 * Two different input mechanisms, for two different reasons:
 *
 * - Placing a new drawing uses the chart's own subscribeClick /
 *   subscribeCrosshairMove — click-click, not click-drag. That sidesteps a real
 *   conflict, since a mousedown-drag on the chart is also how the chart pans
 *   natively, and it reuses the two event APIs phase 7's crosshair sync proved.
 * - Moving or reshaping an existing drawing genuinely needs a drag, so it uses
 *   DOM mousedown/mousemove/mouseup and suppresses the chart's own pan for the
 *   duration (handleScroll/handleScale off, restored on release). Pane
 *   coordinates come from the chart element's bounding rect, which is verified
 *   to share its origin with the pane canvas.
 *
 * `resetKey` clears drawings when the underlying chart's data stops matching
 * them — same reasoning and same pattern as useReplay's resetKey. The caller
 * decides what invalidates a drawing: SpotChart's data doesn't change with the
 * ATM batch, so its key is the session alone; a leg's contract does change with
 * the batch, so LegChart's key includes it too.
 *
 * Call this once per chart, in the component body, AFTER the effect that
 * creates the chart and series — same ordering requirement as useChartSync.
 */
export function useDrawingTools(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  bars: readonly Bar[],
  resetKey: string,
) {
  const { theme } = useContext(ThemeContext)
  const toolState = useContext(DrawingToolContext)
  const activeTool = toolState?.activeTool ?? 'none'
  const magnet = toolState?.magnet ?? false

  const primitiveRef = useRef<DrawingsPrimitive | null>(null)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDrawing | null>(null)

  // Mirrors of state read inside handlers that must not be in an effect's
  // dependency array (constant resubscription) and must not read a nested
  // setState updater's `current` to decide whether to fire ANOTHER setState —
  // see the fix note below, on the same nested-setState bug useReplay hit.
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  const selectedIdRef = useRef(selectedId)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  // Read at event time rather than resubscribing every time the data or the
  // magnet toggle changes.
  const barsRef = useRef(bars)
  useEffect(() => {
    barsRef.current = bars
  }, [bars])

  const magnetRef = useRef(magnet)
  useEffect(() => {
    magnetRef.current = magnet
  }, [magnet])

  // Read by the drag handlers so the drag effect does NOT have to depend on
  // `drawings`. It used to, and that was a real bug: a drag calls setDrawings
  // on every mousemove, which changed the dependency, which tore the effect
  // down and re-ran it — and its cleanup clears dragRef, so the drag died
  // after the very first mouse movement and the drawing stopped following the
  // pointer. Mirroring the array keeps the subscription stable for the whole
  // gesture.
  const drawingsRef = useRef(drawings)
  useEffect(() => {
    drawingsRef.current = drawings
  }, [drawings])

  /**
   * The drawing whose settings dialog is open, plus the snapshot taken when it
   * opened. Edits apply live so the chart previews them, which means Cancel
   * needs something to restore — that is what the snapshot is for.
   */
  const [editing, setEditing] = useState<{ id: string; original: Drawing } | null>(null)

  const openEditor = useCallback((id: string) => {
    const drawing = drawingsRef.current.find((d) => d.id === id)
    if (!drawing) return
    setSelectedId(id)
    setEditing({ id, original: drawing })
  }, [])

  const closeEditor = useCallback(() => setEditing(null), [])

  const cancelEditor = useCallback(() => {
    const snapshot = editing
    if (!snapshot) return
    setDrawings((list) => list.map((d) => (d.id === snapshot.id ? snapshot.original : d)))
    setEditing(null)
  }, [editing])

  /** Live-apply a change from the dialog. */
  const updateDrawing = useCallback((id: string, patch: Partial<Drawing>) => {
    setDrawings((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  const dragRef = useRef<DragState | null>(null)
  /** A drag ends in a click event too; that click must not re-run selection. */
  const suppressClickRef = useRef(false)

  // The chart data this drawing set was anchored to no longer matches —
  // see the module comment on why this differs between spot and leg charts.
  useEffect(() => {
    setDrawings([])
    setSelectedId(null)
    setPending(null)
    setEditing(null)
  }, [resetKey])

  // A dialog open on a drawing that no longer exists (deleted with the keyboard
  // while it was open) would edit nothing and never close.
  useEffect(() => {
    if (editing && !drawings.some((d) => d.id === editing.id)) setEditing(null)
  }, [drawings, editing])

  // Switching tools (including to/from 'none') abandons any half-placed
  // drawing rather than leaving a dangling first point behind.
  useEffect(() => {
    setPending(null)
  }, [activeTool])

  // Attached once the series exists — declared after the chart-creation
  // effect in the calling component, same ordering as useChartSync.
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    const primitive = new DrawingsPrimitive()
    series.attachPrimitive(primitive)
    primitiveRef.current = primitive

    return () => {
      // Deliberately NOT calling series.detachPrimitive(primitive) here.
      // This effect has empty deps, so its cleanup only ever runs paired with
      // the chart-creation effect's own cleanup (chart.remove()), which fully
      // disposes the chart, its series, and any attached primitives anyway.
      // An explicit detach call on a series that's about to be torn down
      // schedules an internal redraw inside lightweight-charts that can fire
      // (via requestAnimationFrame) after chart.remove() has already disposed
      // the underlying canvas bindings, throwing an uncaught "Object is
      // disposed" error. Reproduced via a leg whose option-candle count drops
      // to zero on an ATM batch switch, unmounting its LegChart mid-flight —
      // skipping the redundant detach removes the trigger entirely.
      primitiveRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    primitiveRef.current?.setDrawings(drawings)
  }, [drawings])

  useEffect(() => {
    primitiveRef.current?.setSelectedId(selectedId)
  }, [selectedId])

  useEffect(() => {
    primitiveRef.current?.setPending(pending)
  }, [pending])

  useEffect(() => {
    primitiveRef.current?.setTheme(theme)
  }, [theme])

  // Delete the selected drawing, or cancel a half-placed one, on Escape/Delete.
  //
  // Each branch below is two independent, top-level setState calls rather
  // than one nested inside the other's updater. React's Strict Mode
  // double-invokes updater functions in development to catch exactly that
  // pattern: a setState nested inside another updater is a side effect, and
  // side effects fire on both invocations. useReplay (phase 6) hit this
  // directly — a nested setPosition inside setArmed's updater doubled every
  // step. The same shape here would have double-added or double-filtered
  // drawings; filter happens to be idempotent so it would not even have been
  // visible as a bug, which is exactly why the rule is structural (never
  // nest) rather than "fix it if the symptom shows up".
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPending(null)
        setSelectedId(null)
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      const current = selectedIdRef.current
      if (!current) return

      setDrawings((list) => list.filter((d) => d.id !== current))
      setSelectedId(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // --- Placement: the chart's own click / crosshair events ---
  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    function toPoint(param: MouseEventParams<Time>): Point | null {
      if (param.time === undefined || !param.point) return null
      const price = series!.coordinateToPrice(param.point.y)
      if (price === null) return null

      const raw = { time: param.time as UTCTimestamp, price }
      return magnetRef.current ? snapToBar(barsRef.current, raw) : raw
    }

    function handleClick(param: MouseEventParams<Time>) {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }

      if (activeTool === 'none') {
        // Hit-tested directly against the primitive rather than trusting
        // param.hoveredInfo to have propagated a series-primitive hit through
        // to a click event — that wiring isn't something this app has
        // proven at runtime, whereas this hitTest call is the exact method
        // this module already implements and controls.
        const point = param.point
        const hit = point ? primitiveRef.current?.hitTest(point.x, point.y) : null
        const hitId = hit?.externalId
        setSelectedId(typeof hitId === 'string' ? hitId : null)
        return
      }

      const point = toPoint(param)
      if (!point) return

      const points = [...(pendingRef.current?.points ?? []), point]
      const needed = TOOL_POINT_COUNT[activeTool]

      if (points.length < needed) {
        setPending({ tool: activeTool, points, cursor: point })
        return
      }

      // Commit — two independent top-level calls, neither nested in the
      // other's updater (see the module comment on the keydown handler).
      setDrawings((list) => [
        ...list,
        { id: makeDrawingId(), tool: activeTool, points, style: defaultStyle(activeTool, points) },
      ])
      setPending(null)
    }

    function handleMove(param: MouseEventParams<Time>) {
      const point = toPoint(param)
      setPending((current) => (current ? { ...current, cursor: point } : current))
    }

    function handleDoubleClick(param: MouseEventParams<Time>) {
      if (activeTool !== 'none' || !param.point) return

      const hit = primitiveRef.current?.hitTest(param.point.x, param.point.y)
      if (typeof hit?.externalId === 'string') openEditor(hit.externalId)
    }

    chart.subscribeClick(handleClick)
    chart.subscribeCrosshairMove(handleMove)
    chart.subscribeDblClick(handleDoubleClick)

    return () => {
      chart.unsubscribeClick(handleClick)
      chart.unsubscribeCrosshairMove(handleMove)
      chart.unsubscribeDblClick(handleDoubleClick)
    }
  }, [chartRef, seriesRef, activeTool, openEditor])

  // --- Editing: drag a whole drawing, or one of its anchor handles ---
  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    const element = chart.chartElement()

    /** Pane coordinates for a pointer event. Verified: the chart element's
     *  bounding-rect origin is the pane canvas origin, so no axis offset. */
    function toPane(event: MouseEvent): { x: number; y: number } {
      const rect = element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    /** A pane pixel back to an anchor, with magnet applied when it's on. */
    function toAnchor(x: number, y: number): Point | null {
      const time = chart!.timeScale().coordinateToTime(x)
      const price = series!.coordinateToPrice(y)
      if (time === null || price === null) return null

      const raw = { time: time as UTCTimestamp, price }
      return magnetRef.current ? snapToBar(barsRef.current, raw) : raw
    }

    function onMouseDown(event: MouseEvent) {
      // Clear the suppression flag at the START of every new gesture, rather
      // than relying on a click arriving to consume it. Lightweight Charts
      // does not emit a click after a drag that actually moved, so a flag set
      // on mouseup could otherwise survive indefinitely and swallow the next
      // genuine click — which showed up as the tool after a drag silently
      // losing its first placement click and never committing a drawing.
      suppressClickRef.current = false

      // Placement owns the pointer while a tool is armed; only the cursor
      // tool edits existing drawings.
      if (event.button !== 0 || activeTool !== 'none') return

      const primitive = primitiveRef.current
      if (!primitive) return

      const { x, y } = toPane(event)

      // The gear sits on top of everything, so it is tested first: a click
      // there means "open settings", not "start dragging".
      const gearId = primitive.hitTestGear(x, y)
      if (gearId) {
        openEditor(gearId)
        return
      }

      // A handle beats the body: grabbing an endpoint reshapes, grabbing
      // anywhere else on the same drawing moves the whole thing.
      const handle = primitive.hitTestHandle(x, y)
      const body = handle ? null : primitive.hitTest(x, y)

      const id = handle?.id ?? (typeof body?.externalId === 'string' ? body.externalId : null)
      if (id === null) return

      const drawing = drawingsRef.current.find((d) => d.id === id)
      if (!drawing) return

      const startPixels = drawing.points.map((p) => primitive.toPixel(p))
      if (startPixels.some((p) => p === null)) return

      dragRef.current = {
        id,
        handleIndex: handle ? handle.index : null,
        startPoints: drawing.points,
        startPixels: startPixels as { x: number; y: number }[],
        originX: x,
        originY: y,
        moved: false,
      }

      setSelectedId(id)

      // Suppress the chart's own pan for the duration of the drag. Registered
      // in the capture phase so this runs before Lightweight Charts' own
      // mousedown handler reads the option.
      chart!.applyOptions({ handleScroll: false, handleScale: false })
    }

    function onMouseMove(event: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return

      const { x, y } = toPane(event)
      drag.moved = true

      const next =
        drag.handleIndex === null
          ? moveWhole(drag, x, y, toAnchor)
          : reshape(drag, x, y, toAnchor)

      // A drag past the edge of the pane has no valid anchor; hold the last
      // good geometry rather than collapsing the drawing.
      if (!next) return

      setDrawings((list) => list.map((d) => (d.id === drag.id ? { ...d, points: next } : d)))
    }

    function onMouseUp() {
      const drag = dragRef.current
      if (!drag) return

      suppressClickRef.current = drag.moved
      dragRef.current = null
      chart!.applyOptions({ handleScroll: true, handleScale: true })
    }

    element.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      element.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      // Only restore scrolling if a drag actually left it disabled AND the
      // chart still exists; on unmount the chart is being removed anyway.
      dragRef.current = null
    }
    // Deliberately NOT depending on `drawings` — see drawingsRef above.
    // Deliberately NOT depending on `drawings` — see drawingsRef above.
  }, [chartRef, seriesRef, activeTool, openEditor])

  const editingDrawing = editing ? drawings.find((d) => d.id === editing.id) ?? null : null

  return {
    drawingCount: drawings.length,
    hasSelection: selectedId !== null,
    /** The drawing being edited, or null when the dialog is closed. */
    editingDrawing,
    updateDrawing,
    closeEditor,
    cancelEditor,
  }
}

interface DragState {
  id: string
  /** null when dragging the whole drawing rather than one anchor. */
  handleIndex: number | null
  startPoints: Point[]
  startPixels: { x: number; y: number }[]
  originX: number
  originY: number
  moved: boolean
}

type ToAnchor = (x: number, y: number) => Point | null

/**
 * Translate every anchor by the pointer's pixel delta.
 *
 * Done in pixel space and converted back per point, rather than by adding a
 * time delta to each timestamp. The time axis is not linear here — the leg
 * charts concatenate the previous session onto today, so there is an overnight
 * gap in the middle — and shifting by wall-clock time would stretch a drawing
 * that straddles it. A pixel delta moves what the user actually sees.
 */
function moveWhole(drag: DragState, x: number, y: number, toAnchor: ToAnchor): Point[] | null {
  const dx = x - drag.originX
  const dy = y - drag.originY

  const moved: Point[] = []
  for (const pixel of drag.startPixels) {
    const point = toAnchor(pixel.x + dx, pixel.y + dy)
    if (!point) return null
    moved.push(point)
  }

  return moved
}

/** Move the grabbed anchor only, leaving the others where they are. */
function reshape(drag: DragState, x: number, y: number, toAnchor: ToAnchor): Point[] | null {
  const point = toAnchor(x, y)
  if (!point) return null

  return drag.startPoints.map((original, index) =>
    index === drag.handleIndex ? point : original,
  )
}
