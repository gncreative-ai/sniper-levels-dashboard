import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { LegSeries } from '../lib/legs'
import { toChartTime } from '../lib/time'
import {
  CANDLE_SERIES_OPTIONS,
  LINE_STYLES,
  baseChartOptions,
  makeAutoscaleProvider,
} from '../lib/chartTheme'
import type { OverlayStyle } from '../lib/overlays'

/**
 * One option leg's premium chart: previous session and active session in a
 * single continuous series, with the boundary between them marked.
 *
 * Deliberately one parameterised component rather than four near-identical
 * ones — the legs differ only in which contract they show and whether the
 * sniper level applies.
 *
 * The prior-day portion is always drawn in full and is never subject to replay
 * (phase 6): prior-day thresholds are known before the session starts, and only
 * today's action is what unfolds.
 */

/** Per spec §4.4, drawn on this leg's own premium scale. */
interface LegLine {
  price: number
  color: string
  style: OverlayStyle
  title: string
}

export function LegChart({ leg }: { leg: LegSeries }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const disposedRef = useRef(false)

  /** X position of the first bar of the active session, in container pixels. */
  const [dividerX, setDividerX] = useState<number | null>(null)

  const data = useMemo<CandlestickData<UTCTimestamp>[]>(
    () =>
      [...leg.prevBars, ...leg.todayBars].map((bar) => ({
        time: toChartTime(bar.epochSeconds),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    [leg.prevBars, leg.todayBars],
  )

  const firstTodayTime = useMemo(() => {
    const first = leg.todayBars[0]
    return first ? toChartTime(first.epochSeconds) : null
  }, [leg.todayBars])

  const lines = useMemo<LegLine[]>(() => {
    const result: LegLine[] = []

    // This contract's own prior-session values, derived from the prev-day bars.
    if (leg.prevClose !== null) {
      result.push({ price: leg.prevClose, color: '#60a5fa', style: 'solid', title: 'P.Close' })
    }
    if (leg.prevHigh !== null) {
      result.push({ price: leg.prevHigh, color: '#93c5fd', style: 'dashed', title: 'P.High' })
    }
    // ATM legs only, and null when the batch has no sniper point.
    if (leg.sniperLevel !== null) {
      result.push({ price: leg.sniperLevel, color: '#fbbf24', style: 'dashed', title: 'Sniper' })
    }

    return result
  }, [leg.prevClose, leg.prevHigh, leg.sniperLevel])

  const repositionDivider = useCallback(() => {
    const chart = chartRef.current
    if (!chart || firstTodayTime === null) {
      setDividerX(null)
      return
    }

    const x = chart.timeScale().timeToCoordinate(firstTodayTime)
    setDividerX(x === null ? null : x)
  }, [firstTodayTime])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const base = baseChartOptions(9)
    const chart = createChart(container, {
      ...base,
      timeScale: { ...base.timeScale, rightOffset: 1, barSpacing: 3 },
      rightPriceScale: { ...base.rightPriceScale, scaleMargins: { top: 0.12, bottom: 0.12 } },
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
    chart.timeScale().fitContent()
    repositionDivider()
  }, [data, repositionDivider])

  // The divider is an HTML overlay because Lightweight Charts has no vertical
  // line primitive. It therefore has to be re-placed whenever the time scale
  // moves — zoom, pan, or resize.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleLogicalRangeChange(repositionDivider)

    const observer = new ResizeObserver(repositionDivider)
    if (containerRef.current) observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (disposedRef.current) return
      timeScale.unsubscribeVisibleLogicalRangeChange(repositionDivider)
    }
  }, [repositionDivider])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    series.applyOptions({
      autoscaleInfoProvider: makeAutoscaleProvider(lines.map((line) => line.price)),
    })

    const priceLines: IPriceLine[] = lines.map((line) =>
      series.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 1,
        lineStyle: LINE_STYLES[line.style],
        axisLabelVisible: false,
        title: line.title,
      }),
    )

    return () => {
      if (disposedRef.current) return
      for (const priceLine of priceLines) series.removePriceLine(priceLine)
    }
  }, [lines])

  return (
    <div className="relative h-full w-full">
      {/* Shades the prior session so "what the market already knew" reads as
          distinct from "what is unfolding", per spec §4.1. Sits under the
          chart's own canvas so it never intercepts pointer events. */}
      {dividerX !== null && dividerX > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 border-r border-dashed border-zinc-500/70 bg-zinc-100/[0.035]"
          style={{ width: `${dividerX}px` }}
        />
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
