import { useContext, useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { CalendarDay } from '../lib/calendar'
import type { SpotCandle5m } from '../lib/types'
import { overlayColor, type ResolvedOverlay } from '../lib/overlays'
import { ThemeContext } from '../contexts/ThemeContext'
import { toChartTime } from '../lib/time'
import { useChartSync } from '../hooks/useChartSync'
import { useDrawingTools } from '../hooks/useDrawingTools'
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
 * Cross-chart crosshair sync (spec §4.5) is registered via useChartSync — see
 * that module for why each chart supplies its own price at a given time
 * rather than the hovered chart's price being forwarded directly. Draw tools
 * (spec §4.5, phase 8) are registered via useDrawingTools.
 */
export function SpotChart({
  candles,
  overlays,
  sessionDate,
}: {
  candles: SpotCandle5m[]
  overlays: ResolvedOverlay[]
  /**
   * Drawings reset when this changes. The spot chart's own data does not
   * change with the ATM batch (spec §4.3), so unlike LegChart this is the
   * session alone — a trend line drawn here stays valid across a batch
   * switch, since nothing about this chart's scale or bars changed.
   */
  sessionDate: CalendarDay
}) {
  const { theme } = useContext(ThemeContext)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  // On unmount React runs effect cleanups in definition order, so the chart is
  // disposed before the overlay cleanup below gets a chance to run. Removing a
  // price line from a series that no longer exists throws, so that cleanup
  // checks this first.
  const disposedRef = useRef(false)

  // The chart is created once and must not be rebuilt on a theme change (that
  // would discard zoom and pan), so the creation effect reads the theme through
  // a ref and a separate effect re-applies colours afterwards.
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

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

    const base = baseChartOptions(11, themeRef.current)
    const chart = createChart(container, {
      ...base,
      timeScale: { ...base.timeScale, barSpacing: 8 },
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

  // Repaint the chart chrome when the theme changes. Lightweight Charts draws
  // to a canvas and cannot inherit CSS, so every colour has to be handed back
  // to it explicitly.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const base = baseChartOptions(11, theme)
    chart.applyOptions({
      layout: base.layout,
      grid: base.grid,
      rightPriceScale: { borderColor: base.rightPriceScale?.borderColor },
      timeScale: { borderColor: base.timeScale?.borderColor },
      crosshair: base.crosshair,
    })
  }, [theme])

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
        color: overlayColor(overlay, theme),
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
  }, [overlays, theme])

  // Declared after the chart-creation effect above: React runs effects in
  // declaration order, so chartRef/seriesRef are already populated by the time
  // this one registers with the sync group.
  useChartSync(chartRef, seriesRef, data)
  // `data` doubles as the magnet's snap source — the same array the series is
  // drawn from, so a snapped point lands on a candle that is actually visible.
  useDrawingTools(chartRef, seriesRef, data, sessionDate)

  return <div ref={containerRef} className="h-full w-full" />
}
