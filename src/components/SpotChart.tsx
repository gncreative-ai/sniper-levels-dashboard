import { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { SpotCandle5m } from '../lib/types'
import type { ResolvedOverlay } from '../lib/overlays'
import { toChartTime } from '../lib/time'
import {
  CANDLE_SERIES_OPTIONS,
  LINE_STYLES,
  baseChartOptions,
  makeAutoscaleProvider,
} from '../lib/chartTheme'

/**
 * The active session's Nifty spot candles at 5-minute resolution, with the six
 * overlay reference lines drawn on the spot price scale.
 *
 * Replay is phase 6; cross-chart crosshair sync is phase 7.
 */
export function SpotChart({
  candles,
  overlays,
}: {
  candles: SpotCandle5m[]
  overlays: ResolvedOverlay[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  // On unmount React runs effect cleanups in definition order, so the chart is
  // disposed before the overlay cleanup below gets a chance to run. Removing a
  // price line from a series that no longer exists throws, so that cleanup
  // checks this first.
  const disposedRef = useRef(false)

  const data = useMemo<CandlestickData<UTCTimestamp>[]>(
    () =>
      candles.map((candle) => ({
        time: toChartTime(candle.epochSeconds),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    [candles],
  )

  // Created once. Rebuilding on every data change would throw away the user's
  // zoom and pan, which phase 7 has to build on.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      ...baseChartOptions(11),
      timeScale: { ...baseChartOptions(11).timeScale, rightOffset: 2, barSpacing: 8 },
    })
    const series = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS)

    chartRef.current = chart
    seriesRef.current = series
    disposedRef.current = false

    return () => {
      disposedRef.current = true
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    series.setData(data)

    // Each session is its own window, so frame it on every change rather than
    // leaving the viewport wherever the previous session left it.
    chart.timeScale().fitContent()
  }, [data])

  // Defined after the creation effect so the series already exists on mount.
  // Torn down and rebuilt wholesale rather than diffed: six lines at most.
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    // Re-applied with a fresh closure on every change: that is what invalidates
    // the cached range so the scale actually recomputes.
    series.applyOptions({
      autoscaleInfoProvider: makeAutoscaleProvider(overlays.map((overlay) => overlay.price)),
    })

    const lines: IPriceLine[] = overlays.map((overlay) =>
      series.createPriceLine({
        price: overlay.price,
        color: overlay.color,
        lineWidth: 1,
        lineStyle: LINE_STYLES[overlay.style],
        axisLabelVisible: true,
        title: overlay.title,
      }),
    )

    return () => {
      if (disposedRef.current) return
      for (const line of lines) series.removePriceLine(line)
    }
  }, [overlays])

  return <div ref={containerRef} className="h-full w-full" />
}
