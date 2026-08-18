import { DailyCandleTable } from './components/DailyCandleTable'
import { EmptyPanel, ErrorPanel, LoadingPanel } from './components/StatusPanels'
import { useAsync } from './hooks/useAsync'
import { formatCount, formatIstDateTime } from './lib/format'
import { fetchDailyCandleCount, fetchRecentDailyCandles, TABLES } from './lib/queries'
import { supabaseProjectRef } from './lib/supabase'

const RECENT_SESSION_LIMIT = 20

interface Phase1Data {
  totalSessions: number
  recent: Awaited<ReturnType<typeof fetchRecentDailyCandles>>
  fetchedAt: Date
}

async function loadPhase1Data(): Promise<Phase1Data> {
  const [totalSessions, recent] = await Promise.all([
    fetchDailyCandleCount(),
    fetchRecentDailyCandles(RECENT_SESSION_LIMIT),
  ])

  return { totalSessions, recent, fetchedAt: new Date() }
}

export default function App() {
  const { state, reload } = useAsync(loadPhase1Data, [])

  return (
    <div className="min-h-full bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Header
          projectRef={supabaseProjectRef}
          totalSessions={state.status === 'ready' ? state.data.totalSessions : null}
          fetchedAt={state.status === 'ready' ? state.data.fetchedAt : null}
        />

        <main className="mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="font-mono text-sm text-zinc-400">
              Most recent {RECENT_SESSION_LIMIT} sessions
            </h2>
            <code className="font-mono text-xs text-zinc-600">{TABLES.spotCandlesDaily}</code>
          </div>

          {state.status === 'loading' && (
            <LoadingPanel label={`Reading ${TABLES.spotCandlesDaily}…`} />
          )}

          {state.status === 'error' && (
            <ErrorPanel title="Supabase query failed" error={state.error} onRetry={reload} />
          )}

          {state.status === 'ready' &&
            (state.data.recent.length === 0 ? (
              <EmptyPanel message={`${TABLES.spotCandlesDaily} returned 0 rows.`} />
            ) : (
              <DailyCandleTable candles={state.data.recent} />
            ))}
        </main>

        <footer className="mt-8 border-t border-zinc-900 pt-4">
          <p className="font-mono text-xs text-zinc-600">
            Phase 1 — connection check. Read-only: this dashboard never writes to Supabase.
          </p>
        </footer>
      </div>
    </div>
  )
}

function Header({
  projectRef,
  totalSessions,
  fetchedAt,
}: {
  projectRef: string
  totalSessions: number | null
  fetchedAt: Date | null
}) {
  return (
    <header className="border-b border-zinc-800 pb-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            Sniper Levels — Backtest Dashboard
          </h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            Nifty 50 weekly options · read-only visual inspection
          </p>
        </div>

        <dl className="flex flex-wrap items-end gap-6">
          <Stat label="Sessions in table">
            {totalSessions === null ? '—' : formatCount(totalSessions)}
          </Stat>
          <Stat label="Supabase project">{projectRef || '—'}</Stat>
          <Stat label="Fetched">{fetchedAt ? formatIstDateTime(fetchedAt) : '—'}</Stat>
        </dl>
      </div>
    </header>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-right">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="font-mono text-sm text-amber-400">{children}</dd>
    </div>
  )
}
