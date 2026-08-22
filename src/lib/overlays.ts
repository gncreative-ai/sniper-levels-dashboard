import { LINE_COLORS, themed, type Theme, type ThemedColor } from './theme'
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
 * Palette matches the TradingView charts this dashboard mirrors (see
 * lib/theme.ts): a cyan family for the prior-day references, separated by shade
 * and dash pattern rather than hue so the grouping stays readable; a black/white
 * contrast line for ATM spot; red for the upper band and teal for the lower.
 *
 * The band colours are not a "green up, red down" mistake. The upper band is
 * where PE holders book profit and CE holders panic, so it is the red level,
 * and the lower band is its mirror — which is what the reference charts label
 * them.
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
  /** Only the ATM line actually differs between themes; the rest repeat. */
  color: ThemedColor
  style: OverlayStyle
  value: (setup: DailySetup) => number | null
}

export const OVERLAY_DEFINITIONS: readonly OverlayDefinition[] = [
  {
    id: 'prevClose',
    label: 'Prev Close',
    title: 'P.Close',
    color: LINE_COLORS.prevClose,
    style: 'solid',
    value: (setup) => setup.prevClose,
  },
  {
    id: 'prevHigh',
    label: 'Prev High',
    title: 'P.High',
    color: LINE_COLORS.prevHigh,
    style: 'dashed',
    value: (setup) => setup.prevHigh,
  },
  {
    id: 'prevLow',
    label: 'Prev Low',
    title: 'P.Low',
    color: LINE_COLORS.prevLow,
    style: 'dotted',
    value: (setup) => setup.prevLow,
  },
  {
    id: 'atm',
    label: 'ATM',
    title: 'ATM',
    color: LINE_COLORS.contrast,
    style: 'solid',
    value: (setup) => setup.atmCenter,
  },
  {
    id: 'sniperUpper',
    label: 'Upper Band',
    title: 'Upper',
    color: LINE_COLORS.sniperUpper,
    style: 'solid',
    value: (setup) => setup.spotSniperUpper,
  },
  {
    id: 'sniperLower',
    label: 'Lower Band',
    title: 'Lower',
    color: LINE_COLORS.sniperLower,
    style: 'solid',
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

/** The colour this overlay draws in under the active theme. */
export function overlayColor(definition: OverlayDefinition, theme: Theme): string {
  return themed(definition.color, theme)
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
