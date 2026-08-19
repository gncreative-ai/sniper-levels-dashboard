import { createContext } from 'react'
import type { DrawingTool } from '../lib/drawings'

/** 'none' is the cursor/select tool — click an existing drawing to select it, click empty space to deselect. */
export type ActiveDrawingTool = DrawingTool | 'none'

export interface DrawingToolState {
  activeTool: ActiveDrawingTool
  setActiveTool: (tool: ActiveDrawingTool) => void
}

/**
 * Shares which drawing tool is armed (spec §4.5) across all five charts, set
 * from one toolbar. Undefined outside a provider — consumers fall back to
 * 'none' rather than throwing, so a chart rendered without the provider still
 * works as a plain chart.
 */
export const DrawingToolContext = createContext<DrawingToolState | undefined>(undefined)
