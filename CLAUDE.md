# CLAUDE.md — Project Rules

This file is read automatically by Claude Code at the start of every session. Follow it.

## What this project is

A **backtesting visualization dashboard** for "Sniper Levels", a Nifty 50 weekly-options strategy. It reads pre-computed historical data from Supabase and lets a human visually inspect and replay past trading sessions.

Read `docs/SPEC.md` in full before writing any code. It is the source of truth.

## Non-negotiable rules

1. **This is a read-only dashboard.** Never write, update, or delete anything in Supabase. No INSERT, UPDATE, DELETE, or DDL. The data pipeline that populates these tables lives in n8n and is out of scope for this repo.

2. **Never hardcode secrets.** The Supabase key goes in an environment variable (`VITE_SUPABASE_ANON_KEY`), never in committed source. `.env` is gitignored; `.env.example` shows the shape only.

3. **Never invent or mock trading data.** If a query returns nothing, render an empty state — do not fabricate placeholder candles, strikes, or price levels to make a chart look populated. Fake market data in a backtesting tool is worse than no data, because it can be mistaken for a real result.

4. **Do not implement strategy signal logic.** No entry/exit signals, no scenario evaluation (Scenario 1/2/3), no buy/sell markers, no P&L calculation. v1 is visual inspection only. If the spec seems to invite this, it doesn't — ask first.

5. **Don't change the quadrant layout.** ATM PE top-left, OTM CE top-right, ATM CE bottom-left, OTM PE bottom-right. This is a fixed convention the user reads by muscle memory, not a styling preference.

6. **Work incrementally.** Build one phase, make it verifiably work, commit, then move on. Do not scaffold the entire app in one pass. See the phase plan in `docs/SPEC.md`.

## Stack

- **Vite + React** (TypeScript preferred, JS acceptable)
- **TradingView Lightweight Charts** for all charting — not Recharts, not Chart.js
- **Tailwind CSS** for styling
- **Supabase JS client** (`@supabase/supabase-js`) for data access
- No backend. This is a static SPA talking directly to Supabase over its REST API.

## Conventions

- All timestamps in the DB are `timestamptz` in UTC. Convert to **IST (Asia/Kolkata)** for display only. Never do date math in local browser time.
- Market session is 09:15–15:25 IST. Data outside this window has already been filtered out upstream.
- Numeric values from Supabase's REST API arrive as **strings** — coerce explicitly with `Number()` before charting. Silent string-vs-number bugs are the most likely source of a blank chart here.
- Prefer small, focused components. The 4 leg charts should share one component, parameterized — not four near-duplicate files.

## Verifying your work

There is no test suite yet and no local DB. To verify a change actually works:
- `npm run build` must pass with no errors
- `npm run dev` must start cleanly
- State any assumption you couldn't verify, rather than asserting something works when you haven't confirmed it

If a chart renders blank, check in this order: (1) did the query return rows, (2) are OHLC values numbers not strings, (3) is the time field in the format Lightweight Charts expects.

## Known data quirks — handle gracefully, these are not bugs

- **Oct 21, 2025** (Diwali Muhurat session) has ~12 bars instead of ~75. Real short session.
- Some far-OTM legs have `otm_ce_settle` / `otm_pe_settle` = `null` → that batch's `sniper_point` and both spot bands are also `null` for that day. Render those overlay lines as absent. Do not substitute zero or a fallback value.
- The same `instrument_key` legitimately appears under multiple `(atm_batch, leg_role)` combinations. That's the dedup design working, not duplicate data.
