/**
 * Numeric coercion boundary.
 *
 * Postgres `numeric` and `bigint` columns arrive from Supabase's REST API as
 * JSON *strings*, not numbers. Every value that will ever be charted, compared
 * or arithmetic-ed must pass through here first. Per CLAUDE.md this is the most
 * likely source of a silently blank chart, so these helpers fail loudly with the
 * offending field name rather than quietly producing NaN.
 *
 * The null distinction matters: some legs genuinely have no settlement price
 * (otm_ce_settle / otm_pe_settle), which cascades into a null sniper_point and
 * null bands. Those must stay null all the way to the chart so the overlay is
 * drawn as absent. Never substitute 0.
 */

/** Coerce a value from a NOT NULL numeric column. Throws if absent or unparseable. */
export function toNum(value: unknown, field: string): number {
  const coerced = toNumOrNull(value, field)

  if (coerced === null) {
    throw new Error(`Expected a number for "${field}" but got ${describe(value)}.`)
  }

  return coerced
}

/**
 * Coerce a value from a nullable numeric column.
 * null/undefined pass through as null — a real absence, not a zero.
 * Anything present but unparseable still throws: that is a data bug, not an absence.
 */
export function toNumOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Expected a finite number for "${field}" but got ${describe(value)}.`)
    }
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null

    const coerced = Number(trimmed)
    if (!Number.isFinite(coerced)) {
      throw new Error(`Could not coerce "${field}" to a number: ${describe(value)}.`)
    }
    return coerced
  }

  throw new Error(`Unexpected type for "${field}": ${describe(value)}.`)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return `${JSON.stringify(value)} (${typeof value})`
}
