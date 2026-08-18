import type { Replay } from '../hooks/useReplay'
import { REPLAY_SPEEDS, type ReplaySpeed } from '../hooks/useReplay'
import { formatCount } from '../lib/format'

/**
 * Replay controls from spec §4.1: play/pause, step-forward, reset, speed
 * selector, and a position readout.
 *
 * Revealing is spot-chart-relative — see lib/replay.ts for why option bars
 * need their own cutoff conversion rather than sharing this count directly.
 *
 * Before the first Play, Step or Reset, replay is unarmed and the whole
 * session is shown; pressing any control here arms it. That first press is
 * therefore indistinguishable from a normal replay action, which is the
 * point — there is no separate "start replay" step to learn.
 */
export function ReplayControls({ replay }: { replay: Replay }) {
  const disabled = replay.totalBars === 0

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-600">Replay</span>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <IconButton
            label="Reset to start"
            onClick={replay.reset}
            disabled={disabled || (replay.armed && replay.atStart && !replay.playing)}
          >
            ⏮
          </IconButton>
          <IconButton
            label={replay.playing ? 'Pause' : 'Play'}
            onClick={replay.togglePlay}
            disabled={disabled}
            active={replay.playing}
          >
            {replay.playing ? '⏸' : '▶'}
          </IconButton>
          <IconButton
            label="Step forward one bar"
            onClick={replay.step}
            disabled={disabled || replay.atEnd}
          >
            ⏭
          </IconButton>
        </div>

        <div className="flex gap-1" role="group" aria-label="Replay speed">
          {REPLAY_SPEEDS.map((speed) => (
            <SpeedButton
              key={speed}
              speed={speed}
              active={speed === replay.speed}
              disabled={disabled}
              onClick={() => replay.setSpeed(speed)}
            />
          ))}
        </div>

        <span
          className="font-mono text-xs tabular-nums text-zinc-400"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCount(replay.revealedCount)} / {formatCount(replay.totalBars)}
        </span>
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded border text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
          : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
      }`}
    >
      {children}
    </button>
  )
}

function SpeedButton({
  speed,
  active,
  disabled,
  onClick,
}: {
  speed: ReplaySpeed
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-1.5 py-1 font-mono text-[11px] transition disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
          : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
      }`}
    >
      {speed}x
    </button>
  )
}
