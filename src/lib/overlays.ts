import type { DailySetup } from './types'

/**
 * The six overlay reference lines on the main spot chart (spec §4.1).
 *
 * Defined once, here, rather than at each use site: the toggle chips, their
 * colours, the drawn lines and the readout all derive from this list, so a line
 * cannot end up a different colour in the legend than on the chart.
 *
 * `value` returns null when the field is genuinely absent for that batch. Null
 * means "draw nothing" — never zero, never a fallback. When an OTM leg had no
 * trades in the lookback window its settle is null, which cascades into a null
 * sniper point and null bands; substituting a number there would invent a price
 * level that never existed.
 *
 * Palette follows spec §5.3: blue for prior-day references, amber for ATM,
 * green and red for the upper and lower bands. The prior-day trio shares the
 * blue family and separates by shade and dash pattern rather than by hue, so
 * the grouping stays readable.
 */

export type OverlayId =
  | 'prevClose'
  | 'prevHigh'
  | 'prevLow'
  | 'atm'
  | 'sniperUpper'
  | 'sniperLower'

export type OverlayStyle = 'solid' | 'dashed' | 'dotted'

export interface OverlayDefinition {
  id: OverlayId
  /** Shown on the toggle chip. */
  label: string
  /** Drawn against the line on the price axis — kept short to fit. */
  title: string
  color: string
  style: OverlayStyle
  value: (setup: DailySetup) => number | null
}

export const OVERLAY_DEFINITIONS: readonly OverlayDefinition[] = [
  {
    id: 'prevClose',
    label: 'Prev Close',
    title: 'P.Close',
    color: '#60a5fa',
    style: 'solid',
    value: (setup) => setup.prevClose,
  },
  {
    id: 'prevHigh',
    label: 'Prev High',
    title: 'P.High',
    color: '#93c5fd',
    style: 'dashed',
    value: (setup) => setup.prevHigh,
  },
  {
    id: 'prevLow',
    label: 'Prev Low',
    title: 'P.Low',
    color: '#3b82f6',
    style: 'dotted',
    value: (setup) => setup.prevLow,
  },
  {
    id: 'atm',
    label: 'ATM',
    title: 'ATM',
    color: '#fbbf24',
    style: 'dashed',
    value: (setup) => setup.atmCenter,
  },
  {
    id: 'sniperUpper',
    label: 'Upper Band',
    title: 'Upper',
    color: '#10b981',
    style: 'dashed',
    value: (setup) => setup.spotSniperUpper,
  },
  {
    id: 'sniperLower',
    label: 'Lower Band',
    title: 'Lower',
    color: '#ef4444',
    style: 'dashed',
    value: (setup) => setup.spotSniperLower,
  },
] as const

export type OverlayVisibility = Record<OverlayId, boolean>

/** All six on by default — the point of the tool is seeing them against price. */
export const DEFAULT_OVERLAY_VISIBILITY: OverlayVisibility = {
  prevClose: true,
  prevHigh: true,
  prevLow: true,
  atm: true,
  sniperUpper: true,
  sniperLower: true,
}

/** A line ready to draw: definition plus a resolved, non-null price. */
export interface ResolvedOverlay extends OverlayDefinition {
  price: number
}

/**
 * Resolve the visible overlays for a batch.
 *
 * Toggled-off lines and genuinely-absent values both drop out here, so the
 * chart only ever receives lines it should draw.
 */
export function resolveOverlays(
  setup: DailySetup | undefined,
  visibility: OverlayVisibility,
): ResolvedOverlay[] {
  if (!setup) return []

  return OVERLAY_DEFINITIONS.flatMap((definition) => {
    if (!visibility[definition.id]) return []

    const price = definition.value(setup)
    return price === null ? [] : [{ ...definition, price }]
  })
}

/** Overlays that are toggled on but have no value for this batch. */
export function absentOverlays(
  setup: DailySetup | undefined,
  visibility: OverlayVisibility,
): OverlayDefinition[] {
  if (!setup) return []

  return OVERLAY_DEFINITIONS.filter(
    (definition) => visibility[definition.id] && definition.value(setup) === null,
  )
}
