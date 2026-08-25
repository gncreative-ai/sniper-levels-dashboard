import {
  LineStyle,
  type AutoscaleInfo,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { OverlayStyle } from './overlays'
import { CHART_UI, type Theme } from './theme'
import { formatIstDay, formatIstTime, fromChartTime } from './time'
import type { Timeframe } from './timeframe'

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

/**
 * Stroke width for the reference levels (overlays on spot, prev-close/high and
 * the sniper point on the legs).
 *
 * One definition for all five charts so they cannot drift apart. Lightweight
 * Charts types this as 1 | 2 | 3 | 4, so it is not a free number.
 */
export const LEVEL_LINE_WIDTH = 2

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

/** Upper bound on bar spacing, so a single candle cannot fill the pane. */
const MAX_BAR_SPACING = 60

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
      maxBarSpacing: MAX_BAR_SPACING,
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
 * The time-axis options that differ between timeframes.
 *
 * A daily candle is stamped at its session open, so the intraday formatter
 * would label every daily tick '09:15' — technically true and completely
 * useless. Applied as an option change rather than baked into the chart's
 * creation options, because switching timeframe must not rebuild the chart
 * (that would discard zoom, pan and any drawings on it).
 */
export function timeAxisOptions(timeframe: Timeframe): {
  timeScale: DeepPartial<ChartOptions['timeScale']>
  localization: DeepPartial<ChartOptions['localization']>
} {
  const daily = timeframe === '1D'

  return {
    timeScale: {
      timeVisible: !daily,
      tickMarkFormatter: (time: UTCTimestamp) =>
        daily ? formatIstDay(fromChartTime(time)) : formatIstTime(fromChartTime(time)),
    },
    localization: {
      timeFormatter: (time: UTCTimestamp) =>
        daily
          ? formatIstDay(fromChartTime(time))
          : `${formatIstTime(fromChartTime(time))} IST`,
    },
  }
}

/**
 * Frame a chart on its data — fit, then centre if the data cannot fill the pane.
 *
 * `fitContent` alone is not enough once `maxBarSpacing` binds. The daily
 * timeframe has two candles; fitting them across a 1300px pane would want a bar
 * spacing an order of magnitude past the cap, so the cap wins and the two
 * candles end up huddled against the right edge with the rest of the pane
 * empty, which reads as a broken chart rather than a zoomed-out one.
 *
 * So: fit first, and if the resulting range holds more slots than there are
 * bars, recentre it on the data at whatever spacing the fit settled on. Same
 * effect for any short session — the 12-bar Diwali Muhurat one included.
 */
export function frameContent(chart: IChartApi, barCount: number): void {
  const timeScale = chart.timeScale()
  timeScale.fitContent()

  if (barCount === 0) return

  // Predicted rather than measured. `fitContent` is deferred to the next paint,
  // so reading the visible range back on this tick returns the OLD range — and
  // acting on that reintroduces the previous timeframe's bar count, which is
  // the bug this function exists to avoid.
  const capacity = timeScale.width() / MAX_BAR_SPACING
  if (capacity <= barCount) return

  const centre = (barCount - 1) / 2
  timeScale.setVisibleLogicalRange({ from: centre - capacity / 2, to: centre + capacity / 2 })
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
