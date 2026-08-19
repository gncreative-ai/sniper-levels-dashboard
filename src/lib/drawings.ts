import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Drawing tools (spec §4.5): trend lines, horizontal rays, rectangles, and
 * fibonacci retracement, usable on all five charts. Types and pure geometry
 * only — no React, no Lightweight Charts primitive plumbing (that lives in
 * drawingPrimitive.ts).
 *
 * Every drawing is anchored in (time, price) space, never pixels — the same
 * discipline the overlay lines and the leg-chart divider already follow, so a
 * drawing stays glued to the right place through zoom, pan, and resize.
 *
 * Scope, deliberately: create, select, delete. No drag-to-reposition, no
 * persistence across a reload, no undo/redo, one default style per tool. If
 * any of that turns out to be wanted, it is a natural follow-up, not a gap.
 */

export type DrawingTool = 'trendline' | 'ray' | 'rectangle' | 'fib'

export const DRAWING_TOOLS: readonly DrawingTool[] = ['trendline', 'ray', 'rectangle', 'fib']

export const TOOL_LABELS: Record<DrawingTool, string> = {
  trendline: 'Trend Line',
  ray: 'Horizontal Ray',
  rectangle: 'Rectangle',
  fib: 'Fib Retracement',
}

/** How many clicks each tool needs before a drawing is committed. */
export const TOOL_POINT_COUNT: Record<DrawingTool, 1 | 2> = {
  trendline: 2,
  ray: 1,
  rectangle: 2,
  fib: 2,
}

export interface Point {
  time: UTCTimestamp
  price: number
}

export interface Drawing {
  id: string
  tool: DrawingTool
  /** Exactly TOOL_POINT_COUNT[tool] points, in click order. */
  points: Point[]
}

let nextId = 0

/** Monotonic, not a UUID — drawings never leave this browser tab, let alone this page load. */
export function makeDrawingId(): string {
  nextId += 1
  return `drawing-${nextId}`
}

/** Fractions TradingView and every other charting tool draw for a retracement, in order. */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

/** The price at a given fib fraction between a drawing's two anchor points. */
export function fibLevelPrice(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction
}

// --- Hit-testing geometry, all in CSS-pixel (media) coordinates ---

export function distanceToPoint(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y)
}

/** Perpendicular distance from a point to a finite line SEGMENT (not the infinite line). */
export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) return distanceToPoint(px, py, x1, y1)

  // Project the point onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  return distanceToPoint(px, py, x1 + t * dx, y1 + t * dy)
}

/** Distance to a horizontal ray's stroke: 0 if within the y-tolerance and at or right of its start x. */
export function distanceToRay(px: number, py: number, startX: number, y: number): number {
  if (px < startX) return distanceToPoint(px, py, startX, y)
  return Math.abs(py - y)
}

export function isInsideRect(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  return px >= left && px <= right && py >= top && py <= bottom
}

/** Distance to a rectangle's nearest EDGE — used so a click just inside a large rectangle still resolves sensibly. */
export function distanceToRectEdge(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)

  return Math.min(
    distanceToSegment(px, py, left, top, right, top),
    distanceToSegment(px, py, right, top, right, bottom),
    distanceToSegment(px, py, right, bottom, left, bottom),
    distanceToSegment(px, py, left, bottom, left, top),
  )
}
