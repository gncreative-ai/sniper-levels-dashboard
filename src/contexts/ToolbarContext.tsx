import { createContext } from 'react'
import type { ToolbarOrientation } from '../lib/toolbarLayout'

export interface ToolbarState {
  orientation: ToolbarOrientation
  toggleOrientation: () => void
}

/**
 * Where the floating toolbar docks.
 *
 * Held in context rather than passed down because two very different parts of
 * the tree need it: the toolbar itself, which is rendered deep inside the
 * session view (it needs the replay state that lives there), and the page
 * shell at the very top, which has to reserve the space so the dock does not
 * cover the header.
 */
export const ToolbarContext = createContext<ToolbarState>({
  orientation: 'horizontal',
  toggleOrientation: () => {},
})
