import { createContext } from 'react'
import type { DrawingTool } from '../lib/drawings'

/** 'none' is the cursor/select tool — click an existing drawing to select it, click empty space to deselect. */
export type ActiveDrawingTool = DrawingTool | 'none'

export interface DrawingToolState {
  activeTool: ActiveDrawingTool
  setActiveTool: (tool: ActiveDrawingTool) => void
  /**
   * Magnet snap, TradingView's toggle: points land on the nearest bar's
   * nearest OHLC value instead of wherever the pointer happened to be. Shared
   * across charts like the tool itself, and applied both when placing a new
   * drawing and when dragging an existing anchor.
   */
  magnet: boolean
  setMagnet: (magnet: boolean) => void
}

/**
 * Shares which drawing tool is armed (spec §4.5) across all five charts, set
 * from one toolbar. Undefined outside a provider — consumers fall back to
 * 'none' rather than throwing, so a chart rendered without the provider still
 * works as a plain chart.
 */
export const DrawingToolContext = createContext<DrawingToolState | undefined>(undefined)
