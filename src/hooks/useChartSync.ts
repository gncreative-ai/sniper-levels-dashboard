import { useContext, useEffect, useRef, type RefObject } from 'react'
import type { BarData, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { ChartSyncContext } from '../contexts/ChartSyncContext'
import { priceByTime } from '../lib/chartSync'

/**
 * Registers a chart into the shared crosshair-sync group (spec §4.5) and keeps
 * its own price-at-time lookup current as its data changes.
 *
 * Call this once per chart component, in the component body, AFTER the effect
 * that creates the chart and series (declaration order, not JSX position —
 * React runs a component's effects in the order they're declared, so the
 * registration effect below runs only once chartRef/seriesRef are already
 * populated). SpotChart and LegChart both follow this ordering already for
 * their own "feed data" and "overlay lines" effects.
 */
export function useChartSync(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  data: readonly BarData<UTCTimestamp>[],
) {
  const group = useContext(ChartSyncContext)
  const priceMapRef = useRef<Map<UTCTimestamp, number>>(new Map())

  // Kept current without re-registering: mousemove fires far more often than
  // data changes, so lookups must be O(1) per event, not rebuilt on each one.
  useEffect(() => {
    priceMapRef.current = priceByTime(data)
  }, [data])

  useEffect(() => {
    if (!group) return

    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    return group.register({
      chart,
      series,
      getPriceAt: (time) => priceMapRef.current.get(time),
    })
    // chartRef/seriesRef are refs (stable identity, populated by the sibling
    // "create once" effect before this one runs); group is stable for the
    // life of the session view. Neither belongs in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group])
}
