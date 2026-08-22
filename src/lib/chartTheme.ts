import {
  LineStyle,
  type AutoscaleInfo,
  type ChartOptions,
  type DeepPartial,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { OverlayStyle } from './overlays'
import { CHART_UI, type Theme } from './theme'
import { formatIstTime, fromChartTime } from './time'

/**
 * Shared chart appearance and behaviour.
 *
 * The main spot chart and the four leg charts must look like one instrument
 * panel, and by phase 7 they have to cooperate on crosshair position too. One
 * definition here beats five drifting copies.
 */

/** Candle colours, unchanged across themes — both read correctly either way. */
export const CHART_COLORS = {
  up: '#10b981',
  down: '#ef4444',
} as const

export const MONO_FONT =
  'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace'

export const LINE_STYLES: Record<OverlayStyle, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
}

export const CANDLE_SERIES_OPTIONS = {
  upColor: CHART_COLORS.up,
  downColor: CHART_COLORS.down,
  borderUpColor: CHART_COLORS.up,
  borderDownColor: CHART_COLORS.down,
  wickUpColor: CHART_COLORS.up,
  wickDownColor: CHART_COLORS.down,
} as const

const priceFormat = (price: number) =>
  price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Base options for every chart in the dashboard.
 *
 * Times handed to the library are IST-shifted chart times, not instants — see
 * lib/time.ts. Formatters convert back before formatting so the displayed time
 * comes from one definition rather than relying on the shift twice.
 */
export function baseChartOptions(fontSize: number, theme: Theme): DeepPartial<ChartOptions> {
  const ui = CHART_UI[theme]

  return {
    autoSize: true,
    layout: {
      background: { color: 'transparent' },
      textColor: ui.text,
      fontFamily: MONO_FONT,
      fontSize,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: ui.grid },
      horzLines: { color: ui.grid },
    },
    rightPriceScale: {
      borderColor: ui.border,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: ui.border,
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time: UTCTimestamp) => formatIstTime(fromChartTime(time)),
      // Zoom/pan (spec §4.5). A lower bound on bar spacing still applies, so
      // bars cannot shrink sub-pixel and vanish, and an upper bound stops a
      // single candle filling the pane.
      //
      // The edges are deliberately NOT fixed. They were, in phase 7, which
      // pinned the visible range to the data and had a consequence that only
      // shows up in use: once zoomed out to fit, there was nothing further to
      // zoom out into and no empty space to pan across, so the chart felt
      // stuck at exactly one zoom-out limit. Leaving the edges free restores
      // TradingView's feel — scroll past the first and last bar, and keep
      // zooming out past fit — at the cost of being able to scroll the data
      // off-screen, which is recoverable and is the normal trade every
      // charting tool makes.
      minBarSpacing: 0.5,
      maxBarSpacing: 60,
      fixLeftEdge: false,
      fixRightEdge: false,
      // Breathing room past the last bar, so the most recent candle is not
      // jammed against the price axis.
      rightOffset: 6,
    },
    localization: {
      timeFormatter: (time: UTCTimestamp) => `${formatIstTime(fromChartTime(time))} IST`,
      priceFormatter: priceFormat,
    },
    crosshair: {
      mode: 0,
      vertLine: { color: ui.crosshair, labelBackgroundColor: ui.labelBackground },
      horzLine: { color: ui.crosshair, labelBackgroundColor: ui.labelBackground },
    },
    handleScroll: true,
    handleScale: true,
  }
}

/**
 * Widen the auto-scaled price range to include the overlay levels.
 *
 * Price lines do not participate in autoscale on their own, so a level outside
 * the series' own high and low is simply drawn off-screen. That is precisely
 * the case that matters: an 'after' batch band can sit well above the day's
 * range, and an invisible line reads as though nothing was drawn at all.
 *
 * Letting the candles compress is the right trade — how far price sat from a
 * level IS the observation this dashboard exists to support.
 */
export function makeAutoscaleProvider(prices: number[]) {
  return (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
    const base = original()
    if (!base?.priceRange || prices.length === 0) return base

    return {
      ...base,
      priceRange: {
        minValue: Math.min(base.priceRange.minValue, ...prices),
        maxValue: Math.max(base.priceRange.maxValue, ...prices),
      },
    }
  }
}
