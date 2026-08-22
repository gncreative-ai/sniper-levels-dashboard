/**
 * Light/dark theming for the whole dashboard.
 *
 * Two separate concerns live here:
 *
 * 1. **Chart colours.** Lightweight Charts paints to a canvas, so it cannot
 *    inherit CSS — every colour it uses has to be handed to it explicitly and
 *    re-applied when the theme changes.
 * 2. **The reference-line palette**, matched to the TradingView charts this
 *    dashboard is modelled on. Only one line actually inverts between themes:
 *    the ATM spot level and the leg charts' sniper point, which are drawn black
 *    on light and white on dark so they read as "the neutral reference" against
 *    either background. Everything else keeps one colour in both.
 *
 * The surrounding UI (panels, chips, text) is themed in index.css instead — see
 * the note there on why that is a palette swap rather than per-component
 * variants.
 */

export type Theme = 'dark' | 'light'

/** A colour that differs between themes. Most do not; those repeat the value. */
export interface ThemedColor {
  dark: string
  light: string
}

export function themed(color: ThemedColor, theme: Theme): string {
  return color[theme]
}

/**
 * Reference-line colours, matched by eye to the supplied TradingView charts.
 *
 * Note the band colours are the opposite way round from a naive
 * "green up / red down" reading, and deliberately so: the UPPER band is where
 * PE holders take profit and CE holders panic, so it is the red level, and the
 * LOWER band is the mirror. The labels in the reference charts say exactly
 * this.
 */
export const LINE_COLORS = {
  /** Prior-day close. */
  prevClose: { dark: '#00bcd4', light: '#00acc1' },
  /** Prior-day high — same cyan family, one step lighter. */
  prevHigh: { dark: '#4dd0e1', light: '#26c6da' },
  /** Prior-day low — same cyan family, one step darker. */
  prevLow: { dark: '#0097a7', light: '#00838f' },
  /**
   * ATM spot, and the sniper point on the ATM leg charts. The one line that
   * inverts: black on light, white on dark.
   */
  contrast: { dark: '#ffffff', light: '#000000' },
  /** Upper band — "PE profit booking / CE panic". */
  sniperUpper: { dark: '#f23645', light: '#f23645' },
  /** Lower band — "CE profit booking / PE panic". */
  sniperLower: { dark: '#089981', light: '#089981' },
} satisfies Record<string, ThemedColor>

/** Chart chrome: everything Lightweight Charts draws that is not a series. */
export const CHART_UI: Record<Theme, {
  grid: string
  text: string
  border: string
  crosshair: string
  labelBackground: string
}> = {
  dark: {
    grid: '#27272a',
    text: '#a1a1aa',
    border: '#3f3f46',
    crosshair: '#71717a',
    labelBackground: '#18181b',
  },
  light: {
    grid: '#e4e4e7',
    text: '#52525b',
    border: '#d4d4d8',
    crosshair: '#a1a1aa',
    // Kept dark in both themes: the crosshair chip reads as a floating badge
    // over the chart in the reference screenshots, not as part of the surface.
    labelBackground: '#3f3f46',
  },
}

/**
 * Colours for the drawing tools.
 *
 * The selected-drawing stroke and the label plate are the two that genuinely
 * have to flip — a near-white selection highlight is invisible on a white
 * chart, which is exactly the kind of thing that only shows up once someone
 * switches themes.
 */
export const DRAWING_UI: Record<Theme, {
  selected: string
  pending: string
  labelBackground: string
}> = {
  dark: {
    selected: '#f4f4f5',
    pending: 'rgba(244, 244, 245, 0.55)',
    labelBackground: 'rgba(24, 24, 27, 0.85)',
  },
  light: {
    selected: '#18181b',
    pending: 'rgba(24, 24, 27, 0.55)',
    labelBackground: 'rgba(255, 255, 255, 0.88)',
  },
}

const STORAGE_KEY = 'sniper-theme'

/**
 * The theme to start in: whatever was last chosen, else the OS preference.
 *
 * Wrapped because storage access throws outright in some privacy modes, and a
 * theme preference is never worth failing a page load over.
 */
export function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Ignore and fall through to the OS preference.
  }

  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // A preference that cannot be saved is not an error worth surfacing.
  }
}
