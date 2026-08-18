import { createContext } from 'react'
import type { ChartSyncGroup } from '../lib/chartSync'

/**
 * Carries the shared crosshair-sync group (spec §4.5) from SessionOverlays
 * down to the main spot chart and the four leg charts without threading a prop
 * through LegQuadrantPanel → LegQuadrant → LegCell, none of which otherwise
 * care about it.
 *
 * Undefined outside a provider — consumers treat that as "sync disabled"
 * rather than throwing, so a chart rendered in isolation (tests, Storybook-
 * style usage) still works on its own.
 */
export const ChartSyncContext = createContext<ChartSyncGroup | undefined>(undefined)
