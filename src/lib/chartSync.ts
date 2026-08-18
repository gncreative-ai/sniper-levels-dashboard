import type {
  BarData,
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'

/**
 * Cross-chart crosshair synchronisation (spec §4.5): hovering any one of the
 * five charts — main spot plus the four legs — shows the matching time
 * position on all the others.
 *
 * The mechanism is the standard one for this library: each chart's
 * `subscribeCrosshairMove` drives `chart.setCrosshairPosition()` on every
 * other chart. The one real complication is price. `setCrosshairPosition`
 * takes a price, and the hovered chart's own price (a spot index level, or one
 * leg's premium) is meaningless on a chart with a completely different scale —
 * forwarding it verbatim would place the horizontal line off-screen or at a
 * nonsensical height on the other four panels. So each chart supplies its own
 * `getPriceAt(time)`, and every target uses ITS OWN price at that instant,
 * never the origin's.
 *
 * `Time` is the library's own union (UTCTimestamp | BusinessDay | string);
 * this app only ever feeds it UTCTimestamp values (see lib/time.ts), so the
 * cast where a `Time` from the library crosses into our own UTCTimestamp-typed
 * lookups is asserting an invariant this app already holds everywhere else,
 * not introducing a new one.
 *
 * This module is pure and framework-agnostic on purpose — it does not know
 * about React. The hook that adapts it lives in useChartSync.ts.
 */

export interface SyncedChart {
  chart: IChartApi
  series: ISeriesApi<'Candlestick'>
  /** This chart's own close price at a given chart-time, or undefined if it has no bar there. */
  getPriceAt: (time: UTCTimestamp) => number | undefined
}

export interface ChartSyncGroup {
  /** Register a chart into the group. Call the returned function to leave it. */
  register: (member: SyncedChart) => () => void
}

/** One group per session view — see useChartSync.ts for where it is created. */
export function createChartSyncGroup(): ChartSyncGroup {
  const members = new Set<SyncedChart>()

  function broadcast(origin: SyncedChart, time: Time | undefined) {
    const chartTime = time as UTCTimestamp | undefined

    for (const member of members) {
      if (member === origin) continue

      const price = chartTime === undefined ? undefined : member.getPriceAt(chartTime)

      if (chartTime === undefined || price === undefined) {
        member.chart.clearCrosshairPosition()
      } else {
        member.chart.setCrosshairPosition(price, chartTime, member.series)
      }
    }
  }

  return {
    register(member) {
      members.add(member)

      const onMove = (param: MouseEventParams<Time>) => {
        broadcast(member, param.time)
      }

      member.chart.subscribeCrosshairMove(onMove)

      return () => {
        member.chart.unsubscribeCrosshairMove(onMove)
        members.delete(member)
      }
    },
  }
}

/** Builds the O(1) time→close lookup a chart hands the sync group as `getPriceAt`. */
export function priceByTime(data: readonly BarData<UTCTimestamp>[]): Map<UTCTimestamp, number> {
  const map = new Map<UTCTimestamp, number>()
  for (const bar of data) map.set(bar.time, bar.close)
  return map
}
