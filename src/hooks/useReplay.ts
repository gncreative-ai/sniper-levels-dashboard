import { useCallback, useEffect, useMemo, useState } from 'react'

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

/** Milliseconds per bar at 1x. Fast enough to review a session, slow enough to read. */
const BASE_INTERVAL_MS = 600

export interface Replay {
  /**
   * Whether replay has been engaged. Before the user's first Play, Step or
   * Reset, the session is shown in full — browsing 233 sessions should not
   * mean re-revealing each one bar by bar. The first replay action arms it;
   * from then on, per spec §4.3, every session or batch change resets to 0.
   */
  armed: boolean
  /** Spot bars revealed. Equals totalBars whenever armed is false. */
  revealedCount: number
  totalBars: number
  playing: boolean
  speed: ReplaySpeed
  atStart: boolean
  atEnd: boolean
  togglePlay: () => void
  step: () => void
  reset: () => void
  setSpeed: (speed: ReplaySpeed) => void
}

/**
 * Drives replay position.
 *
 * `resetKey` identifies what is being replayed — session and batch. Per spec
 * §4.3 both reset replay to bar 0 once armed. Keying on it rather than on
 * totalBars matters because consecutive sessions usually have identical bar
 * counts, so a length comparison would miss the change entirely.
 *
 * Every state setter call below sits at the top level of its callback, never
 * nested inside another setter's updater function. React's Strict Mode
 * double-invokes updater functions in development to catch impure ones, and a
 * setState call nested inside another updater is exactly that: a side effect
 * that then fires twice, silently advancing position by 2 instead of 1. The
 * fix is structural — updaters read closure values, they never call another
 * setter — not a one-off patch, so keep new callbacks to this shape too.
 */
export function useReplay(totalBars: number, resetKey: string): Replay {
  const [armed, setArmed] = useState(false)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<ReplaySpeed>(1)

  // Once armed, a session or batch change snaps back to bar 0 (spec §4.3).
  // Unarmed, this is a no-op: the session is shown in full regardless of
  // resetKey, so there is nothing to reset.
  useEffect(() => {
    if (!armed) return
    setPosition(0)
    setPlaying(false)
    // armed is intentionally excluded: arming itself must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    if (!playing || totalBars === 0) return

    const id = setInterval(() => {
      setPosition((current) => (current >= totalBars ? current : current + 1))
    }, BASE_INTERVAL_MS / speed)

    return () => clearInterval(id)
  }, [playing, speed, totalBars])

  // Stop at the end rather than spinning a timer that can no longer advance.
  useEffect(() => {
    if (playing && totalBars > 0 && position >= totalBars) setPlaying(false)
  }, [playing, position, totalBars])

  const reset = useCallback(() => {
    setArmed(true)
    setPosition(0)
    setPlaying(false)
  }, [])

  const step = useCallback(() => {
    setPlaying(false)
    setArmed(true)
    // Reads `armed` from the closure rather than nesting a setArmed updater —
    // see the module comment on why the latter double-fires under StrictMode.
    setPosition((current) => Math.min((armed ? current : 0) + 1, totalBars))
  }, [armed, totalBars])

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false)
      return
    }

    setArmed(true)
    // Arming, or replaying again after reaching the end, both start at 0.
    setPosition((current) => (!armed || current >= totalBars ? 0 : current))
    setPlaying(true)
  }, [playing, armed, totalBars])

  const revealedCount = armed ? Math.min(position, totalBars) : totalBars

  return useMemo(
    () => ({
      armed,
      revealedCount,
      totalBars,
      playing,
      speed,
      atStart: armed && revealedCount === 0,
      atEnd: !armed || revealedCount >= totalBars,
      togglePlay,
      step,
      reset,
      setSpeed,
    }),
    [armed, revealedCount, totalBars, playing, speed, togglePlay, step, reset],
  )
}
