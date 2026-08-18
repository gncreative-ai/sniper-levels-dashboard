Sniper Levels Backtest Dashboard — v1 Build Spec
Status: Draft for review. This is the handoff document for Claude Code to build the web app. Data pipeline (n8n + Supabase) is complete and validated; this document covers the dashboard only.
1. What this tool is
A backtesting visualization dashboard for Sniper Levels, a Nifty 50 weekly-options strategy built from a sellers'-mindset framework — exploiting seller profit-booking and seller panic to take long option positions as a retail buyer.
This tool's job is narrow and specific: let a human visually inspect and replay historical sessions to validate the strategy's setup logic (ATM/OTM selection, sniper bands) against real price action, day by day. It is not:
A live trading or signal-generation tool
Where scenario/entry logic (Scenario 1/2/3) gets implemented — that's a separate, later phase
A general charting app — every element on screen maps to a specific field in the data below
2. Data source
Supabase project: qqkbkhzvhuocapcwzfwi
Access: read-only via the project's anon/publishable key (RLS: SELECT USING (true) on all tables/views below — safe for client-side use, no write access). Pull the current key from Supabase Dashboard → Project Settings → API at build time rather than hardcoding an old one.
2.1 Core tables
sniper_bt_spot_candles_daily — one row per trading day
| column | type | notes |
|---|---|---|
| candle_date | date, unique | |
| open, high, low, close | numeric | |
| volume | bigint | usually null/0 for index |
sniper_bt_spot_candles_5m — Nifty spot intraday
| column | type | notes |
|---|---|---|
| candle_date | date | |
| candle_timestamp | timestamptz, unique | UTC; convert to IST for display |
| open, high, low, close, volume | numeric/bigint | |
sniper_bt_daily_setup — 3 rows per session (one per ATM batch)
| column | type | notes |
|---|---|---|
| session_date | date | |
| atm_batch | text | 'nearest' \| 'before' \| 'after' |
| prev_session_date | date | |
| prev_close, prev_high, prev_low | numeric | prior day's spot OHLC |
| atm_center | numeric | this batch's ATM strike |
| otm_ce_strike, otm_pe_strike | numeric | atm_center ± 100 |
| otm_ce_settle, otm_pe_settle | numeric, nullable | prior-day close of the OTM legs (null if genuinely no trades in the 7-day lookback — rare, real data gap, not a bug) |
| sniper_point | numeric, nullable | (otm_ce_settle + otm_pe_settle) / 2 |
| spot_sniper_upper, spot_sniper_lower | numeric, nullable | atm_center ± sniper_point |
| weekly_expiry | date | |
Unique on (session_date, atm_batch).
sniper_bt_strike_refs — 12 rows per session (3 batches × 4 legs), maps each leg to a real contract
| column | type | notes |
|---|---|---|
| session_date | date | |
| atm_batch | text | |
| leg_role | text | 'ATM_CE' \| 'ATM_PE' \| 'OTM_CE' \| 'OTM_PE' |
| strike | numeric | |
| option_type | text | 'CE' \| 'PE' |
| expiry | date | |
| instrument_key | text | the true join key into candle data — the same instrument_key often appears under multiple (batch, leg_role) combinations; that's expected, not a duplicate |
Unique on (session_date, atm_batch, leg_role).
sniper_bt_option_candles_5m — deduplicated candle storage, not keyed by session/batch/leg
| column | type | notes |
|---|---|---|
| instrument_key | text | |
| strike, option_type, expiry | | |
| candle_date | date | |
| candle_timestamp | timestamptz | |
| open, high, low, close, volume | | |
Unique on (instrument_key, candle_timestamp). To get a leg's chart for a session: look up its instrument_key in strike_refs for that (session_date, atm_batch, leg_role), then query this table by instrument_key and candle_date IN (session_date, prev_session_date).
2.2 Helper views (already built, safe to use)
sniper_bt_pending_sessions — sessions not yet processed by the backfill (not generally needed by the dashboard, but useful if you want to show "data current through X" in the UI).
sniper_bt_session_instruments — one row per session_date with instruments as a pre-aggregated JSON array [{instrument_key, strike, option_type, expiry}, ...]. Handy if you want a session's full unique-instrument list in one query instead of grouping strike_refs client-side.
2.3 Current data coverage
233 completed sessions, Sep 2, 2025 → Aug 11, 2026
3 sessions (Aug 12–14, 2026) pending until their expiry (Aug 18) passes — will auto-complete on the next scheduled backfill run, no dashboard changes needed
Known, non-bug data quirks the UI should handle gracefully, not treat as errors:
Oct 21, 2025 (Diwali Muhurat) has only ~12 bars instead of ~75 — a real short session, not missing data
A small number of far-OTM legs have otm_ce_settle/otm_pe_settle = null (genuinely zero trades in the lookback window) → sniper_point and both bands will also be null for that batch that day. Show these overlays as simply absent, not as an error state.
3. The core concept the UI must express: 3 ATM batches
Each session doesn't have one ATM strike — it has three, computed off the prior day's spot close rounded to the nearest 100:
Nearest — the rounded strike itself
Before — Nearest − 100
After — Nearest + 100
Each of the three gets its own 4 legs (ATM CE, ATM PE, OTM CE, OTM PE) and its own sniper point / upper / lower band, computed independently. The dashboard must let the user toggle which batch they're looking at — everything else on screen (bands, ATM line, 4 leg charts) updates to that batch's data.
4. Dashboard requirements
4.1 Layout, top to bottom
Date range selector — picks the window of sessions available to browse
Session scrubber — a horizontal strip of clickable dates within the selected range; clicking one makes it the active session, driving everything below
Control bar, all in one row:
ATM batch toggle: Nearest / Before / After
Overlay toggles (6 independent switches): Prev Close, Prev High, Prev Low, ATM, Upper Sniper Band, Lower Sniper Band
Replay controls: play/pause, step-forward, reset, speed selector (0.5x/1x/2x/4x), and a position readout (n / total bars)
Main chart — the active session's Nifty spot candles, 5-min resolution, with the 6 overlay levels drawn as horizontal reference lines per their toggle state
Four leg charts, in a fixed 2×2 quadrant grid — this exact arrangement, always, regardless of screen size or batch selected:


ATM PE (top-left)
OTM CE (top-right)
ATM CE (bottom-left)
OTM PE (bottom-right)
Each shows previous session + active session candles, visually separated (e.g. a vertical divider or distinct background band between the two days) so the viewer can see "what the market already knew" (prev day) vs "what's unfolding" (today). On narrow screens, stack in the same reading order (PE, OTM CE, ATM CE, OTM PE) rather than switching to a different arrangement — the quadrant positions are a fixed convention the user reads by muscle memory, not just a default grid layout.
4.2 Replay mode
Replay reveals the active session's 5-min bars progressively, on the main chart and simultaneously on the "today" portion of all 4 leg charts.
The previous-day portion of each leg chart is always shown in full, never subject to replay — this matches the strategy's actual logic: prior-day thresholds are known in advance; only today's price action is what's "unfolding."
Reset returns to bar 0 (nothing revealed); step advances one bar; play auto-advances at the selected speed.
4.3 Interaction model
Changing the date range only affects which dates appear in the scrubber.
Changing the active session (via scrubber) re-fetches that session's setup/legs/candles and resets replay to bar 0.
Changing the ATM batch re-fetches that batch's setup + 4 legs for the same active session (spot chart doesn't change), and also resets replay to bar 0.
Overlay toggles are pure client-side visibility — no re-fetch.
4.4 Per-leg overlay lines
Each of the 4 leg charts needs its own reference lines, drawn on that leg's own premium scale (not the spot scale):
Leg
Prev Close
Prev High
Sniper level
ATM CE
✅
✅
✅
ATM PE
✅
✅
✅
OTM CE
✅
✅
—
OTM PE
✅
✅
—
Prev Close / Prev High are that specific contract's own previous-session values — derive them from the previous day's 5-min bars already being fetched for that leg (close of the last bar of prev_session_date, and MAX(high) across that day's bars). Note: there's no separate daily-OHLC table for options anymore (intentionally dropped as redundant) — compute these from the 5-min bars you're already pulling, don't add a new query for it.
Sniper level (ATM CE and ATM PE only) is sniper_point from daily_setup for the active batch — the same value used to derive the spot upper/lower bands, but here drawn directly on the premium chart since sniper_point is itself a premium-denominated number (average of the two OTM legs' settlement prices). This is the one overlay these two charts share with each other but not with OTM CE/PE.
These respect the same ATM batch toggle as everything else — switching batches changes which sniper_point and which contracts' prev close/high are shown.
4.5 Chart interaction toolkit
All 5 charts (main + 4 legs) need:
Synchronized crosshair — hovering on any one chart shows a matching crosshair position (same timestamp) on all the others simultaneously. This is a standard, well-documented pattern with Lightweight Charts: each chart instance's subscribeCrosshairMove callback drives setCrosshairPosition() on every other chart instance.
Zoom and pan — mouse wheel / pinch to zoom, click-drag to pan, matching TradingView's feel. This is native, built-in Lightweight Charts behavior — mainly a matter of not disabling it, plus sensible default zoom bounds so a chart can't be zoomed into nothing or panned into empty space.
Draw tools (trend lines, horizontal rays, rectangles, fibonacci retracement, at minimum) — usable on all 5 charts, primarily expected to matter most on the main chart.
Feasibility flag, worth reading before estimating this: Lightweight Charts (the free library) does not ship a drawing toolkit — TradingView's full drawing suite lives in their separate, paid Charting Library product, not the open-source Lightweight Charts. Getting TradingView-equivalent draw tools with Lightweight Charts means either (a) building custom drawing primitives on top of its plugin/primitives API — doable, but real scope, not a config flag — or (b) evaluating whether the paid Charting Library is worth adopting instead for this specific requirement. Recommend treating draw tools as its own scoped sub-task once the rest of the dashboard is working, rather than a day-one blocker — the core session-review workflow (sections 4.1–4.4) doesn't depend on it.
5. Technical implementation notes
5.1 Charting library
Use TradingView Lightweight Charts, not a general-purpose charting library (Recharts, Chart.js, etc.). Two reasons:
It's what the existing live GN IMS dashboard already uses — visual/architectural consistency across the person's tools.
Performance: a continuous multi-day 5-min view across the full ~233-session range is 17,000+ candles. Lightweight Charts is built for exactly this; general SVG-based libraries choke well before that scale.
5.2 Fetching strategy
Don't load the whole dataset upfront. Fetch on demand: the session scrubber's date range fetches only spot_candles_daily for that window (cheap, just for the strip); the active session's full detail (setup, legs, candles) fetches only when that session becomes active.
Query option_candles_5m by instrument_key IN (...) + candle_date IN (session_date, prev_session_date) — not by scanning the whole table.
A validated prototype (recharts-based, embedded static data — see attached) confirmed the query shapes and data relationships work end-to-end; production should replace the static embed with live Supabase queries using the same join logic.
5.3 Visual direction
The validated prototype used a dark, data-dense "trading terminal" aesthetic — this is the direction to continue:
Dark background (near-black/zinc-950), monospace for numeric/timestamp values
Green/red candle convention (up/down), amber for ATM, blue for prev-day reference lines, green/red for upper/lower bands
Compact, information-forward — this is a working tool, not a marketing page
5.4 Phased build plan
Build in this order. Each phase must visibly work and be committed before starting the next. Do not skip ahead — later phases depend on earlier ones being correct, and a bug in phase 2 is far cheaper to find than the same bug surfacing in phase 6.
Phase 1 — Skeleton + connection
Vite + React + Tailwind scaffold. Supabase client wired up via env var. Prove the connection works: fetch and display a plain count or list of rows from sniper_bt_spot_candles_daily. No charts yet. Done when: the app runs and shows real data from Supabase.
Phase 2 — Session selection
Date range selector + session scrubber strip, driven by sniper_bt_spot_candles_daily. Clicking a date sets the active session (display it as text for now). Done when: you can browse and select any of the 233 sessions.
Phase 3 — Main spot chart
Lightweight Charts rendering the active session's 5-min spot candles. Correct IST time axis. Done when: selecting different sessions renders visibly different, correct candle data.
Phase 4 — Overlays + batch toggle
The 6 overlay lines on the main chart, their toggles, and the Nearest/Before/After batch toggle. Done when: switching batches visibly moves the ATM and band lines.
Phase 5 — The four leg charts
Quadrant grid (section 4.1), each leg showing prev session + active session with the visual divider, plus per-leg overlay lines (section 4.4). Done when: all 4 legs render correct contracts for the selected batch.
Phase 6 — Replay
Play/pause/step/reset/speed, revealing today's bars progressively across all 5 charts in sync, prev-day always static. Done when: replay runs smoothly end-to-end on a full session.
Phase 7 — Crosshair sync + zoom/pan polish
Cross-chart crosshair synchronization, sensible zoom bounds. Done when: hovering any chart shows the matching time position on all others.
Phase 8 — Draw tools (separate scoped effort — see feasibility flag in 4.5)
Do not start this until phases 1–7 are complete and reviewed.
6. Explicitly out of scope for v1
Scenario 1/2/3 entry/exit signal logic — Scenario 1 is partially formalized elsewhere but not implemented here; this dashboard is for visual inspection, not automated evaluation
Any live/real-time data — backtesting only
Order flow footprint overlay (Dhan) — deferred
Sensex or any other instrument — Nifty only for now
Telegram alerting — not applicable to this tool
7. Reference
A working validation prototype (React + Recharts, real embedded data from the Aug 5–11 2026 expiry week) was built and reviewed before this spec — it confirms the data relationships, the 3-batch toggle behavior, the leg-chart prev/today split, and replay mechanics all work as described above.
Two things to know about that prototype specifically:
It uses static embedded data, not a live date-range picker — the artifact preview environment blocks outbound network calls, so live Supabase queries weren't possible there. Production has no such restriction and should implement the full live date-range selector from section 4.1.
It predates the quadrant layout (4.1), per-leg overlay lines (4.4), and crosshair/zoom/draw-tools requirements (4.5) added in this revision — those aren't reflected in it. Treat this document, not that prototype, as the source of truth for anything added after section 3.
Use it as the interaction reference for what it does cover; production should differ mainly in charting library (Lightweight Charts), live vs. embedded data, and the additions in 4.4–4.5.
