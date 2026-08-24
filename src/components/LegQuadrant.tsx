import { useContext } from 'react'
import { LegChart } from './LegChart'
import { ThemeContext } from '../contexts/ThemeContext'
import { LINE_COLORS, themed } from '../lib/theme'
import { EmptyPanel } from './StatusPanels'
import type { LegSeries } from '../lib/legs'
import { formatCount, formatPrice } from '../lib/format'
import { LEG_ROLE_LABELS } from '../lib/types'

/**
 * The four leg charts in their fixed 2x2 arrangement (spec §4.1):
 *
 *     ATM PE  |  OTM CE
 *     --------+--------
 *     ATM CE  |  OTM PE
 *
 * This arrangement never changes — not for screen size, not for batch. It is a
 * reading convention the user navigates by muscle memory, so on narrow screens
 * the cells stack in the same order rather than reflowing into a different
 * shape. The order comes from QUADRANT_ORDER; this grid only lays it out.
 */
export function LegQuadrant({ legs }: { legs: LegSeries[] }) {
  if (legs.length === 0) {
    return <EmptyPanel message="No leg contracts found for this session and batch." />
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {legs.map((leg) => (
        <LegCell key={leg.role} leg={leg} />
      ))}
    </div>
  )
}

function LegCell({ leg }: { leg: LegSeries }) {
  const { theme } = useContext(ThemeContext)
  const totalBars = leg.prevBars.length + leg.todayBars.length

  return (
    <section className="flex flex-col rounded-md border border-zinc-800 bg-zinc-900/20">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-zinc-800 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h3 className="font-mono text-xs font-semibold text-amber-400">
            {LEG_ROLE_LABELS[leg.role]}
          </h3>
          <span className="font-mono text-[12px] text-zinc-400">
            {leg.ref.strike} {leg.ref.optionType}
          </span>
        </div>

        <dl className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px]">
          <Level label="P.Close" value={leg.prevClose} color={themed(LINE_COLORS.prevClose, theme)} />
          <Level label="P.High" value={leg.prevHigh} color={themed(LINE_COLORS.prevHigh, theme)} />
          {/* Only the ATM legs carry a sniper level (spec §4.4). */}
          {(leg.role === 'ATM_CE' || leg.role === 'ATM_PE') && (
            <Level
              label="Sniper"
              value={leg.sniperLevel}
              color={themed(LINE_COLORS.contrast, theme)}
            />
          )}
        </dl>
      </header>

      {totalBars === 0 ? (
        <div className="flex h-[190px] items-center justify-center px-3 text-center sm:h-[230px]">
          <p className="font-mono text-[12px] text-zinc-500">
            No premium bars stored for {leg.ref.instrumentKey}.
          </p>
        </div>
      ) : (
        <div className="h-[190px] p-1 sm:h-[230px]">
          <LegChart leg={leg} />
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-3 border-t border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-zinc-600">
        <span>
          <span className="text-zinc-500">{formatCount(leg.prevBars.length)}</span> prev ·{' '}
          <span className="text-zinc-500">{formatCount(leg.todayBars.length)}</span> today
        </span>
        <span className="truncate" title={leg.ref.instrumentKey}>
          {leg.ref.instrumentKey}
        </span>
      </footer>
    </section>
  )
}

/** Renders an em dash for a genuine null rather than a misleading 0.00. */
function Level({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="flex items-center gap-1 text-zinc-600">
        {/* Ringed so the contrast-coloured dot (white on dark, black on light)
            stays visible against a panel of nearly the same colour. */}
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full ring-1 ring-zinc-700"
          style={{ background: color }}
        />
        {label}
      </dt>
      <dd className={value === null ? 'text-zinc-600' : 'text-zinc-300'}>{formatPrice(value)}</dd>
    </div>
  )
}
