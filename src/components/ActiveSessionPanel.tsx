import { formatPrice, formatSessionDate, formatSessionWeekday, formatSignedPercent, formatVolume } from '../lib/format'
import type { SessionSummary } from '../lib/types'

/**
 * The active session, as text.
 *
 * Phase 2 displays it only — the spot chart, overlays and leg charts that this
 * selection will drive arrive in phases 3 onward.
 */
export function ActiveSessionPanel({
  session,
  index,
  total,
  onStep,
}: {
  session: SessionSummary
  index: number
  total: number
  onStep: (delta: number) => void
}) {
  const changePct = session.open === 0 ? 0 : ((session.close - session.open) / session.open) * 100
  const up = session.close >= session.open

  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <StepButton label="Previous session" glyph="←" onClick={() => onStep(-1)} disabled={index <= 0} />
          <div>
            <p className="font-mono text-base text-amber-400">
              {formatSessionDate(session.candleDate)}
              <span className="ml-2 text-xs text-zinc-500">
                {formatSessionWeekday(session.candleDate)}
              </span>
            </p>
            <p className="font-mono text-[12px] text-zinc-600">
              session {index + 1} / {total} in range
            </p>
          </div>
          <StepButton
            label="Next session"
            glyph="→"
            onClick={() => onStep(1)}
            disabled={index >= total - 1}
          />
        </div>

        <dl className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <Metric label="Open" value={formatPrice(session.open)} />
          <Metric label="High" value={formatPrice(session.high)} />
          <Metric label="Low" value={formatPrice(session.low)} />
          <Metric label="Close" value={formatPrice(session.close)} tone={up ? 'up' : 'down'} />
          <Metric label="Chg %" value={formatSignedPercent(changePct)} tone={up ? 'up' : 'down'} />
          <Metric label="Volume" value={formatVolume(session.volume)} tone="muted" />
        </dl>
      </div>

      {!session.hasSetup && (
        <p className="mt-3 border-t border-zinc-800 pt-2 font-mono text-[12px] text-zinc-500">
          No setup row for this session. Expected for the first day in the dataset (no prior
          session to derive one from) and for recent days whose weekly expiry has not passed yet.
        </p>
      )}
    </section>
  )
}

function StepButton({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string
  glyph: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-zinc-700 px-2 py-1 font-mono text-sm text-zinc-300 transition hover:border-amber-600 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
    >
      {glyph}
    </button>
  )
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'up' | 'down' | 'muted'
}) {
  const toneClass =
    tone === 'up' ? 'text-emerald-400'
    : tone === 'down' ? 'text-red-400'
    : tone === 'muted' ? 'text-zinc-600'
    : 'text-zinc-300'

  return (
    <div className="text-right">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className={`font-mono text-sm ${toneClass}`}>{value}</dd>
    </div>
  )
}
