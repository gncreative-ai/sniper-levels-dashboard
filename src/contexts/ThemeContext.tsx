import { createContext } from 'react'
import type { Theme } from '../lib/theme'

export interface ThemeState {
  theme: Theme
  toggleTheme: () => void
}

/**
 * The active theme, shared by the chrome and by all five charts.
 *
 * Defaults to dark rather than undefined: a chart rendered outside the provider
 * should still be drawn in a coherent palette, not with missing colours.
 */
export const ThemeContext = createContext<ThemeState>({
  theme: 'dark',
  toggleTheme: () => {},
})
