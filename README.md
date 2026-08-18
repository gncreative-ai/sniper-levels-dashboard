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

## A data characteristic worth knowing

`sniper_bt_spot_candles_daily.close` is **not** the last 5-minute bar's close, and
this is expected rather than a defect. Across all 237 sessions:

| Field | Daily row vs. aggregated 5-min bars |
|---|---|
| `open` | identical in 237/237 |
| `high` | identical in 234/237 (max difference 2.65) |
| `low` | identical in 236/237 (max difference 0.50) |
| `close` | **differs in 227/237** — mean 13.24, max 85.70, in both directions |

The intraday feed ends at 15:25 IST (see `docs/SPEC.md` §2 — data outside the
session window is filtered upstream), while the daily close is the official
end-of-session value. `sniper_bt_daily_setup.prev_close` matches the daily close
in 699/699 rows and the last 5-min bar in only 18, so the pipeline uses official
closes consistently.

Practical consequence: the "Prev Close" overlay line will not sit on top of the
previous day's final candle. That is correct, not a rendering bug.

---

## Deployment

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`
(or manually from the Actions tab). Once set up, the site lives at:

```
https://gncreative-ai.github.io/sniper-levels-dashboard/
```

### One-time setup

1. **Make the repository public.** GitHub Pages on a private repo requires a paid
   plan. See the visibility note below before doing this.
2. **Settings → Pages → Build and deployment → Source: `GitHub Actions`.**
3. **Settings → Secrets and variables → Actions** — add both values:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://qqkbkhzvhuocapcwzfwi.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the publishable key from Supabase → Project Settings → API |

   Either can go under the **Secrets** or the **Variables** tab — the workflow
   reads both places. Note the two tabs are separate stores: a value added to
   one is not visible to the other, which is an easy way to end up with a
   half-configured build.

   Both are read at build time. If either is missing the workflow fails with an
   explicit message rather than deploying a site whose every query errors.

### What "public" actually means here

This is a static SPA with no backend, so the Supabase key **must** ship inside the
JavaScript bundle — that is inherent to the architecture, not a leak. Combined with
the `SELECT USING (true)` RLS policy, it means **anyone who can load the deployed
URL can read the entire `sniper_bt_*` dataset.** The key being public is fine and by
design; the data being public is the part worth a deliberate decision.

Nothing about this grants write access — there are no INSERT/UPDATE/DELETE policies
on these tables, so the key cannot modify anything.

If the dashboard should be reachable but the data gated, that needs Supabase Auth
with user-scoped RLS policies and a sign-in flow — a different architecture from the
one in `docs/SPEC.md`.

### Base path

`vite.config.ts` reads `VITE_BASE_PATH`, which the workflow sets to `/<repo-name>/`
for Pages project sites. It defaults to `/` so `npm run dev` and any future custom
domain work unchanged.

---

## Project status

Data pipeline: complete and validated. Dashboard: in development — see the phased build plan in `docs/SPEC.md` section 5.4.

| Phase | Status |
|---|---|
| 1 — Skeleton + Supabase connection | ✅ Done |
| 2 — Session selection | ✅ Done |
| 3 — Main spot chart | ✅ Done |
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
| `calendar.ts` | Calendar-day arithmetic on `'YYYY-MM-DD'` strings, UTC-anchored — never browser-local. |
| `time.ts` | Instants vs. chart times. Lightweight Charts renders in UTC, so values are shifted by IST's fixed +05:30 for display. Read the module comment before touching it. |
