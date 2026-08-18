import { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { SpotCandle5m } from '../lib/types'
import { formatIstTime, fromChartTime, toChartTime } from '../lib/time'

/**
 * The active session's Nifty spot candles at 5-minute resolution.
 *
 * Phase 3 is the bare chart. Overlay reference lines and the ATM batch toggle
 * are phase 4; replay is phase 6; cross-chart crosshair sync is phase 7.
 *
 * Time axis: values handed to the library are IST-shifted chart times, not real
 * instants — see `lib/time.ts`. The tick and crosshair formatters convert back
 * before formatting so a single definition of "what time is this bar" is used
 * everywhere on screen.
 */

const COLORS = {
  up: '#10b981',
  down: '#ef4444',
  grid: '#27272a',
  border: '#3f3f46',
  text: '#a1a1aa',
  crosshair: '#71717a',
} as const

export function SpotChart({ candles }: { candles: SpotCandle5m[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

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

  // Create the chart once. Recreating it on every data change would throw away
  // the user's zoom and pan, which phase 7 has to build on.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: COLORS.text,
        fontFamily:
          'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        // A session is ~75 bars; a little breathing room at the right edge
        // keeps the last candle off the price scale.
        rightOffset: 2,
        barSpacing: 8,
        // Reads as IST because the value is already shifted; converting back
        // first keeps the formatting honest rather than relying on the shift.
        tickMarkFormatter: (time: UTCTimestamp) => formatIstTime(fromChartTime(time)),
      },
      localization: {
        timeFormatter: (time: UTCTimestamp) => `${formatIstTime(fromChartTime(time))} IST`,
        priceFormatter: (price: number) =>
          price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: COLORS.crosshair, labelBackgroundColor: '#18181b' },
        horzLine: { color: COLORS.crosshair, labelBackgroundColor: '#18181b' },
      },
      handleScroll: true,
      handleScale: true,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Feed data separately, so switching sessions swaps the series without
  // tearing down the chart instance.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    series.setData(data)

    // Each session is its own window, so frame it on every change rather than
    // leaving the viewport wherever the previous session left it.
    chart.timeScale().fitContent()
  }, [data])

  return <div ref={containerRef} className="h-full w-full" />
}
