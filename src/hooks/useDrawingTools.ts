import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { DrawingToolContext } from '../contexts/DrawingToolContext'
import { DrawingsPrimitive, type PendingDrawing } from '../lib/drawingPrimitive'
import { TOOL_POINT_COUNT, makeDrawingId, type Drawing, type Point } from '../lib/drawings'

/**
 * Wires one chart into the drawing-tools system (spec §4.5): attaches its
 * DrawingsPrimitive, keeps that primitive's state in sync with React state,
 * and turns chart clicks into create / select / delete actions.
 *
 * Interaction model is click-click, not click-drag: a tool needing two points
 * places the first on click one, previews live to the cursor via
 * subscribeCrosshairMove, and commits on click two. This reuses the exact two
 * event APIs Phase 7's crosshair sync already proved out, and — more
 * importantly — sidesteps a real conflict click-drag would have created: a
 * mousedown-drag gesture on the chart is also how the chart pans natively, so
 * a drag-to-draw gesture would fight the chart's own interaction.
 *
 * `resetKey` clears drawings when the underlying chart's data stops matching
 * them — same reasoning and same pattern as useReplay's resetKey. The caller
 * decides what invalidates a drawing: SpotChart's data doesn't change with
 * the ATM batch, so its key is the session alone; a leg's contract does
 * change with the batch, so LegChart's key includes it too.
 *
 * Call this once per chart, in the component body, AFTER the effect that
 * creates the chart and series — same ordering requirement as useChartSync.
 */
export function useDrawingTools(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  resetKey: string,
) {
  const toolState = useContext(DrawingToolContext)
  const activeTool = toolState?.activeTool ?? 'none'

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

  // The chart data this drawing set was anchored to no longer matches —
  // see the module comment on why this differs between spot and leg charts.
  useEffect(() => {
    setDrawings([])
    setSelectedId(null)
    setPending(null)
  }, [resetKey])

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

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    function toPoint(param: MouseEventParams<Time>): Point | null {
      if (param.time === undefined || !param.point) return null
      const price = series!.coordinateToPrice(param.point.y)
      if (price === null) return null
      return { time: param.time as UTCTimestamp, price }
    }

    function handleClick(param: MouseEventParams<Time>) {
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
      setDrawings((list) => [...list, { id: makeDrawingId(), tool: activeTool, points }])
      setPending(null)
    }

    function handleMove(param: MouseEventParams<Time>) {
      const point = toPoint(param)
      setPending((current) => (current ? { ...current, cursor: point } : current))
    }

    chart.subscribeClick(handleClick)
    chart.subscribeCrosshairMove(handleMove)

    return () => {
      chart.unsubscribeClick(handleClick)
      chart.unsubscribeCrosshairMove(handleMove)
    }
  }, [chartRef, seriesRef, activeTool])

  return { drawingCount: drawings.length, hasSelection: selectedId !== null }
}
