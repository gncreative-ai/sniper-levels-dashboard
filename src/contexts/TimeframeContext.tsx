import { createContext } from 'react'
import type { Timeframe } from '../lib/timeframe'

export interface TimeframeState {
  timeframe: Timeframe
  setTimeframe: (timeframe: Timeframe) => void
}

/**
 * The active chart timeframe, shared by the toolbar toggle and the data layer.
 *
 * In context rather than passed down because the toggle lives in the floating
 * toolbar while the fetching happens in the session view — the two are far
 * apart in the tree and nothing between them cares.
 */
export const TimeframeContext = createContext<TimeframeState>({
  timeframe: '5m',
  setTimeframe: () => {},
})
