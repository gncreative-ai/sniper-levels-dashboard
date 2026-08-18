import type { OptionCandle5m, SpotCandle5m } from './types'

/**
 * Replay reveals the active session progressively (spec §4.2).
 *
 * Position is tracked as a count of revealed *spot* bars, because the spot
 * chart is what the position readout refers to. It cannot be reused as an index
 * into the leg charts: a session has 75 spot bars but 77 option bars, since the
 * option feed runs to 15:35 IST while spot stops at 15:25. Revealing "bar n" on
 * every chart by index would drift the legs ahead of spot by two bars near the
 * close.
 *
 * So the spot position is converted to a cutoff *instant*, and every chart
 * reveals the bars at or before it. That stays correct no matter how the feeds
 * differ in length or alignment.
 */

/** Reveal nothing at all. */
const REVEAL_NONE = Number.NEGATIVE_INFINITY
/** Reveal everything, including option bars past the last spot bar. */
const REVEAL_ALL = Number.POSITIVE_INFINITY

export function computeRevealCutoff(spotCandles: SpotCandle5m[], revealedCount: number): number {
  if (revealedCount <= 0) return REVEAL_NONE

  // At the end, reveal everything — otherwise the option bars after 15:25 could
  // never appear, and a "complete" replay would quietly omit them.
  if (revealedCount >= spotCandles.length) return REVEAL_ALL

  const lastRevealed = spotCandles[revealedCount - 1]
  return lastRevealed ? lastRevealed.epochSeconds : REVEAL_NONE
}

/** Whether the whole session is on screen — replay idle, or run to completion. */
export function isFullyRevealed(cutoff: number): boolean {
  return cutoff === REVEAL_ALL
}

export function revealNothing(cutoff: number): boolean {
  return cutoff === REVEAL_NONE
}

/** Bars at or before the cutoff. Prev-day bars never pass through here. */
export function barsUpTo<T extends { epochSeconds: number }>(bars: T[], cutoff: number): T[] {
  if (cutoff === REVEAL_ALL) return bars
  if (cutoff === REVEAL_NONE) return []
  return bars.filter((bar) => bar.epochSeconds <= cutoff)
}

/** Convenience for the leg charts, which only ever reveal their today portion. */
export function revealedTodayBars(todayBars: OptionCandle5m[], cutoff: number): OptionCandle5m[] {
  return barsUpTo(todayBars, cutoff)
}
