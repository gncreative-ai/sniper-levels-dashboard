/**
 * Where the floating replay/draw toolbar docks.
 *
 * Two fixed docks rather than free dragging: horizontal along the top, or
 * vertical down the left. Both stay put while the page scrolls, which is the
 * point — the charts are taller than the viewport, and having to scroll back
 * up to change tool or step the replay is the problem this solves.
 *
 * The page reserves space for whichever dock is active instead of letting the
 * bar sit on top of the content. A floating bar that permanently hides the
 * session header would just trade one scrolling problem for another.
 */

export type ToolbarOrientation = 'horizontal' | 'vertical'

/**
 * Space the page must leave clear, in px, for each dock.
 *
 * Measured against the rendered bar rather than guessed: horizontal occupies
 * y 8–58 (an 8px inset plus a 50px row) and vertical occupies x 8–86, so these
 * are those extents plus a margin. If the bar's contents change enough to
 * alter its size, these have to move with it — a value that is too small does
 * not fail loudly, it just quietly covers the page header, which is why the
 * browser check asserts the two do not overlap.
 */
export const TOOLBAR_CLEARANCE: Record<ToolbarOrientation, number> = {
  horizontal: 76,
  vertical: 104,
}

const STORAGE_KEY = 'sniper-toolbar-orientation'

/** Restores the last dock. Storage throws outright in some privacy modes. */
export function initialOrientation(): ToolbarOrientation {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'horizontal' || stored === 'vertical') return stored
  } catch {
    // Fall through to the default.
  }

  return 'horizontal'
}

export function persistOrientation(orientation: ToolbarOrientation): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, orientation)
  } catch {
    // A preference that cannot be saved is not worth surfacing.
  }
}
