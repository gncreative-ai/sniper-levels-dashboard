import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Read-only Supabase client.
 *
 * This dashboard NEVER writes: no insert/update/delete/rpc-with-side-effects
 * anywhere in this codebase. The anon key is safe in the bundle only because
 * every sniper_bt_* table is RLS-protected with a SELECT-only policy.
 *
 * Config problems are surfaced as `supabaseConfigError` rather than thrown at
 * module scope, so a missing .env renders as a readable error panel instead of
 * a blank white page.
 */

const PLACEHOLDER_MARKERS = ['your_anon_key_here', 'your_', 'changeme']

function readEnvVar(name: keyof ImportMetaEnv): { value: string } | { error: string } {
  const raw = import.meta.env[name]

  if (raw === undefined || raw.trim() === '') {
    return { error: `${name} is not set. Copy .env.example to .env and fill it in.` }
  }

  const value = raw.trim()

  if (PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().startsWith(marker))) {
    return {
      error: `${name} still holds the placeholder value from .env.example. Put the real value in .env.`,
    }
  }

  return { value }
}

function buildClient(): { client: SupabaseClient; error: null } | { client: null; error: string } {
  const url = readEnvVar('VITE_SUPABASE_URL')
  if ('error' in url) return { client: null, error: url.error }

  const anonKey = readEnvVar('VITE_SUPABASE_ANON_KEY')
  if ('error' in anonKey) return { client: null, error: anonKey.error }

  try {
    const client = createClient(url.value, anonKey.value, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return { client, error: null }
  } catch (cause) {
    return { client: null, error: `Could not create the Supabase client: ${describe(cause)}` }
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const built = buildClient()

export const supabase = built.client
export const supabaseConfigError = built.error

/** The project ref, for display in the UI header. Empty string if unconfigured. */
export const supabaseProjectRef =
  import.meta.env.VITE_SUPABASE_URL?.match(/https?:\/\/([^.]+)\./)?.[1] ?? ''

/**
 * Every query goes through this so a misconfigured environment fails with the
 * actual reason instead of a null-dereference somewhere deeper.
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? 'Supabase client is unavailable.')
  }
  return supabase
}
