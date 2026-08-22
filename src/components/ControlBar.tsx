import { useContext } from 'react'
import {
  OVERLAY_DEFINITIONS,
  overlayColor,
  type OverlayId,
  type OverlayVisibility,
} from '../lib/overlays'
import { ThemeContext } from '../contexts/ThemeContext'
import { ATM_BATCHES, ATM_BATCH_LABELS, type AtmBatch, type SessionSetup } from '../lib/types'
import { formatPrice } from '../lib/format'

/**
 * The control row from spec §4.1: the ATM batch toggle and the six overlay
 * switches.
 *
 * Replay and the draw tools used to live here too; they moved to the floating
 * toolbar because they are used continuously while reading a chart, whereas
 * these are set once for a session. See FloatingToolbar for that reasoning.
 *
 * Overlay toggles are pure client-side visibility and never trigger a fetch
 * (spec §4.3). The batch toggle does not fetch either — all three batches
 * arrive together, so switching is instant.
 */
export function ControlBar({
  setup,
  batch,
  onBatchChange,
  visibility,
  onVisibilityChange,
}: {
  setup: SessionSetup
  batch: AtmBatch
  onBatchChange: (batch: AtmBatch) => void
  visibility: OverlayVisibility
  onVisibilityChange: (id: OverlayId) => void
}) {
  const active = setup[batch]
  const { theme } = useContext(ThemeContext)

  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">ATM batch</span>
          <div className="flex gap-1" role="group" aria-label="ATM batch">
            {ATM_BATCHES.map((option) => {
              const optionSetup = setup[option]
              const selected = option === batch

              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  disabled={!optionSetup}
                  onClick={() => onBatchChange(option)}
                  title={
                    optionSetup
                      ? `ATM ${formatPrice(optionSetup.atmCenter)}`
                      : 'No setup row for this batch'
                  }
                  className={`rounded border px-2.5 py-1 font-mono text-xs transition disabled:cursor-not-allowed disabled:opacity-30 ${
                    selected
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400'
                  }`}
                >
                  {ATM_BATCH_LABELS[option]}
                  {optionSetup && (
                    <span className="ml-1.5 text-[10px] text-zinc-500">
                      {optionSetup.atmCenter}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">Overlays</span>
          <div className="flex flex-wrap gap-1">
            {OVERLAY_DEFINITIONS.map((definition) => {
              const on = visibility[definition.id]
              // Distinguishes "switched off" from "no value in this batch".
              const absent = active ? definition.value(active) === null : false

              return (
                <button
                  key={definition.id}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => onVisibilityChange(definition.id)}
                  title={
                    absent
                      ? `${definition.label} — not available for this batch`
                      : definition.label
                  }
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-xs transition ${
                    on
                      ? 'border-zinc-600 bg-zinc-800/60 text-zinc-200'
                      : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: on ? overlayColor(definition, theme) : 'transparent',
                      border: `1px solid ${overlayColor(definition, theme)}`,
                      opacity: on ? 1 : 0.45,
                    }}
                  />
                  <span className={absent && on ? 'line-through decoration-zinc-600' : undefined}>
                    {definition.label}
                  </span>
                  {on && active && !absent && (
                    <span className="text-[10px] text-zinc-500">
                      {formatPrice(definition.value(active))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {active && <BatchSummary batch={batch} setup={setup} />}
    </section>
  )
}

/** The numbers behind the selected batch, so the lines can be checked against source values. */
function BatchSummary({ batch, setup }: { batch: AtmBatch; setup: SessionSetup }) {
  const active = setup[batch]
  if (!active) return null

  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-zinc-800 pt-2 font-mono text-[11px]">
      <Item label="ATM" value={formatPrice(active.atmCenter)} tone="amber" />
      <Item label="OTM CE" value={`${active.otmCeStrike} @ ${formatPrice(active.otmCeSettle)}`} />
      <Item label="OTM PE" value={`${active.otmPeStrike} @ ${formatPrice(active.otmPeSettle)}`} />
      <Item label="Sniper pt" value={formatPrice(active.sniperPoint)} tone="amber" />
      <Item label="Prev session" value={active.prevSessionDate} />
      <Item label="Expiry" value={active.weeklyExpiry} />

      {active.sniperPoint === null && (
        <span className="text-zinc-500">
          — no sniper point for this batch: an OTM leg had no trades in the lookback window, so
          the bands are genuinely absent rather than zero.
        </span>
      )}
    </dl>
  )
}

function Item({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className={tone === 'amber' ? 'text-amber-400' : 'text-zinc-300'}>{value}</dd>
    </div>
  )
}
