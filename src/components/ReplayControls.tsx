import type { Replay } from '../hooks/useReplay'
import { REPLAY_SPEEDS, type ReplaySpeed } from '../hooks/useReplay'
import { formatCount } from '../lib/format'
import type { ToolbarOrientation } from '../lib/toolbarLayout'

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
 *
 * Lays out both ways for the floating toolbar. Vertical stacks the transport
 * and speed buttons two-up so the left dock stays a slim strip; every control
 * here is already an icon or a two-character label, so nothing is lost by
 * narrowing.
 */
export function ReplayControls({
  replay,
  orientation = 'horizontal',
}: {
  replay: Replay
  orientation?: ToolbarOrientation
}) {
  const disabled = replay.totalBars === 0
  const vertical = orientation === 'vertical'

  return (
    <div className="flex">
      <div
        className={
          vertical
            ? 'flex flex-col items-center gap-1.5'
            : 'flex flex-nowrap items-center gap-2'
        }
      >
        <div className={vertical ? 'grid grid-cols-2 gap-1' : 'flex gap-1'}>
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

        <div
          className={vertical ? 'grid grid-cols-2 gap-1' : 'flex gap-1'}
          role="group"
          aria-label="Replay speed"
        >
          {REPLAY_SPEEDS.map((speed) => (
            <SpeedButton
              key={speed}
              speed={speed}
              active={speed === replay.speed}
              disabled={disabled}
              onClick={() => replay.setSpeed(speed)}
              vertical={vertical}
            />
          ))}
        </div>

        <span
          className={`font-mono tabular-nums text-zinc-400 ${
            vertical ? 'text-center text-[10px] leading-tight' : 'text-xs'
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          {vertical ? (
            <>
              {formatCount(replay.revealedCount)}
              <span className="block text-zinc-600">/ {formatCount(replay.totalBars)}</span>
            </>
          ) : (
            `${formatCount(replay.revealedCount)} / ${formatCount(replay.totalBars)}`
          )}
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
  vertical,
}: {
  speed: ReplaySpeed
  active: boolean
  disabled: boolean
  onClick: () => void
  vertical: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border py-1 font-mono transition disabled:cursor-not-allowed disabled:opacity-30 ${
        vertical ? 'w-7 text-[10px]' : 'px-1.5 text-[11px]'
      } ${
        active
          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
          : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
      }`}
    >
      {speed}x
    </button>
  )
}
