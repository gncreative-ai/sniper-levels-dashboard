# Sniper Levels — Backtest Dashboard

A backtesting visualization dashboard for **Sniper Levels**, a Nifty 50 weekly-options strategy. Reads pre-computed historical session data from Supabase and lets you visually inspect and replay past trading sessions, day by day.

**This is a read-only analysis tool.** It does not place trades, generate signals, or write to the database.

---

## Documentation

| File | What's in it |
|---|---|
| `docs/SPEC.md` | Full build specification — data schema, dashboard requirements, phased build plan. **Read this first.** |
| `CLAUDE.md` | Project rules and conventions for Claude Code |

## Stack

- Vite + React + Tailwind CSS
- TradingView Lightweight Charts
- Supabase (read-only, direct from browser)

## Data source

Supabase project `qqkbkhzvhuocapcwzfwi`, tables prefixed `sniper_bt_*`. Currently holds **233 completed sessions** spanning Sep 2, 2025 → Aug 11, 2026, populated by a separate n8n pipeline (out of scope for this repo).

Schema details are in `docs/SPEC.md` section 2.

## Setup

```bash
npm install
cp .env.example .env    # then fill in your Supabase anon key
npm run dev
```

### Environment variables

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` | `https://qqkbkhzvhuocapcwzfwi.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | From Supabase Dashboard → Project Settings → API |

The anon key is safe to expose in a browser bundle **only because** every `sniper_bt_*` table has RLS enabled with a read-only `SELECT` policy and no write policies. Do not add write policies to these tables.

## Project status

Data pipeline: complete and validated. Dashboard: in development — see the phased build plan in `docs/SPEC.md` section 5.4.

| Phase | Status |
|---|---|
| 1 — Skeleton + Supabase connection | ✅ Done |
| 2 — Session selection | Not started |
| 3 — Main spot chart | Not started |
| 4 — Overlays + batch toggle | Not started |
| 5 — Four leg charts | Not started |
| 6 — Replay | Not started |
| 7 — Crosshair sync + zoom/pan | Not started |
| 8 — Draw tools | Not started |

### Data access layer

All Supabase reads go through `src/lib/`, not through components:

| File | Responsibility |
|---|---|
| `supabase.ts` | The read-only client. Surfaces config problems as a readable error instead of a blank page. |
| `queries.ts` | Every query in the app. Nothing leaves this module un-coerced. |
| `num.ts` | The numeric coercion boundary — PostgREST returns `numeric`/`bigint` as strings. Nulls stay null. |
| `types.ts` | `*Row` (raw, strings) vs. domain types (numbers), so the coercion boundary is compiler-visible. |
| `format.ts` | Display formatting. Calendar dates never pass through `new Date()`; instants render in IST. |
