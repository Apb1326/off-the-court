# Off the Court — Master Roadmap

> **Status:** living master plan, **revision 8 + S2c1-R acceptance addendum (2026-07-10)**, verified at `29ad959` plus the S2c1/S2c1-R landing series since committed as `849c2fa`–`21fe8e6`; re-verified executable at `21fe8e6` on 2026-07-11 (profile PASS 32/32, determinism, S2c1-R harness — evidence in `docs/PROJECT_STATUS.md`). Save schema **v7**; transactions **Phases 1–5b implemented**; Stage 1 accepted; F1 done; and **S2a through S2c2 landed** (S2c2 measurement gaps closed by the S2c2-R repair, 2026-07-12). **S2d landed 2026-07-14** (activation, coupled re-baseline/retune, legacy retirement — profile PASS 32/32 on the activated pool; evidence in `docs/PROJECT_STATUS.md`): the NBA-derived pool/selector/diets are the sole production path, **S3 is unblocked**, and F2 is independently dependency-ready. Every claim below was verified against source or execution — where documents disagreed, the code won (§1.4).
>
> **Revision history:** the per-revision change logs (revisions 2–8) were moved verbatim to `docs/ROADMAP_HISTORY.md` on 2026-07-11 — background reading, not required for executing a phase. Phase statuses and outcome records below remain current and grounded; the §-numbered structure is stable and cross-referenced from other docs.
>
> **Precedence:** `AGENTS.md` (hard engineering rules) > `docs/TRANSACTIONS_ROADMAP.md` (transaction-layer phase contracts) > this document. This document owns **global sequencing across all tracks** and the phase specs for everything *outside* the transaction layer; for Phases 1–8 mechanics it defers to the transactions roadmap and records only amendments (§6).
>
> **Home:** `docs/ROADMAP.md`, linked from `AGENTS.md` beside the transaction roadmap. Keep that pointer accurate whenever either document's scope changes.

---

## 0 · How to use this document

This is the map for a long build: a possession-level NBA simulation engine growing into an OOTP-class franchise game. It is written for two readers at once — the maintainer deciding what to build next, and a coding agent executing one phase with no memory of any prior session.

**For coding agents, three standing rules apply to every phase in this document:**

1. **Read `AGENTS.md` first, in full, before touching anything.** Its golden rules and invariants are hard constraints. If a phase in this roadmap ever appears to require violating one, stop and surface the conflict — do not work around it.
2. **An execution unit is one prompt, one reviewable diff-set, one acceptance run.** Large roadmap phases may contain explicitly ordered subphases; each subphase is an execution unit and lands before the next begins. Never reach into a later subphase or phase because it "would be easy while you're in there." Every phase below carries an explicit out-of-scope list; treat it as binding.
3. **`npm run profile` is the acceptance test.** Engine-touching phases must bring the profile to a **pass** (every ENFORCED stat inside its derived tolerance band; the script exits non-zero on failure) and report before/after deltas. Non-engine phases must show it **unchanged**. **`npm run calibrate` is a drift comparison, not an acceptance:** its historical benchmark ends in 2015, so a 2023–26-tuned engine is *expected* to sit well above its era rows (currently ~114.4 engine vs 99.3 for 2010–15). Non-engine phases must show calibrate output unchanged; engine phases must report its deltas and explain their direction — but calibrate cannot pass or fail a phase until it gains the complete modern era-matched benchmark derivation deferred to Horizon. Both kinds of phase re-run `tsx scripts/test-determinism.ts`.

**The working pattern** (how execution units get built here): the feature is discussed and agreed first; a complete, self-contained Claude Code prompt is produced (no external context assumed — Claude Code has no cross-session memory); the prompt is sanity-checked on two axes (engineering soundness, basketball/architecture domain logic) and every finding is folded into a single final version; the final prompt is committed under `docs/prompts/` before it runs (the folder exists as of R0b; the legacy `PHASE_*_IMPLEMENTATION_PROMPT.md` files live there now, alongside the archived Stage 1 prompt). **Archive-gap record (2026-07-11):** the S2a, S2b/S2b-R, S2c1, and S2c1-R prompts were never committed — a lapse, not a policy change; the discipline resumes with S2c2, and `docs/prompts/README.md` indexes the archive and the gap. §10 contains the per-unit prompt skeleton to instantiate.

**Reading order:** §1 is the verified current state — the ground truth this plan starts from. §2 restates the design north stars that shape sequencing. §3 is the dependency map and the recommended global order. §§4–7 are the per-track phase specs. §8 is the consciously-unscheduled horizon. §9–10 and the appendices are the cross-cutting machinery (invariant deltas, the prompt template, the stop-and-surface registry, the artifact/oracle registry).

---

## 1 · Verified current state (2026-07-05 snapshot + 2026-07-06 local acceptance run)

### 1.0 The local acceptance runs (2026-07-06) — what they settled

> **Revision 7 addendum — S1-R landed and was accepted the same day.** The failing run below is preserved as the historical record that triggered S1-R. The repair's own accepted runs: **S1-Ra** (PR #20, commit 8c27361) removed the engine's ambient seed fallbacks with fixed-seed profile/game output verified **byte-identical** to the pre-refactor baseline, plus focused missing/invalid API-seed tests (`scripts/test-seed-boundary.ts`). **S1-Rb** (PR #21, commit acc011f) diagnosed the margin excess (`scripts/diagnose-margin.ts`: broad across all quantiles, growing from Q1, not mismatch-driven — strength-gap vs margin r = 0.11; root cause: no margin-compressing effort behavior, so signed-margin SD random-walked to ~20 vs real ~15.8) and repaired it with the bounded symmetric coasting/effort term. Final result: **`npm run profile` PASS — 32/32 ENFORCED in band, exit 0; average margin 13.4 vs 12.87 ± 1.0**, all other enforced stats unmoved; determinism, spacing/defense A/B, seed-boundary, and coasting harnesses green; calibrate drift deltas reported (margin 15.7→12.4, SD 14.1→12.9; scoring level unchanged). The assisted-zone sign structure was **diagnosed and handed off** (§4.1a outcome).

The maintainer executed the verification suite on the working machine, resolving what the snapshot alone could not (historical record — since repaired, see the addendum above):

- **GREEN:** `npm run typecheck` · `tsx scripts/test-determinism.ts` · `tsx scripts/test-spacing-ab.ts` · `tsx scripts/test-defense-ab.ts` · `scripts/test-phase5b.ts` · `derive-league-targets.ts --check` (byte-idempotency) · `npm run validate-nba-data`.
- **RED:** `npm run profile` — **average margin 16.8 vs target 12.87 ± 1.0** (ENFORCED → the profile fails and exits non-zero). Additionally, the INFORMATIONAL assisted-zone **sign-structure check fails**: corner three is not the highest-assisted zone in engine output, contradicting the stated sanity criterion for that reference.
- **Recharacterized:** `npm run calibrate` prints 114.4 engine points vs 99.3 for its most recent era (2010–15). The historical dataset ends in 2015, so this gap is expected for a modern-tuned engine — the script is a drift check, not an era acceptance (§0 rule 3).

Consequence at the time: **Stage 1 was implemented but not accepted.** Under `AGENTS.md`'s own rule (an engine change failing calibration is unfinished) and this document's rule 3, the "shipped" status recorded in revision 3 was wrong — it inferred acceptance from constants annotations, which this document's maintenance rule does not permit. S1-R (§4.1a) was inserted as the repair phase and **has since landed and been accepted** (revision 7 addendum above): Stage 1 is now **implemented and accepted**.

### 1.1 Shipped and verified in source

**Simulation engine** (`src/engine/`):
- Possession loop with the advantage-keyed ball-movement chain (`possession.ts`): up to `MAX_EXTRA_PASSES = 2` extra actions — i.e. up to **three chained actions total** (the initial action plus two extras; the constant counts *extras*, which is why older discussion notes say "up to 3 chained actions" — same code, two phrasings; this sentence exists so nobody "fixes" one to match the other); quality bonuses keyed to advantage state with diminishing returns (`ADVANTAGE_BONUS_DIMINISH`) and a hard ceiling (`ADVANTAGE_BONUS_CEIL`); real double-team kick-outs (`DOUBLE_TEAM_PASS_PROB = 0.90`); chain-only assists; per-pass clock cost and bad-pass risk; late-clock rush penalty (`SHOT_CLOCK_PRESSURE_THRESHOLD` / `SHOT_CLOCK_RUSH_PENALTY`).
- **Six-zone shot model (Stage 1).** `ShotZone` in `models/game.ts` is `rim | short_midrange | long_midrange | corner_three | above_break_three | deep_three`, with the settled NBA-shot-chart mapping documented in `constants.ts` and `docs/LEAGUE_TARGETS.md`: rim = Restricted Area only; short_midrange = Paint (Non-RA) + Mid-Range < 14 ft; long_midrange = Mid-Range ≥ 14 ft; deep_three = above-the-break threes ≥ 27 ft (below the 32 ft heave cutoff). Zone bases (`BASE_FG_PCT_BY_ZONE`) and `PLAY_TYPE_SHOT_ZONES` are retuned against the empirical targets with in-file provenance annotations. The old five-vs-six zone-taxonomy drift is **resolved**, and the retune passed acceptance after the S1-Rb margin repair (§1.0 addendum).
- Spacing & defensive versatility (`spacing.ts`): centered off-ball-four spacing (Moreyball shot-mix hooks, rim-deterrence relief, openness), weak-link versatility floor with mobility/size spread penalties, both pure arithmetic (no RNG). Baselines are static constants (`SPACING_BASELINE_OFFBALL_FOUR = 0.2168`, `SPACING_SPREAD = 0.0707`, `VERSATILITY_BASELINE = 0.4917`, `VERSATILITY_SPREAD = 0.0743`), re-derived at **S2d (2026-07-14)** from the activated pool by `tsx scripts/calibrate-spacing.ts` — spacing weighted by each finisher's actual production selection share (the shared `primaryPlayerWeight` × the lineup's `explainPlayTypeSelection` mix), versatility from the configured starter fives; the drift limitation of a static baseline is documented in `constants.ts` and deliberately deferred (picked up in **F4**, §5.4). Both A/B tests are **green on the activated pool** (defense fixtures rescaled to its rating scale).
- Usage enforcement: `selectPrimaryPlayer` (`play-types.ts`) weights by raw `tendencies.usageRate` with a `PRIMARY_PLAYER_MIN_WEIGHT` floor.
- Game loop (`index.ts`): momentum, home-court edge, clamped per-game form (±13%), forced mid-game exits for in-game injuries (`inGameExits`), stats derived exclusively from the `PlayByPlayEvent` stream via `recordEventStats` → `StatsAccumulator`. The `addXStats` stubs remain intentional no-ops. *(S1-Rb's diagnosis confirmed the margin failure lived in game flow — specifically the absence of margin-compressing effort behavior — and added the bounded symmetric coasting/effort response (`COAST_*` constants in `constants.ts`, additive inside the shot clamp); see §4.1a outcome.)*
- Tactics (`tactics.ts`): clock management, three-chasing, intentional fouls. Shot resolution (`shot.ts`) is additive-and-clamped per `AGENTS.md`, with the FT inverse pair (`FT_LEAGUE_AVG_PCT = 0.7823` / `FT_PCT_SLOPE` / `FT_DERIVE_SCALE`, sim clamps `FT_SIM_PCT_MIN/MAX`). *Residual resolved at S2d (2026-07-14):* the anchor was re-set to the empirical 2023-26 FTA-weighted **0.7823** and the round trip is asserted by the S2d harness (`scripts/test-s2c1-r.ts`).
- **Injury system** (`injury.ts` + `season.ts`): durability-scaled base rate, age multipliers, back-to-back and dense-stretch schedule stress, workload curve, season-stable hidden fragility (seeded, redistributive), post-recovery re-injury windows with same-region bias, in-game exits, `INJURY_MIN_HEALTHY_ROSTER = 8` hardship floor, `adjustRotation` starter repair, and an append-only per-season `injuryHistory` designed to concatenate into a career log later. Injury rolls run on a **separate deterministic RNG stream** per game (`deterministicSeed(state.seed, 'inj_' + gameId)`).
- Season advancement (`season.ts`): monotonic and idempotent (`currentDate` never rewinds; completed game IDs never re-simulate); per-game seeds derive from `season.seed + gameId`, so "full RNG state" is exactly `season.seed` + the set of played games. **The seed boundary is shipped (S1-Ra):** `createSeasonState`, `simulateSeason`, and `simulateGame` require an explicit seed — the old `Math.random()`/`Date.now()` fallbacks are gone from `src/engine`; seed validation/selection lives at the API boundary in `src/lib/seed.ts` (400 on malformed seeds; a valid seed chosen and persisted when omitted), covered by `scripts/test-seed-boundary.ts`.

**Stage 1 calibration instrumentation (implemented and accepted after S1-R; the full record is §4.1):**
- `scripts/derive-league-targets.ts`: a pure, deterministic, RNG-free derivation over `data/nba/normalized/` (sorted iteration, fixed float formatting, byte-identical re-runs — **`--check` green in the local run**) that computes every empirical target the profile enforces, writes the provenance report `docs/LEAGUE_TARGETS.md`, prints a ready-to-paste transcription block, and supports `--seasons` (era window override).
- `docs/LEAGUE_TARGETS.md`: the committed provenance report — season window **2023-24 · 2024-25 · 2025-26** (pooled: 3,690 games / 7,380 team-games / 657,387 shot attempts; 1,721 heaves excluded), formulas, numerator/denominator/units per metric, sample sizes, tier assignment, and caveats. All rates from **summed counts**, never averaged across players or seasons.
- `scripts/profile-engine.ts`: rewritten as the acceptance instrument — **ENFORCED targets with derived tolerance bands** (tol = max(max single-season deviation from pooled, documented floor)) across the box profile, per-zone realized FG% (6), six-zone FGA shares, three-bucket shares, and average margin; **INFORMATIONAL references** (logged, never fail, each annotated with the stage that owns closing its gap: play-type distribution → Stage 2, assisted-rate-by-zone → Stage 2/3, PBP transition cross-check → Stage 2, turnover-type mix / and-one / putback / ORB rate → Stage 3). Exits non-zero on any ENFORCED failure — which it did on margin until S1-Rb; it now exits 0 with all 32 ENFORCED stats in band (§1.0 addendum). `AGENTS.md`'s calibration section and acceptance checklist are updated to this contract.

**Persistence & saves** (`src/data/saves/`, `src/models/save.ts`):
- Multi-save store: one folder per save under `data/saves/` with `save.json` + cheap `metadata.json`, atomic temp-file-then-rename writes, reserved `__autosave__` slot, `active.json` pointer, load-then-play copies a manual slot into the autosave so checkpoints can't be clobbered.
- `SAVE_SCHEMA_VERSION = 7` with an ordered migration chain: v1→v2 (FA pool + transaction log), v2→v3 (full contracts, generated deterministically from `SeededRNG(fnv1a(player.id))` at the shared `normalizePlayersForSave` boundary), v3→v4 (explicit re-signing rights reconstructed from immutable cut snapshots; persisted event-set hard-cap state), v4→v5 (TPE grants + operated-under-cap ledgers, empty-init), v5→v6 (recompute persisted usage + free-throw derivations from canonical career stats), v6→v7 (F1: top-level `controlledTeamId`, `null` for pre-F1 saves). `scripts/recompute-derived.ts` is the standalone refresh tool; `scripts/test-save-migration.ts` and `scripts/test-contract-migration.ts` are the round-trip checks.

**Transactions layer** (`src/transactions/`) — **Phases 1 through 5b are implemented**, including:
- The atomic validate-then-mutate gate (`gate.ts`) with composable validators (`validators.ts`): roster → cap → apron → temporal/NTC, plus the full Phase 4 matching modes (`room` / `standard` / `aggregated_standard` / `expanded`), hard-cap triggers persisted as event-set state on `Team.hardCappedAtApron`.
- Phase 5a consequences: dead money + stretch (`deadMoney.ts`), banked Standard TPEs (`tpe.ts`), MLE/BAE exception ledgers (`exceptions.ts`), canonical cap-year date helpers (`date.ts`), and the **pure, tested but unwired** contract-lifecycle seam `processContractRollover` (`rollover.ts`). *Verified gap (revision 4):* `processContractRollover` removes players from rosters **without repairing persisted `RotationSettings`** — acceptable while unwired, but it means F3 cannot compose it into a live season cycle without a rotation-normalization step (§5.3).
- **Phase 5b sign-and-trade is implemented** (`applySignAndTrade` in `gate.ts`, dedicated validators, a `sign_and_trade` transaction-entry type, TPE integration); its harness `scripts/test-phase5b.ts` is **green in the local run**. Revision 6's **R0a** corrected the transaction roadmap's stale Phase-5b/schema-v5 status.
- `evaluateTradeForCpu` (`evaluate.ts`) remains the documented Phase 1 accept-all desirability stub; the legality/desirability seam is clean.
- The gate threads an optional `controlledTeamId` through trade options for NTC consent (`noControlledTeamNtc`). **RESOLVED (F1, 2026-07-07):** the canonical controlled-team identity now lives at top-level `SaveFile.controlledTeamId` (schema v7), read through `src/franchise/controlled.ts`; the gate option remains the per-call NTC seam and the gate stays symmetric.

**NBA data pipeline** (`pipeline/`, `src/data/nba/`) — **Stage 0 built AND the OP-1 harvest has run:**
- Python harvester (`harvest.py`, resumable raw cache, failure ledger, rate-limited); deterministic idempotent normalizer (`normalize.py`) emitting **schema_version 3** contracts; optional BDL/ESPN→personId crosswalk; TS mirrors and loaders (`src/data/nba/`, `NBA_DATA_SCHEMA_VERSION = 3`); structural validator `npm run validate-nba-data` — **green in the local run**.
- **Harvest evidence:** `docs/LEAGUE_TARGETS.md` carries real pooled sample sizes, per-season breakdowns, the nba_api version from the manifest, and a **100.000% made-FG assist join coverage** (309,532/309,532) against the ≥ 99.9% gate. The OP-1 gate condition (§4.0) is satisfied on the working machine for every contract Stage 1 consumed.
- Season coverage per `pipeline/manifests/default.json` (season-start-year keys): `box_advanced` + `shot_locations` **1996–2025** (i.e. through 2025-26), `synergy` + `hustle` **2015–2025**, `tracking` + `pt_defend` **2013–2025**, `lineups` **2007–2025**, `matchups` **2017–2025**, `combine` **2000–2025**, and `game_logs` + `shot_charts` + `pbp` **2023–2025 only** (the three seasons 2023-24..2025-26 — the Stage 1 era window).

**App shell** (`src/app/`): menu (new game / save management), league, roster, schedule (with standings), player detail, single-game sim page; API routes for players, teams, season, sim, saves. New-game team picker (F1) selects the controlled franchise (spectator default). No transaction UI, no playoffs, no offseason flow.

### 1.2 Built-but-unwired seams (ready, waiting for a phase)

- `processContractRollover` — pure, deterministic, harness-tested; not called by any app/season flow. Consumed by **F3** (§5.3), which must pair it with rotation normalization (§1.1 note).
- `getScoutedRatings` / `improveScoutingAccuracy` (`ratings/scouting.ts`) — exported, consumed nowhere. Consumed by **U1** (§6.3).
- `evaluateTradeForCpu` — the Phase 6 seam, currently accept-all.
- `crosswalk.json` — optional, transitional; only matters if the *current* BDL/ESPN-keyed pool is migrated rather than replaced (Stage 2 decision, §4.2).
- `InjuryHistoryEntry.season` — self-contained per-season records designed to concatenate into a career injury log; multi-season concatenation lands with **F3**.
- The INFORMATIONAL blocks in `profile-engine.ts` — Synergy play-type shares, per-zone assisted rates, the PBP transition proxy, and the Stage-3 texture rates — are pre-derived reference data with named stage owners, waiting for S2/S3 to consume them.
- `adjustRotation` (`injury.ts`) — the existing deterministic rotation-repair logic for injuries; **F3's rotation-normalization primitive generalizes this pattern** to roster-membership changes (§5.3) rather than inventing a parallel one.

### 1.3 Known drift & debt (the honest ledger)

1. **RESOLVED (revision 7): S1's acceptance failure is repaired.** The historical record: as of the 2026-07-06 local run, average margin was 16.8 vs 12.87 ± 1.0 (ENFORCED — the profile exited non-zero) and the informational assisted-zone sign-structure check failed. **S1-Rb** repaired margin to 13.4 (profile PASS 32/32, exit 0) and diagnosed/handed off the sign structure (§1.0 addendum, §4.1a outcome). The final open piece — the assisted sign structure's fix itself — was **RESOLVED by S2c2** (2026-07-11): the measurement-side scorekeeper-aligned proxy recorded in `docs/S2C2_ASSIST_DECISION.md`; engine credit mechanics unchanged (any loosening remains S3.g).
2. **RESOLVED (revision 7): the engine no longer chooses ambient seeds.** **S1-Ra** made `createSeasonState`, `simulateSeason`, and `simulateGame` require explicit seeds and moved validation/selection to the API boundary (`src/lib/seed.ts`). The remaining `Math.random` ledger outside the engine: `src/data/ingest/transforms.ts:77` (BDL placeholder contract years — real violation, mooted when S2 retires the BDL path); `scripts/seed-test.ts` throughout (out of policy; resolved at S2 per §9.2).
3. **A documented Stage-1 compensation is live in `PLAY_TYPE_SHOT_ZONES` — Stage 2 owns the unwind.** The engine's hardcoded play-type *frequencies* run far from Synergy reality (cut and isolation over-selected; transition and pick-and-roll under-selected). Fully-real per-type shot diets under that skewed mix would land league rim share several points high, so cut and spot_up diets are **deliberately shaded** toward short_midrange/threes "to the edge of narratability" — flagged in-file as `KNOWN STAGE 2 ARTIFACT` with an explicit re-tune instruction. The acceptable, documented form of the pool-artifact trap — but debt with a due date (**S2**, §4.2). **S2c2 (2026-07-11) locked the real cut/spot-up diets into the candidate-only `PLAY_TYPE_SHOT_ZONES_REAL`; S2d (2026-07-14) promoted them into the sole `PLAY_TYPE_SHOT_ZONES` and deleted the shaded table — the unwind is complete. The residual finisher-mix compensation now lives in one annotated per-zone table (`SHOT_ZONE_FREQUENCY_FACTORS`, the fold of the former global three-point dampener); S3's richer chain mechanics own shrinking it toward 1.0.**
4. **`npm run calibrate` is a drift check mischaracterized as an era acceptance (revision 4).** Its FiveThirtyEight-derived historical data ends in 2015; the engine is tuned to 2023–26 targets, so the current 114.4-vs-99.3 gap is expected, not a defect. Reclassified per §0 rule 3; every checklist's "sane by era" criterion is retired. A complete modern-era row needs its own normalized-games derivation (including scoring spread and home-context fields), so that upgrade remains in Horizon rather than S1-R.
5. **Resolved in revision 8:** R0a correctly recorded the then-current Phase-5b/schema-v6 state, but F1 later advanced the repository to schema v7. `docs/TRANSACTIONS_ROADMAP.md` now distinguishes that historical transaction schema from the repository's current schema and names 5c's full prerequisite set.
6. **Roster mutations outrun rotation repair in two places (revision 4 — sequencing bug fixed in spec):** (a) in-season trades don't repair `RotationSettings` or split stat stints — **F5**; (b) *offseason* mutations (F3 rollover/autofill, F4 retirement) would strand departed players in persisted rotations the moment F3 wires the seam — fixed by moving a shared deterministic **rotation-normalization primitive into F3** (§5.3), reused by F4 and F5 (§9.10).
7. **One `option?` per contract**; flat signing schedules. Documented simplifications — revisit at Phase 8.
8. **RESOLVED (R0b):** the `shouldDoubleTeam` doc comment in `defense.ts` now describes the real kick-out routing; the `AGENTS.md` "Known cleanups" entry is retired.
9. **RESOLVED (R0b):** `README.md`'s project tree now includes `src/transactions/`, `src/data/saves/`, the `menu`/`league` pages, the saves API routes, and `docs/prompts/`, and its calibration wording carries the profile-vs-historical-calibrate distinction.
10. **Advanced stats (`StatLine.trueShootingPct` etc.) are unpopulated** and the `addXStats` stubs are intentional no-ops — conscious deferral, Horizon (§8).
11. **RESOLVED (S2d, 2026-07-14) — FT anchor nit:** `FT_LEAGUE_AVG_PCT` re-anchored from 0.781 to the enforced empirical **0.7823**; the inverse round trip and endpoint clamps are asserted in the S2d harness.

### 1.4 Remaining unknowns (all three closed by S1-R and R0b)

- **The margin failure's root cause** — DIAGNOSED (S1-Rb): the engine lacked margin-compressing effort behavior; real signed-margin SD sits below the independent-possession variance floor. Repaired via the bounded coasting/effort response (§4.1a outcome).
- **The assisted sign-structure failure** — DIAGNOSED (S1-Rb): independent of the margin cause; routing is correct, the gap is the definitional mismatch between the NBA scorekeeper assist and the engine's strict chain assist. Handed to the S2/S3 assist-definition mapping owner (§4.1a outcome); **RESOLVED by S2c2** — `docs/S2C2_ASSIST_DECISION.md`.
- **The finalized Stage 1 implementation prompt** — COMMITTED (R0b): `docs/prompts/STAGE_1_IMPLEMENTATION_PROMPT.md`, the recovered verbatim prompt annotated with §4.1's divergence log, the acceptance-failure record, and the S1-R repair record.

---

## 2 · Design north stars (what shapes the sequencing)

**OOTP is the reference model.** Dual-layer ratings (true vs. scouted), matchup resolution from true ratings, calibration discipline against real distributions, save/state architecture built for decade-long careers. When a design question is open, "how does OOTP handle this?" is the first lens.

**The two load-bearing design problems** remain the organizing spine of the sim track:

1. **One ball / usage.** Player value is not additive because possessions are scarce. Usage allocation is *enforced* in possession distribution (shipped: raw `usageRate` weighting). Stage 2 makes the usage inputs real (empirical `usgPct`); the trade-AI valuation (Phase 6) must inherit non-additivity rather than reinvent it.
2. **Lineup fit.** Spacing and weak-link defensive versatility carry the non-linear value pure individual ratings miss (shipped, centered, RNG-free). Stage 2 improves their *inputs*; F4 makes their *baselines* track a changing league; Stage 3 can validate the whole model against real five-man lineup data.

**Ratings are inputs; the event stream is output — and the loop between them stays open.** Stats derive from `PlayByPlayEvent`s; ratings and tendencies drive the sim. Explicit invariant (§9.1): **no automatic path may re-derive ratings or tendencies from sim-generated stats.** Once F3 folds simulated seasons into `careerStats`, sim-generated rows carry a provenance tag and every recompute/derivation tool filters to real-NBA rows — because the feedback loop's most likely entry point is not rollover but a *future migration* innocently re-running `recomputeUsageAndFreeThrowFields` over a multi-season save. Player change flows through exactly one deliberate channel: F4's development functions — functions of (ratings, potential, age, seeded variance), never of box scores.

**Determinism has domains — and `src/engine` is absolute.** No ambient randomness inside the engine, ever; revision 4 repeals the one exception revision 3 tried to write (§1.3.2). Ambient `Math.random` is sanctioned only at the app boundary, for choosing a brand-new world's seed, which is then persisted; everything the engine does descends from persisted seeds via `SeededRNG` on stable keys. **One-shot boundary generation** (contract migration) may seed from save-independent per-id keys; **recurring per-season generation** (F4 development, replacement players) must mix the save's seed lineage (§5.4, §9.2). The harvester may jitter with plain `random` (pipeline scope); `normalize.py` and `derive-league-targets.ts` stay pure idempotent functions of their inputs — the latter proves it with a `--check` byte-comparison gate, the shipped exemplar of §9.3.

**Pool-artifact compensation is the named trap — and Stage 1 shows both the trap and its acceptable form.** The unacceptable form is *silent*; the shipped `PLAY_TYPE_SHOT_ZONES` shading (§1.3.3) is the acceptable form: consciously incurred, documented in-file with the real values it deviates from, and assigned an owner (S2) for the unwind. The mitigation remains sequencing (§3) plus the re-baseline matrix (§3.3).

**Statuses are earned by acceptance runs, not by artifacts.** Revision 4's own correction is the standing example: committed constants, provenance annotations, and a derivation report are evidence of *implementation*; only a reported green acceptance run earns *shipped*. This document never again records "shipped" from inference.

---

## 3 · The map: tracks, dependencies, and the recommended order

### 3.1 Tracks

- **Track S — Simulation & data** (§4): the pipeline-driven engine overhaul. Stage 1 (implemented and accepted; **S1-R repair landed**) → Stage 2 (**complete 2026-07-14**: S2a through S2d landed; the NBA-derived pool/selector/diets are the sole production path) → Stage 3 (mechanics enabled by richer data; now unblocked). Strictly sequential within the track.
- **Track F — Franchise cycle** (§5): F1 team selection → F2 playoffs → F3 multi-season seam (offseason v1, now including rotation normalization) → F4 development & aging v1 → F5 in-season transaction integration. F1 and F2 are independent of Track S; F4 wants Stage 2's real pool and Stage 0's longitudinal data.
- **Track T — GM & transactions** (§6): 5c harness → 6 trade AI → 7 ecosystem → 7.5 RFA → 8 draft — with amendments recorded here. Track T's authoritative acceptance instrument (the 5c harness) depends on Track F's season-cycle seam **and on F5's in-season integration**.
- **Track U — presentation & UX** (§7): runs alongside; U1 (GM UI v1 + scouting fog-of-war) is pinned to Phase 7.

### 3.2 Recommended global order

Sim-engine quality before GM features; saves before transactions (done); team selection before user-facing GM flows; each wave is one or more independently-promptable phases. Items marked ∥ may run in **either order — but sequentially, each landing on main and re-validating against the then-current targets before the next starts**. ∥ never means concurrent branches. Everything else is a real dependency edge.

| Wave | Phase | Track | Status / why here |
|---|---|---|---|
| 0 | **OP-1 — full harvest, normalize, validate** | S | ✅ **DONE** (§1.1 evidence; validator green in the local run). |
| 1a | **S1 — Stage 1 league calibration** | S | ✅ **IMPLEMENTED AND ACCEPTED** (§1.0/§4.1) — acceptance initially failed on margin; repaired by S1-R. |
| 0′ | **R0a — discoverability & current-state truth-up** | — | ✅ **DONE** (revision-6 diff landed). Added this roadmap, linked it from `AGENTS.md`, and corrected the transaction roadmap's Phase-5b/schema-v6 status. |
| 1a′ | **S1-Ra/b — seed boundary, then Stage-1 acceptance repair** | S | ✅ **DONE** (PRs #20/#21, 2026-07-06). S1-Ra: behavior-preserving seed-boundary repair, byte-identical checkpoint verified. S1-Rb: margin diagnosed and repaired to 13.4 (profile PASS 32/32, exit 0); assisted sign structure diagnosed and handed off (§4.1a). |
| 0″ | **R0b — post-repair housekeeping** | — | ✅ **DONE** (this revision-7 diff). Recorded the accepted Stage-1 result, codified the settled seed boundary, fixed stale comments, created `docs/prompts/`, and refreshed README (§3.4). |
| 1b | **F1 — team selection** | F | ✅ **DONE** (2026-07-07). `SaveFile.controlledTeamId` (schema v7 + migration), accessor pair in `src/franchise/controlled.ts`, API-boundary validation in the new-game route, menu team picker with spectator default, save-summary team tag. Profile/calibrate byte-identical; save/migration/determinism checks green. |
| 2a | **S2a / S2b / S2b-R — candidate league and ratings** | S | ✅ **DONE** (PRs #24/#25). Candidate artifacts and statistical contract are committed but inactive. |
| 2b | **S2c1 — candidate tendencies + evaluation seam** | S | **Implemented.** Candidate-only real usage/play-type/shot-mix derivation, coverage contract, and read-only informational profiling seam landed; candidate remains inactive. **S2c1-R complete:** candidate selection now consumes possession-level tendencies through an explicit candidate-only configuration, with terminal bands passing on seeds 2026, 7, and 42; active default remains byte-identical. |
| 2c | **S2c2 — assist decision + compensation unwind** | S | **Implemented.** Candidate-only scorekeeper proxy and locked real diets; decision/report in `docs/S2C2_*`. |
| 2d | **S2d — activation, re-baseline, legacy retirement** ✅ 2026-07-14 | S | Done. Promoted the real diets into the sole table, retired the shaded table + legacy selector + BDL/seed paths, re-derived baselines, re-passed profile 32/32; promotion manifest + activation-context gate anchor gated runs. |
| 3 | **F2 — playoffs** ∥ **S3 — Stage 3 mechanics (first tranche)** | F / S | **F2 is dependency-ready now. S3 unlocks only after S2d.** Once both are ready, land one unit at a time on main; F2 makes the championship metric real before the 5c baseline. |
| 4 | **F3 — multi-season seam (offseason v1) + rotation normalization** | F | Wires `processContractRollover` into a pure season→season advance — now including the shared deterministic rotation-repair primitive (§5.3), because rollover/autofill themselves mutate rosters. The 5c harness drives *this* seam — never a private fork of it. |
| 5 | **F4a–c — curves, development, retirement/continuity** | F | Three ordered execution units (§5.4): empirical curve artifact; development and evolved-pool profiling; then retirement, replacement generation, and dynamic baselines. Retirement uses the F3 rotation primitive. Before the authoritative 5c baseline. |
| 6 | **F5 — in-season transaction integration** | F | Ahead of the harness. Reuses the F3 rotation primitive for in-season mutations; adds stat stints and live-deadline wiring — the parts genuinely in-season-specific. |
| 7 | **T-5c — league-balance harness + authoritative baseline** | T | Infrastructure before the feature it judges. Paired trade-free suite captured on the post-S2d/F2/F3/F4c/F5 world. Its sequence-level value-flow metrics are **normative** for T-6/T-7 (§6.1). |
| 8 | **T-6 — trade AI (CPU valuation)** | T | Valuation calibrated on the real post-S2d pool. Judged against the paired 5c suite; fuzzer trades at any legal in-season date (F5 shipped). |
| 9 | **T-7a — autonomous ecosystem** → **U1a–c — GM UI v1** | T/U | Four ordered execution units (§6.3): agency first, then trade/inbox UI, free-agency/finance UI, and scouting. |
| 10 | **T-7.5 — restricted free agency** | T | Needs CPU agency (offer sheets are CPU-driven). |
| 11 | **T-8a–d — order, assets, prospects, draft event** | T | Four ordered units (§6.5) covering lottery/order, tradeable picks, prospects/contracts, then the F3-integrated event. Replaces F4's replacement-level generation as normal league inflow. |
| — | **Horizon** (§8) | — | Consciously unscheduled. |

Four sequencing edges worth restating because they are easy to get backwards:

- **R0a may precede the green baseline; behavioral work may not.** A before/after hash proves that a docs-only diff preserved even a failing profile. S1-R still precedes every feature phase whose acceptance or tuning assumes a green engine baseline.
- **F4 before the 5c baseline, and the baseline immediately before T-6.** The trade-free control and the trades-on experiment must run on the *same world model*.
- **F5 before T-5c.** The harness's fuzzer executes real trades through the real gate at in-season dates; stat stints and deadline wiring must exist first. (Rotation repair for the *offseason* half of the cycle now arrives even earlier, at F3.) The offseason-only-fuzzer alternative remains rejected: it would leave deadline-window behavior — the most balance-relevant trade window — untested through T-6's entire acceptance.
- **S2 before T-6.** Trade valuation calibrated against the heuristic pool is calibration debt with a due date.

### 3.3 The re-baseline matrix (what invalidates what)

Every tuned artifact has upstream dependencies. When a phase in the left column ships, every artifact marked ● **must be re-derived/re-verified inside that same phase's acceptance**. ○ = check, usually unaffected. The profile column means: **the derived targets + bands** (refreshed only when the data or era window changes) and **a passing profile run** on the phase's engine.

| Phase ↓ / Artifact → | Profile targets & bands | Profile PASS on current engine | Calibrate drift report | `SPACING_*` / `VERSATILITY_*` baselines | A/B thresholds | FT inverse pair (`FT_*`) | 5c trade-free baseline | Phase-6 valuation calibration |
|---|---|---|---|---|---|---|---|---|
| **S1** *(implemented + accepted)* | ● done (targets derived + transcribed) | ✅ **PASSING** (margin repaired by S1-R) | ○ (report deltas) | ○ | ○ (green in local run) | ✅ (0.781 nit settled at S2d — §1.3.11) | n/a yet | n/a yet |
| **S1-R** *(done — PRs #20/#21)* | ○ unchanged (no target edits — §4.1a) | ● **PASS achieved** (32/32, exit 0) | ○ (deltas reported: margin 15.7→12.4, SD 14.1→12.9) | ○ (checked) | ● re-run — green | ○ | n/a yet | n/a yet |
| **S2** (new pool) | ○ (targets unchanged unless the era window moves) | ● (must re-pass; includes the §1.3.3 unwind) | ○ (report deltas) | ● | ● (re-verify signed effect + magnitude) | ● (round-trip re-asserted; settle the nit) | n/a yet | n/a yet |
| **F4a–c** (development; dynamic baselines; replacement generation) | ○ | ● (year 1 byte-identical; evolved pools at years 3/5/10 must PASS) | ○ (year 1 unchanged; evolved-pool deltas reported) | ● (per-season deterministic snapshot; constants remain the season-1 anchor) | ● on evolved pools | ○ | ● (capture *after* F4c) | n/a yet |
| **F2 / F3 / F5** (cycle plumbing) | ○ unchanged | ○ unchanged (any diff is a bug) | ○ unchanged | ○ | ○ | ○ | — | — |
| **T-6 / T-7** (trades on) | ○ unchanged | ○ unchanged | ○ unchanged | ○ | ○ | ○ | consumed (compared against) | ● (this is the phase) |
| **Any later engine change** | ○ (unless it changes what should be measured) | ● | ○ (report deltas) | ○ unless pool/lineup math touched | ○ | ○ if FT path touched | ● if world dynamics touched | ○ |

Appendix B lists each artifact's file location, owner script, and refresh command.

### 3.4 R0a/R0b — truth-up without blocking discoverability

**Goal:** keep the written record discoverable and truthful without coupling docs-only work to an unrelated engine repair.

**R0a — before S1-R, docs only (implemented and verified in the revision-6 diff):**
- Add this document as `docs/ROADMAP.md` and add its `AGENTS.md` pointer; mark R0a done when the diff lands.
- Correct `docs/TRANSACTIONS_ROADMAP.md`: Phases 1–**5b** implemented, schema **v6**, Phase 5b harness green, 5c next transaction phase subject to the F3/F4/F5 prerequisites here.
- Do not state the future seed-boundary architecture as shipped; describe it as S1-R work.

**R0b — after S1-R, docs/comments only (✅ done in the revision-7 diff):**
- Record S1-R's accepted profile result and its diagnosis/hand-off for assisted sign structure.
- Fix the `shouldDoubleTeam` stale comment in `defense.ts`; codify the now-shipped boundary-seed architecture in `AGENTS.md`; reclassify `npm run calibrate` per §0 rule 3; and clarify the final T-6 terminology from §6.2 without weakening the no-value-pump invariant.
- Create `docs/prompts/`, move/copy the existing `PHASE_*_IMPLEMENTATION_PROMPT.md` files into it, and commit the finalized Stage 1 prompt as a historical record annotated with §4.1's divergence and repair record.
- Refresh `README.md`'s project tree and calibration wording. Optionally add the npm `derive-targets` alias.

**Acceptance:** each slice captures pre-change profile/calibrate output, then proves it byte-identical after the docs/comment diff. R0a may preserve the inherited failing profile; R0b preserves S1-R's accepted run. `npm run typecheck` remains clean; no behavioral source changes.

**Out of scope:** everything else. Neither slice is a refactor license.

---

## 4 · Track S — Simulation & data

### 4.0 OP-1 — the harvest gate ✅ DONE (runbook retained for re-harvests)

The gate condition — `manifest.json` `complete: true` with empty `completeness_issues`, and zero FAIL/SKIP from `npm run validate-nba-data` on every Stage-1 contract — **has been satisfied on the working machine** (validator green in the 2026-07-06 run). The runbook below remains the procedure for any future re-harvest; it is a manual, resumable, residential-IP operation (never CI, never app runtime):

```sh
pipeline/.venv/bin/python pipeline/harvest.py --manifest pipeline/manifests/smoke.json
pipeline/.venv/bin/python pipeline/harvest.py --manifest pipeline/manifests/default.json
pipeline/.venv/bin/python pipeline/normalize.py
npm run validate-nba-data
```

Re-run the harvest command to retry recorded failures (`data/nba/raw/_failures.json`) until the gate holds. Never hand-edit the raw cache. Any re-harvest that adds seasons re-raises the era-window question (§4.1 decision 0) — re-deciding the window is a deliberate act, not a side effect (see the 2025-26 heave-basis caveat).

### 4.1 S1 — Stage 1: league-level empirical calibration ✅ IMPLEMENTED AND ACCEPTED (contract record; accepted via S1-R)

*This section records what was built, verified in source, including where execution deliberately diverged from the plan (marked **[DIVERGENCE]**). Status history: revision 4 corrected "shipped" to "implemented, acceptance failing" (the 2026-07-06 local run showed the profile failing on average margin, plus the assisted sign-structure informational check failing); revision 7 records that **S1-R repaired and accepted it** — profile PASS 32/32, exit 0, margin 13.4 vs 12.87 ± 1.0 (§4.1a outcome). The original prompt, its divergences, and the repair record are archived in `docs/prompts/STAGE_1_IMPLEMENTATION_PROMPT.md`. The executable artifacts are `scripts/derive-league-targets.ts`, `docs/LEAGUE_TARGETS.md`, the rewritten `scripts/profile-engine.ts`, and the retuned `src/engine/constants.ts`.*

**What was built, decision by decision:**

0. **Era-consistency rule — implemented.** One target era: **2023-24 · 2024-25 · 2025-26 pooled** (the last 3 completed seasons — declared as a design decision, not a data limitation), driving every derived target. All rates from summed counts across the pooled sample, never averaged across players or seasons. Deeper histories were deliberately *not* mixed into the targets. The script takes `--seasons` for future window changes. *Recorded caveats:* pooling across a live trend means targets sit slightly behind the newest season (3PA and deep-three share rising); the season-deviation tolerance term absorbs this. From 2025-26 the NBA charges end-of-period heaves as team attempts, so that season's heave convention only partially applies — flagged for re-decision if a future window is 2025-26-anchored.
1. **Per-zone base FG% — implemented as tuned knobs, per the pre-modifier principle.** `BASE_FG_PCT_BY_ZONE` values are annotated as "TUNED KNOBS, not transcriptions of observed league FG%" — the base-vs-target offset absorbs the full modifier stack and is tuned via `npm run profile`, with the empirical targets and sample sizes quoted beside each constant. (Direct profile-driven tuning rather than a formal reference-run solve; the tier discipline below keeps it honest.)
2. **Zone reconciliation — implemented, further than planned. [DIVERGENCE — improvement]** A full six-zone re-map: rim = Restricted Area only; **short_midrange = Paint (Non-RA) + Mid-Range < 14 ft** (Paint-non-RA median distance 7 ft — floater/short-roll territory); **long_midrange = Mid-Range ≥ 14 ft**; corner_three = both corners; above_break_three < 27 ft; **deep_three = above-the-break ≥ 27 ft**. `ShotZone` in `models/game.ts` is the six-zone set; `pipeline/lib/zones.py`'s provisional five-zone mapping is deliberately unchanged.
3. **Heave exclusion — implemented exactly per spec.** Distance-AND-time: `Backcourt` zone OR (distance ≥ **32 ft** AND ≤ **3 s** left in the period), both named constants; heaves stay *in* league-level FGA/FG%/3PA/3P% for box consistency.
4. **Transition — one canonical source, per spec.** Synergy canonical; the PBP ≤7-seconds proxy (0.1886) is a cross-check only, with the definitional disagreement documented.
5. **Synergy handling — per spec, plus one nuance.** Misc excluded and renormalized; PRBallHandler+PRRollMan combined; play-type distribution INFORMATIONAL (owner: Stage 2). Synergy OffRebound (putbacks) isn't harvested, so the engine-side comparison excludes `putback` and renormalizes — with an explicit warning not to tune the engine putback frequency to the pbp putback-*attempt* proxy.
6. **Assisted-shot derivation — join gate passed at 100.000%; the anchoring plan changed. [DIVERGENCE — recorded]** The exact `(gameId, gameEventId)=(gameId, actionNumber)` join ran at 309,532/309,532 against the ≥ 99.9% gate. The spec's plan — per-zone assisted rates anchoring `PLAY_TYPE_PASS_RATE` — was **not** adopted: the NBA scorekeeper assist definition is materially more liberal than the engine's strict chain assist, so raw-rate anchoring would anchor to a different quantity. Shipped resolution: the **enforced** chain anchor is the box **assist total** (26.66/team-game, from `box_advanced` — an independent source, which also fills the parse-cross-check role: description-parsed rates are never load-bearing); per-zone assisted rates (corner three 0.967 ≫ all others) are INFORMATIONAL with the *sign structure* as the sanity check, owner **Stage 2/3**. **Revision 4 status: that sign-structure check was failing in engine output** — corner three was not the highest-assisted zone. **Revision 7 disposition: DIAGNOSED AND HANDED OFF (S1-Rb).** `scripts/diagnose-assists.ts` showed the chain's kick-out routing is *correct* (90% of corner attempts terminate as spot-up catches); the flat per-zone assisted rates are definitional — zero-pass initial spot_up/off_screen shots are real-life catch-and-shoot that NBA scorekeeping credits as assisted, and remapping them reproduces the real sign structure (corner 94.2% vs real 96.7%, highest by a wide margin). The fix is exactly the assist-definition mapping, so the item stays with its **S2/S3 owner**; no Stage-1 engine change was taken. **S2c2 disposition (2026-07-11): RESOLVED** — the measurement-side scorekeeper-aligned proxy is adopted (`docs/S2C2_ASSIST_DECISION.md`); strict chain credit unchanged; any mechanics loosening remains S3.g.
7. **Tier assignment — implemented, strengthened.** ENFORCED vs INFORMATIONAL fixed in the committed report *before* tuning, declared "never outcome-based"; every informational family carries a named stage owner (§9.9).
8. **Targets and the acceptance instrument — implemented, superseding the oracle concept. [DIVERGENCE — improvement]** The profile itself became the acceptance test: ENFORCED targets with derived tolerance bands (tol = max(max single-season deviation, documented floor sized above ~1,290-game sampling noise)), non-zero exit on failure. The old oracle-freshness debt class is structurally gone — "is the engine right?" is answered by running the profile. **And running the profile is exactly what revealed revision 3's status error:** the instrument works; the engine currently fails it on margin.

**Also built beyond the spec:** the `--check` byte-idempotency gate on the derivation (green 2026-07-06 — the first live instance of §9.3); pre-derived Stage-3 texture references committed as informational; `AGENTS.md` updated with the target discipline and profile checklist line.

**Residuals (owners assigned):** margin acceptance failure + assisted sign-structure diagnosis + engine-seed boundary fix → **S1-R** (§4.1a — ✅ all three delivered); the `PLAY_TYPE_SHOT_ZONES` shading unwind → **S2** (✅ S2c2 — candidate-scoped dual table; S2d promotes `_REAL`); the assist-definition mapping → **S2/S3** (✅ S2c2 — `docs/S2C2_ASSIST_DECISION.md`); the FT anchor nit → **S2** (✅ S2d — re-anchored to 0.7823, round trip asserted); the play-type frequency skew → **S2** (✅ S2c1-R/S2d — terminal bands green on the activated selector).

### 4.1a S1-Ra/b — Stage 1 acceptance repair ✅ DONE (PRs #20/#21, 2026-07-06)

> **Outcome record (revision 7).** Both units landed and were accepted on 2026-07-06:
> - **S1-Ra** (PR #20, commit 8c27361): `simulateGame`/`simulateSeason`/`createSeasonState` require explicit seeds; ambient fallbacks deleted from `src/engine`; the shared resolver `src/lib/seed.ts` validates or chooses seeds at the API boundary (canonical range 1..2,000,000,000; 400 on malformed input; the resolved seed persisted on new seasons); UI callers fixed; `scripts/test-seed-boundary.ts` covers missing/invalid seed cases at runtime plus compile-time `@ts-expect-error` assertions. The binding checkpoint held: fixed-seed profile/game output was **byte-identical** to the pre-refactor baseline (full SHA-256 comparison), so the API move changed no seeded behavior.
> - **S1-Rb** (PR #21, commit acc011f): diagnosis first (`scripts/diagnose-margin.ts`, fixed-seed 1,290-game season vs the real 2023-24..2025-26 games contract): the 16.8-vs-12.87 excess was broad (every quantile inflated, growing linearly from Q1), **not** mismatch-driven (cross-fitted strength-gap vs abs-margin r = 0.11); one-factor experiments eliminated form spread (−0.2), home edge (−0.4, load-bearing for points), and garbage-time timing (−0.1); momentum was minor (−0.9). **Root cause:** no margin-compressing effort behavior — real signed-margin SD (~15.8) sits below the independent-possession variance floor, and the engine random-walked to ~20. **Repair:** a deterministic, bounded, symmetric coasting/effort response (`COAST_LEAD_START = 8`, `COAST_LEAD_FULL = 25`, `COAST_SHOT_EFFORT_MAX = 0.05` in `constants.ts`) — an additive make-probability penalty for the leading offense and equal bonus for the trailing offense inside the existing shot clamp; equal-and-opposite by construction, reads the score only as behavioral state, never targets a margin, adds no RNG, draw order unchanged. **Accepted result: `npm run profile` PASS — 32/32 ENFORCED, exit 0; margin 16.8 → 13.4 vs 12.87 ± 1.0; all other enforced stats unmoved.** Regression harness `scripts/test-coasting.ts`; determinism and both A/B tests green; calibrate drift deltas reported and directionally explained. The assisted sign structure was diagnosed and handed to its S2/S3 owner (§4.1 decision 6). A read-only, disabled-by-default `GameDiagObserver` (consumes no RNG, persists nothing) powers both diagnostic scripts.
>
> The original phase spec is preserved below as written, for the historical record.

**Goal:** bring `npm run profile` to a genuine pass — specifically **average margin into 12.87 ± 1.0** from the observed 16.8 — without symptom-masking, plus the assisted sign-structure diagnosis and engine-seed boundary fix. This is one roadmap repair split into **two ordered execution units and commits**: **S1-Ra** is the behavior-preserving seed-boundary refactor; **S1-Rb** is diagnosis plus margin repair. S1-Ra lands and is accepted before the S1-Rb prompt begins.

**Why a dedicated phase:** margin is an *emergent game-flow property*, not a zone constant — it cannot be fixed by nudging `BASE_FG_PCT_BY_ZONE` without wrecking the stats that currently pass. A 3.9-point excess in mean absolute margin means simulated games separate too much: some combination of team-strength effects compounding too hard, within-game variance shaping, or the absence of real-game margin-compressing behavior (leading teams coast, trailing teams press, benches close out decided games). Diagnosis precedes tuning.

**S1-Ra — engine-seed boundary fix (the §1.3.2 repeal):**
- `createSeasonState` **and `simulateSeason`** require a seed; delete both the `Math.random()` fallback and the ambient `Date.now()` fallback from `src/engine`. Audit every exported engine entry point for equivalent defaults. Scripts/tests pass fixed seeds.
- The new-season API route validates a supplied seed as a finite integer in the supported range or chooses one at that app boundary before calling the engine. A direct API request with no seed must remain a supported new-world action without reintroducing ambient randomness below the boundary. `menu/page.tsx` and `schedule/page.tsx` may continue choosing seeds, but the server boundary does not trust their presence or shape.
- **Ordered checkpoint (binding): apply and verify this refactor before changing any margin mechanism.** A fixed-seed profile/game must be byte-identical to the pre-S1-R result, proving the API move itself changed no seeded behavior. Land this commit and close its prompt before S1-Rb begins.

**S1-Rb scope item 1 — margin repair (the acceptance target):**
- **Diagnose first.** Instrument the profile run (or a one-off analysis script) to decompose the margin excess: distribution of final margins vs. real (is the whole distribution shifted, or is it a blowout tail?); margin trajectory by quarter (does separation happen early and compound, or accumulate linearly?); correlation of margin with team-strength gap (are mismatches too decisive?) and with momentum/form draws. Report the decomposition before changing any constant.
- **Candidate mechanisms, in rough prior order** (each additive-and-clamped, centered, named constants — and each only if the diagnosis implicates it): momentum strength/persistence (`possession`-level compounding is the classic margin inflator); per-game form spread (±13% clamp — a wide independent draw for both teams widens margins quadratically); home-court edge magnitude; and the **existing** garbage-time substitution rule in `substitution.ts` (currently fourth quarter, ≤5:00, margin ≥20). Measure whether that rule triggers too late, fails to reduce effective-strength separation, or merely trims an already-created tail. Any extension must remain a bounded, deterministic, clearly-labeled game-state response, never a score-seeking controller.
- **Anti-symptom-masking guard (binding):** the fix must not (a) suppress overall scoring variance to the point that other enforced stats drift out of band, (b) introduce any mechanism that reads the score and *targets* a margin (rubber-banding toward a number is score-fixing, not simulation), or (c) re-tier margin to informational (§9.9 / Appendix A #10). If margin can only reach band via one of these, **stop and surface** — that outcome would mean the possession model itself over-compounds advantage, which is a design conversation, not a tuning task.
- Watch the coupled stats: anything touching momentum/form moves points/PPP/FG% second-order — the full enforced table must land in band simultaneously, and turnovers get the standing `AGENTS.md` scrutiny.

**S1-Rb scope item 2 — assisted sign-structure diagnosis (informational; mandatory diagnosis, optional fix):**
- Determine *why* corner threes are not the engine's most-assisted zone. Plausible candidates, to confirm or eliminate: the chain's kick-out routing doesn't preferentially deliver corner attempts off penetration/double-teams; `PLAY_TYPE_PASS_RATE`/`PLAY_TYPE_SHOT_ZONES` interactions send assisted possessions to the wrong zones; or the strict chain-assist definition undercounts exactly the catch-and-shoot pattern that dominates real corner threes (in which case the root cause is the S2/S3 assist-definition mapping, and the correct S1-R outcome is a written diagnosis + hand-off, not a fix).
- If a bounded, centered fix falls out of the margin work or a small routing correction (e.g. double-team kick-outs weighting corner zones), take it — with the enforced assist total (26.66) and zone shares staying in band. If not, document the diagnosis in the report and leave the item with its owner. **This item cannot block acceptance (it is informational) and cannot be dropped silently (it is a named residual).**
- Order-of-operations note: S2 will change play-type frequencies and re-tune shot diets, which will move assisted-rate structure again — so S1-Rb should prefer *diagnosis + minimal correction* over deep investment here. The final S1-Rb engine is not expected to be byte-identical to the pre-repair engine, but it must remain repeat-run deterministic for every fixed seed.

**Out of scope (hard):** no target or tolerance edits (`derive-league-targets.ts` and the transcribed `TARGETS` are untouched — margin's band is the requirement, not a negotiation); no re-tiering; no play-type frequency changes (S2); no touching `spacing.ts` math or the zone mapping; no schema changes; nothing from any later phase.

**Stop-and-surface:** margin reachable only via variance suppression that breaks other bands, score-targeting mechanisms, or re-tiering (see the guard above); the assisted-structure diagnosis implicating a possession-model design flaw rather than a tunable; any enforced stat that must trade off against margin with no constant that separates them.

**Acceptance:** `npm run typecheck`; **commit 1** records byte-identical fixed-seed profile/game output and explicit missing/invalid API-seed tests before any margin edit; **commit 2** produces a final `npm run profile` PASS (exit 0), full before/after table, margin decomposition report, and assisted sign-structure diagnosis (fixed or handed off in writing); `npm run calibrate` deltas reported and directionally explained; final `tsx scripts/test-determinism.ts` proves same seed → identical game on the repaired engine (it does not compare intentionally changed margin behavior to the pre-repair engine); both A/B tests re-run; scope guard.

### 4.2 S2 — Stage 2: ratings & tendencies derivation from real data (retire BallDontLie)

**Goal:** replace the position-heuristic derivation layer with pipeline-derived values, so the player pool the engine simulates is the real league — delete the compensations the heuristics forced, **including the one Stage 1 documented and dated** (§1.3.3). Requires a green S1-R baseline: tuning a new pool against a red profile is uninterpretable.

**Execution units (ordered; each is one prompt, diff, and acceptance run):**
1. **S2a — identity + league builder. ✅ DONE.** Build the NBA-personId-keyed league artifact and validation/fallback report without changing the active player pool or engine behavior. Keep the legacy ingest path until the new artifact round-trips and coverage gates pass.
2. **S2b — ratings derivation. ✅ DONE (including S2b-R).** Implement shooting/offense/defense/physical rating mappings plus the statistical-contract report. The candidate remains inactive; tendencies and shot diets remain unchanged.
3. **S2c1 — tendencies + candidate evaluation seam. ✅ DONE (including S2c1-R).** Derive real usage/play-type/shot-mix tendencies in the candidate only, including its coverage/fallback report. Add an explicit read-only `--league-dir` (or equivalent) input to the profiling tools so the candidate can be simulated and its informational tables reported without copying over `data/players.json` or `data/teams.json`. S2c1-R diagnosed the initial→physical-finisher chain and transition gate, then added an explicit candidate-only possession-level emitted label and conditional transition mapping; canonical and two predeclared fixed seeds pass the terminal bands. Default invocations continue to use the active pool, and active-pool profile/calibrate output remains byte-identical.
4. **S2c2 — assist-definition decision + compensation unwind. ✅ DONE.** The candidate-only scorekeeper-aligned proxy is recorded in `docs/S2C2_ASSIST_DECISION.md`; strict chain credit remains unchanged and any mechanics change belongs to S3.g. `PLAY_TYPE_SHOT_ZONES_REAL` restores the locked cut/spot-up diets only through the explicit evaluation config. The real-diet report records the remaining shot-mix residual with mechanical per-row |Δ| ≤ 2·tol predicates (five failing rows: short-mid +2.8pp, long-mid +3.7pp, above-break −4.2pp, mid bucket +6.5pp, three bucket −5.8pp) and the **S2c2-R modifier decomposition (2026-07-12)** that earns the downstream attribution: the raw real-diet stage lands near the targets (rim/mid/three 31.2/27.5/41.3 vs 28.7/30.4/40.9), while the global three-point dampener stage (mid +4.2pp, three −7.3pp) and the active-pool-derived spacing baselines applied off-center to the candidate (mid +6.9pp, rim −4.3pp) drive the residual — both inputs S2d's coupled retune/re-baseline owns by name. The locked diets are not implicated; the residual belongs to S2d, not S2c1-R or a diet re-shade.
5. **S2d — activation, coupled re-baseline, and legacy-ingest retirement. ✅ DONE (2026-07-14).** The sole activation point, delivered: `npm run build-league` deterministically promotes the NBA-derived pair into `data/` through a journaled, self-healing two-rename protocol and records an atomic promotion manifest (pair SHA-256s + production selector/table identities) that every profile/calibrate run verifies via `scripts/s2d-activation-context.ts`. The candidate selector and real diets are the sole production path (`PLAY_TYPE_SHOT_ZONES_REAL`, the legacy/candidate selection configs, the `--league-dir`/`--shot-zones` seams, `scripts/ingest.ts`, `src/data/ingest/`, and `scripts/seed-test.ts` all deleted — seed-test resolved by retirement in favor of the builder). Spacing AND versatility baselines are re-derived by `scripts/calibrate-spacing.ts` and transcribed; the FT inverse pair is settled on the empirical 2023-26 FTA-weighted anchor with the round trip asserted in the S2d harness. The coupled retune landed profile **PASS 32/32** on the activated pool: the former global three-point dampener folded into the annotated per-zone `SHOT_ZONE_FREQUENCY_FACTORS`, plus steal-split / block / foul-rate / pass-rate knobs (all named constants). The predeclared 6.00 pp terminal selector band holds on all three predeclared seeds (4.55/4.43/4.28 pp — the transient seed-7 excursion recorded in `docs/S2D_ACTIVATION_CONTEXT.md` was resolved by the selector/pass-rate retune; the band was not widened). The spacing baseline is derived with the shared production finisher-selection weight (`primaryPlayerWeight` × the lineup's selector mix), and the builder harness asserts against the frozen `S2B_TARGET_SDS` contract rather than the mutable live pool. The S2c2 measurement check was retired with its generator (`scripts/report-s2c2.ts` deleted); its report and the other S2 generated docs are frozen historical evidence (docs map in `CLAUDE.md`). Target SDs are frozen with provenance as `S2B_TARGET_SDS` (`src/ratings/nba-derivation.ts`) — deliberate compatibility priors, no longer derivable from the retired pool. Existing saves retain their persisted players; the new-game runtime path now validates the pool through the shared `src/lib/pool-validation.ts` gate.

No unit may borrow from the next to make its own checks green. S2a through S2c2 may emit and inspect candidate artifacts beside the active pool; only S2d changes runtime new-league inputs. Existing saves retain their persisted players throughout.

**What gets replaced (verified current shape):** essentially all of `src/ratings/derivation.ts`'s heuristics — `deriveRatings`'s position-base + percentile guesses, `deriveTendencies`'s position-estimated play-type frequencies (`estimateIsoFreq` … `estimateHandoffFreq`), `estimateRimRate`'s position-based shot mix — plus the BDL ingest path (`scripts/ingest.ts`, `src/data/ingest/balldontlie.ts`, `transforms.ts`, and with it the `Math.random` at `transforms.ts:77`).

**Input mapping (the derivation table to implement — each row a documented function of named contracts):**

| Output | Primary source | Notes |
|---|---|---|
| `tendencies.usageRate` | `box_advanced.advanced.usgPct` | Real usage replaces the FGA-proxy estimate; keep `USAGE_TEAM_POSS_PER_MINUTE` only as fallback for sample-less players. |
| Play-type frequencies (`isolationFreq` … `handoffFreq`) | `playtypes` (Synergy), Misc excluded + renormalized | Map Synergy types → OTC `PlayType` explicitly (PRBallHandler/PRRollMan → the two PnR tendencies; `putback` stays derived from OREB context — Synergy OffRebound isn't harvested). **This is the fix for the league-level frequency skew Stage 1 flagged.** |
| Shot mix (`rimRate`/`midrangeRate`/`threePointRate` — mapped onto the six-zone model) | `shot_zones` (+ `shot_events` for the short/long/deep splits) | Uses Stage 1's settled six-zone mapping verbatim (rim = RA only; Paint-non-RA is short_midrange — tendency semantics must match zone semantics). |
| Shooting ratings (outside/mid/interior/FT) | `shot_zones` per-zone volume+efficiency; `ftPct`/`fta` | Distribution-mapped per the statistical contract below; FT uses the inverse pair exactly, settling the 0.781-vs-0.7823 nit while re-asserting the round trip. |
| Passing / ball-handling / offensive IQ | `box_advanced` (ast%, astTo, tov%), `tracking.passing` | Blend documented per rating. |
| Perimeter/interior D, steal, block, defensive IQ | `defense` (defended categories, matchup-by-position), `pt_defend`, stl/blk | The defended-FG%±by-category data is the first real signal these ratings have ever had. |
| Athleticism / strength / size context | `tracking.speedDistance`, `combine` (incl. `wingspanCm` where matched), height/weight | Wingspan feeds versatility size inputs where present; absent → deterministic fallback, flagged. |
| Rebounding | `box_advanced` reb%, `hustle` boxouts | |
| Stamina / durability | mpg, gp across seasons | Multi-season, recency-weighted. |

**The statistical contract (revision 4 — "percentile-mapped, mean ≈ 40" is not a specification):** the engine consumes ratings through `ratingToModifier`, so the *modifier distribution* is what actually drives the sim — a mean constraint alone leaves spread, tails, and correlations free to drift arbitrarily while "satisfying" the mapping. S2's derivation must therefore specify, per rating, all of:
1. **Center and spread:** league mean ~40 AND a target standard deviation per rating. The current heuristic pool's per-rating SD is a **compatibility diagnostic and initial tuning prior, not empirical truth**; the shipped target must be justified from measurement reliability, shrinkage, raw-stat separation, and behavioral calibration. Any deliberate deviation from the old modifier spread is documented and absorbed by S2d's profile retune.
2. **Tail policy:** how the empirical distribution maps into the 1–80 clamp — named percentile anchors (e.g. p1/p99 → the effective floor/ceiling), explicit treatment of outliers, and the rule for the discrete top end (how many 75+ players the mapping should produce, compared against the current pool).
3. **Shrinkage:** small-sample players regress toward a declared prior (position- or role-conditional league mean) with a named sample-size weighting — never raw percentiles off 40 minutes of data, and never silent positional guesses (fallbacks logged per player, as before).
4. **Correlation preservation:** the joint structure matters (a league where outside shooting and ball-handling decorrelate produces different lineups than the real one). Requirement: report the cross-rating correlation matrix of the derived pool vs. the current pool and vs. the raw stat correlations; material divergences documented and justified.
5. **Validation:** (a) modifier-distribution comparison — per-rating histograms of `ratingToModifier` outputs, derived pool vs. current pool, with divergences bounded or justified; (b) the profile PASS on the new pool is the behavioral backstop; (c) reproducible top-N diagnostics tied to the named input metrics and sample sizes. A human face-validity review may be reported, but "common sense" is not a pass/fail oracle.

**The Stage-1 compensation unwind (S2c2's named duty):** S2c1-R has brought the candidate emitted play-type labels near the Synergy reference (canonical total absolute error 4.3pp; all categories within band), so **S2c2 is unblocked** to re-tune `PLAY_TYPE_SHOT_ZONES` back toward the real per-type shot diets and remove or rewrite the `KNOWN STAGE 2 ARTIFACT` block. S2c2 still owns the assist-definition decision; S2d remains the sole activation point.

**Assist-definition decision (S2c2; inherited from S1 decision 6):** before per-zone assisted rates can inform `PLAY_TYPE_PASS_RATE`, choose and document the mapping between the NBA scorekeeper assist and the engine's strict chain assist (a derived discount factor, or a deliberate loosening of the engine definition — engine mechanics belonging to S3.g if chosen). Until then the box assist total remains the only enforced chain anchor. Deciding *not* to use the per-zone rates is legitimate; deciding silently is not.

**League construction decision (recommended, confirm before prompting):** a **new-league generation path** (`npm run build-league` or similar) building `data/teams.json` / `data/players.json` directly from `data/nba/normalized/`, keyed on **NBA personIds**. Existing saves keep their old ratings; the `crosswalk.json` path is used **only** if migrating the current BDL/ESPN-keyed pool is explicitly chosen — with a hard-stop match-rate threshold (surface the unmatched list; never guess identities). A different prompt-time decision is a stop-and-surface, not an improvisation.

**Schema note:** ratings/tendencies shapes are stable, so no bump is expected; if one is needed, take the next free version per the §9.8 ledger and renumber in the same commit.

**Consequential re-derivations (S2d, per the matrix):** re-run `tsx scripts/calibrate-spacing.ts` and adopt the new `SPACING_*`/`VERSATILITY_*` values; re-verify both A/B tests; **re-establish a passing profile on the activated pool** (targets unchanged; realized values will move; the unwind is part of this re-tune); re-assert the FT round trip; refresh `scripts/seed-test.ts`'s role (retire in favor of build-league, or convert to seeded generation per §9.2 — decide, don't drift).

**Out of scope:** engine mechanics (Stage 3); development curves (F4); scouting UI; transactions. Do **not** delete `download-history.ts`/`calibrate-history.ts` (the drift check remains useful and is unrelated to BDL). Do not touch the derived targets (era window is a Stage-1 decision).

**Stop-and-surface:** required contract missing; crosswalk below threshold; any rating that can't satisfy the statistical contract's center+spread simultaneously; Synergy coverage gaps for rotation-level players; the shot-diet unwind failing to hold zone shares in band.

**Acceptance:** every unit runs typecheck, determinism, NBA-data validation, and its named artifact checks. S2a must leave profile/calibrate byte-identical. S2b reports the candidate pool's statistical contract without using later tendency or engine retuning to conceal a bad mapping. **S2c1** proves active-pool profile/calibrate byte-identical and reports the candidate via the explicit alternate-pool seam; **S2c2** reports the candidate play-type, zone-share, and assisted-zone consequences of the explicit mapping/unwind decision without activating it. **S2d** finishes with **profile PASS** on the activated pool, calibrate deltas reported, both A/Bs passing on re-derived baselines, the FT round-trip asserted, and the statistical/per-player reports committed under `docs/`.

#### S2a/S2b implementation outcome — 2026-07-09 (condensed in revision 8)

S2a landed in PR #24; S2b and repair unit **S2b-R** landed in PR #25. S2b-R replaced the erroneous `box_advanced.per100.tov` blend with usage-normalized `box_advanced.advanced.tmTovPct`, split shared overall defended-FG inputs into category-specific perimeter/interior signals, and added a population-level defended-category validator after repairing the normalizer's raw-column mappings. S2c1 and **S2c1-R** now land on the inactive candidate; S2c2 owns the assist/shot-diet unwind and S2d remains the sole activation point.

The current candidate, coverage/fallback policy, per-rating inputs, repaired raw-column mappings, tail policy, and inherited limitations are the generated source of truth in `docs/S2A_LEAGUE_COVERAGE.md` and `docs/S2B_RATINGS_CONTRACT.md`. S2d owns star-separation behavioral evaluation, single-season defense-data noise, the avgSpeed-as-athleticism limitation, and the durability DNP-CD/role conflation.

### 4.3 S3 — Stage 3: mechanics from richer data (a gated menu, not a monolith)

**Goal:** spend the data on the sim itself — one mechanic per prompt, each independently profiled, each with its own named constants. Stage 3 is a *menu with rules*: its items are separable and the failure mode is bundling three plausible ideas into one uncalibratable diff.

**Rules for every S3 item:** additive-and-clamped only; centered so league aggregate is unchanged unless the item's explicit purpose is to move a target; new constants in `engine/constants.ts` with source annotations; RNG draws in stable order; `spacing.ts` stays pure; one item per prompt with its own profile sign-off; items land sequentially on main (the §3.2 ∥ rule). The committed informational references in `profile-engine.ts` are the starting evidence base — except the putback-attempt proxy as a frequency target (Appendix A #13).

**Candidate menu (ordered by expected value; pick deliberately):**
- **S3.a Lineup-model validation harness.** `tsx scripts/validate-lineups.ts` scoring the spacing+versatility model against real five-man `lineups` net ratings (2007–25). This lands first: it is cheap, high leverage, and becomes the regression check for every later fit change.
- **S3.b Defender-matchup fidelity.** `defense.matchupsByOppPosition` and defended-category FG%± to sharpen `selectDefender` and the defender term in `resolveShot`. Directly deepens the weak-link versatility story.
- **S3.c Contest & pressure realism.** `hustle.contestedShots`/deflections and `tracking.defense` informing contest-level distributions and steal pressure.
- **S3.d Drive/touch texture.** `tracking.drives`, `paintTouch`/`postTouch`/`elbowTouch` refining advantage-creation probabilities per player-context — carefully centered.
- **S3.e Rebounding positioning.** `hustle` boxouts + oreb%/dreb% into rebound weighting (ORB-rate reference 0.2518 is the league anchor).
- **S3.f Screener credit & handoff texture.** `screenAssists` informing screener involvement in PnR/handoff chains (event-stream credit only).
- **S3.g Assist-definition alignment**: if S2 chose the "loosen the engine definition" branch, the mechanics land here — a bounded, documented widening of chain-assist credit, calibrated so the per-zone assisted sign structure emerges (closing the loop on the S1-R diagnosis) and the enforced assist total stays in band.

**Out of scope for the whole stage:** anything that changes persisted schemas; anything that reads scouted ratings; new play types (possession-model redesign — Horizon).

**Acceptance per item:** the standard engine checklist (profile PASS with deltas, determinism, A/Bs, calibrate deltas reported), plus S3.b's lineup-validation score not regressing once it exists.

---

## 5 · Track F — Franchise cycle

The arc that turns "a league simulator with saves" into "a franchise you run for a decade." Each phase is a schema-conscious state change on `SaveFile`/`SeasonState`; the transaction-layer standing rules (schema bump + migration + round-trip check; profile **unchanged**; calibrate output unchanged; `SeededRNG` from stable keys for any generation) apply to every one of them.

### 5.1 F1 — Team selection & controlled-franchise identity ✅ DONE (Wave 1b; small)

> **Outcome record (2026-07-07).** F1 shipped in PR #23 / commit `1e71570`: top-level `SaveFile.controlledTeamId`, v6→v7 migration to `null`, `getControlledTeamId` / `isControlledTeam`, API-boundary validation, the menu picker with spectator default, and save-summary tagging. Profile/calibrate were byte-identical and save/migration/determinism harnesses were green. The original phase contract is retained below as the shipped design record.

**Goal:** give the game a persistent answer to "which team is the player?" — the field every GM-facing feature keys on.

**Historical gap (resolved):** the gate accepted `controlledTeamId?` per-call for NTC consent (`gate.ts`, `validators.ts`) but no persisted canonical identity existed. The canonical field now lives on `SaveFile`, and production reads use the accessor pair.

**Adds:**
- `controlledTeamId: string | null` on `SaveFile` (recommended home: the save, not the season — franchise identity outlives a season; confirm at prompt time; exactly one canonical home). `null` = spectator/commissioner mode, fully supported (calibration scripts and harnesses run controlled-team-free worlds).
- One clean accessor pair (`getControlledTeamId(save)` / `isControlledTeam(save, teamId)`) used everywhere — no ad-hoc reads.
- New-game setup UI: team picker on the menu's new-game flow (30 teams), plus "no team (commissioner)." Save metadata/summary gains the controlled team's tag where present (`buildSummary` summarizes league-wide by design — extend, don't replace).
- Schema bump **v7** + migration: pre-F1 saves get `controlledTeamId: null`; round-trip check extended; migration twice is a no-op.
- Preserve the existing gate option as the per-call NTC seam. No game-facing transaction call site existed at F1 landing; F5/T-7 call sites with a save in hand must pass the accessor-derived canonical value while the gate itself remains symmetric.

**Out of scope:** any GM UI beyond the picker; CPU behavioral changes; rotation editing; renaming/relocating teams.

**Acceptance:** standard non-engine checklist (profile unchanged, calibrate output unchanged, determinism, migration round-trip), plus `scripts/test-saves.ts` extended for the field.

### 5.2 F2 — Playoffs (Wave 3, ∥ with S3 per the §3.2 sequential-merge rule)

**Goal:** a real postseason — seeding, series, a champion — completing the competitive arc and making the 5c championship-distribution metric mean something.

**Adds:**
- **Format (decisions, all named constants):** modern NBA shape — play-in for seeds 7–10 (tunable on/off), best-of-7, 2-2-1-1-1 home court, conference brackets → Finals. Deterministic seeding tiebreakers: a simplified, documented subset of the NBA rules (head-to-head → division leader → conference record → point differential → stable team-id tie-break), labeled as a game simplification.
- **State:** a persisted `playoffs` structure on `SeasonState` (bracket, series states, per-round schedule extending the calendar past `endDate`), a `playoffs` `GamePhase` value with `derivePhase` updated, and playoff games flowing through the *same* monotonic/idempotent advancement machinery — one engine, not a parallel one.
- **Playoff game identity (decision):** playoff `gameId`s are a **pure deterministic function of bracket position** (e.g. `PO-R1-S3-G5`), never of scheduling order. Per-game seeds derive from `deterministicSeed(season.seed, gameId)`, so the ID scheme *is* the seed scheme. Document the format beside the tiebreakers.
- **Stats separation:** `playoffPlayerStats` separate; regular-season stats and standings freeze at game 1230.
- **Injuries continue** through the playoffs on the same dedicated stream.
- **Determinism:** bracket construction consumes no RNG (pure function of standings + tiebreakers).
- Schema bump **v8** + migration (empty-init; mid-regular-season saves untouched; legacy completed seasons grandfathered as finished — recommended, decide and document).
- Minimal UI: bracket view; champion in save summary.

**Out of scope:** playoff-specific engine behavior (rotation tightening, leverage minutes — Horizon; playoff games play like regular-season games, stated as a conscious simplification); awards; finances.

**Acceptance:** standard non-engine checklist; new `tsx scripts/test-playoffs.ts` (deterministic bracket from a fixed season; idempotent re-advancement; a full postseason completes; champion stable across two runs); profile untouched.

### 5.3 F3 — The multi-season seam: offseason v1 + rotation normalization (Wave 4)

**Goal:** season → offseason → next season as a **pure, deterministic, script-drivable seam** — the single world-advance function the app, the future offseason UI, and the 5c harness all share. **Revision 4 addition:** the seam's own steps mutate rosters (`processContractRollover` removes players *without repairing persisted rotations* — verified; autofill adds players), so F3 also ships the shared **deterministic rotation-repair primitive**. Waiting for F5 would strand departed players in `starters`/`rotationOrder`/`minuteTargets` from the very first rollover.

**Composes (all verified, all currently unwired):** `processContractRollover` · `createSeasonState` · `InjuryHistoryEntry` concatenation.

**Adds — the rotation-repair primitive (new, used by F3/F4/F5 — §9.10):**
- One exported pure function, e.g. `normalizeRotation(rotation, activeRosterIds, mode)` (generalizing the philosophy of `adjustRotation`, which already does membership repair for injuries — extend/extract rather than duplicate), with two explicit deterministic modes: **`sanitize`** removes departed players from `starters`/`rotationOrder`/`minuteTargets` and may return a deliberately incomplete rotation when the roster is temporarily short; **`finalize`** requires at least five active players, fills starters/new arrivals by a pure rule, and rebalances minute targets deterministically. No RNG — or, if a tie-break genuinely needs randomness, `SeededRNG` from a stable key per the standing rule.
- F3 calls `sanitize` immediately after any removal step, but calls `finalize` only after autofill has restored the roster. Once F4 lands, retirement uses `sanitize`; replacement generation + autofill are followed by `finalize`. F5 later reuses `finalize` for completed in-season mutations. **One primitive with two modes; parallel repair implementations are banned** (§9.10).

**Adds — one exported seam,** e.g. `advanceToNextSeason(save: SaveFile): SaveFile`, in fixed order:
1. **Close the season** (post-F2: playoffs complete).
2. **Fold season into history — with provenance:** append each player's simulated season into `player.careerStats` as a real `SeasonStats` row (per-game rates from totals + games — **guard the zero-games case explicitly**: a 0-GP player gets a zero-totals row or is skipped by a documented rule, never a division by zero; `teamId` = final team pre-F5, one row per stint post-F5), and carry `injuryHistory` into the cross-season log. **Every folded row is tagged `source: 'sim'`** (pre-existing real-NBA rows marked `'real'` in the migration). This tag makes §9.1 enforceable: no recompute or derivation tool may ever consume `'sim'` rows — the dangerous entry point is a *future migration* re-running `recomputeUsageAndFreeThrowFields` over a multi-season save. That function and any Stage-2 derivation function gain the `'real'`-only filter **in this phase** (one line each, tested here). Ratings change only via F4.
3. **Construct the fresh next-season base before rollover:** derive `nextSeasonId`, `nextStartDate`, and **`nextSeed = deterministicSeed(previousSeason.seed, nextSeasonId)`**; call `createSeasonState` with that explicit seed to produce the distinct, empty-stat/empty-ledger `nextSeasonBase` that the existing `processContractRollover(world, nextSeasonBase)` contract requires. This is construction, not yet the returned world.
4. **Contract rollover** via that existing seam, followed immediately by rotation **sanitization** for every affected team: stale IDs are removed, but no attempt is made to fill starters or rebalance minutes while a rollover-created roster shortage may still exist. Rollover owns the precise carry-forward rules for its transaction collections; F3 does not reimplement them.
5. **Age & experience increment** (+1 each; pure).
6. **League-continuity autofill and finalize:** any team below `ROSTER_MIN` signs the cheapest-ask eligible free agents at the minimum, **through the real gate**, in deterministic order (team id, then player id / lowest ask); full rotation **finalization** runs only after autofill succeeds. Not CPU signing AI; explicitly replaced by Phase 7 (the function name and comments say so). Its inflow counterpart — replacement-level *generation* when the pool runs dry — arrives with F4 (§5.4). Return the rolled, repaired next-season world built from step 3's base.

**Also adds:** the app-level offseason flow in minimal form — season end lands the save in `offseason` phase with a single "Advance to next season" action calling the seam.

**Performance note:** a pure `advanceToNextSeason` implies a full clone per season — irrelevant in the app, real churn in the 5c harness. The seam's contract says "pure at the boundary," not any internal cloning strategy, so the harness can later adopt clone-once-mutate-within-run without a contract change. Never a harness fork (§9.5).

**Schema bump v9** (the provenance tag alone guarantees a shape change — unconditional): migration marks all pre-existing `careerStats` rows `'real'`; round-trip as always.

**Out of scope:** development (F4 — ages change, ratings don't, asserted); real FA behavior (Phase 7); draft (Phase 8); retirement (F4); rollover semantics changes; **in-season** rotation repair wiring, stat stints, deadline wiring (F5 — the primitive ships here, its in-season call sites do not).

**Stop-and-surface:** `careerStats` fold-in conflicting with any consumer assuming real-NBA-only rows (audit consumers as part of this phase); rollover encountering states outside its tested contract; autofill unable to reach `ROSTER_MIN` (surface, don't invent players — F4's generation doesn't exist yet); rotation sanitization retaining any departed ID; or finalization, after autofill, unable to produce a valid rotation from an at-minimum roster.

**Acceptance:** standard non-engine checklist; new `tsx scripts/test-multi-season.ts`: advance a fixed-seed world 3+ seasons twice → byte-identical saves; **every team's rotation valid (no departed IDs, starters filled) after every season boundary — asserted**; ratings byte-identical across the fold-in; **`recomputeUsageAndFreeThrowFields` on a multi-season save produces byte-identical ratings/tendencies (the provenance filter, asserted directly)**; rosters ≥ `ROSTER_MIN` every season; transaction log strictly append-only; migration idempotent.

### 5.4 F4 — Development, aging & retirement v1 (Wave 5)

**Goal:** players change. The league breathes — **and keeps breathing**: retirement drains the pool, so this phase also ships the inflow that keeps decade-long worlds solvent until the real draft (T-8). All deterministic, from empirical curves, through the one sanctioned channel for rating change.

**Execution units (ordered; each is one prompt, diff, and acceptance run):**
1. **F4a — empirical curve artifact.** Build `derive-aging-curves.ts`, its proxy/coverage/correction report, and held-out validation. No runtime or schema changes.
2. **F4b — development + potential.** Wire deterministic offseason rating/potential/tendency evolution through the F3 seam and add evolved-pool profiling. No retirement or generated players yet.
3. **F4c — retirement + league continuity.** Add exit-hazard-consistent retirement, replacement-level generation, dynamic season baselines, rotation repair calls, schema migration, and the 10+ season solvency run.

F4a must be accepted before its curves become runtime constants. F4b must demonstrate stable evolved-pool behavior before F4c adds population churn; F4c may not tune development to conceal a retirement or replacement-generation defect.

**The aging-curve statistical contract (revision 4 — strengthened):** `box_advanced` spans 1996–2025, but "empirical curves per rating group" is not free — the rating groups (skill / physical / athleticism / durability) are *latent*, and the historical data only carries *observables*. A `tsx scripts/derive-aging-curves.ts` derivation script (same discipline as `derive-league-targets.ts`, including printed provenance) must satisfy all of:

1. **A proxy-mapping table.** Each rating group's curve is fit from named observable proxies, with the mapping committed in the script and the report — e.g. skill ← shooting efficiency by zone, ast/tov structure; athleticism ← `tracking.speedDistance` decline, rim-attempt share, transition involvement; durability ← gp/mpg patterns and injury-adjacent availability. No curve may claim an empirical basis its proxies don't carry.
2. **Per-proxy coverage windows, honestly handled.** `box_advanced` covers 1996–2025 but `tracking` starts 2013 and `hustle` 2015 — so athleticism proxies do **not** span the full window the headline claims. The script declares each proxy's window; curves blend proxies only over their shared coverage or model the coverage difference explicitly. A curve labeled "1996–2025" that silently leans on a 2013+ proxy is a stop-and-surface.
3. **Survivor-bias correction.** Players who decline hard exit the league; deltas computed only on consecutive-season survivors *understate* decline, producing too-graceful aging and an old-skewing league. Minimum bar: treat league exit as an outcome (exit-hazard by age feeding both the decline curves and the retirement rule), or a documented imputation/weighting scheme for exiting players' unobserved next season. "We computed deltas on survivors" is a stop-and-surface.
4. **Era normalization.** Pooling raw per-age deltas across thirty seasons confounds aging with league trend (3P-related stats most of all). Deltas computed within-era then pooled, or with season fixed effects removed. (Opposite pooling posture from Stage 1's targets, correctly: targets describe the *modern league state* → narrow window; aging curves describe a *time-invariant human process* → deep history, after the era signal is removed.)
5. **Held-out validation.** Fit on a subset (e.g. cohorts or season ranges), validate against held-out player-season outcomes: predicted vs. observed proxy trajectories by age, with error reported per rating group. The curves ship with their validation numbers, not just their fits.

**Adds:**
- **`developPlayer(player, seasonId)`** (or league-level `runDevelopment`), called from the F3 seam between steps 5 and 6, after age/experience increment and before continuity signings: movement toward `potential` for young players and decline for old, per-group curves, with bounded deterministic variance from a **dedicated stream seeded by `deterministicSeed(season.seed, 'dev_' + playerId)`** (the injury-stream pattern, not the contract-migration pattern: a save-independent key would make two different worlds roll *identical* breakouts and busts. One-shot boundary generation is correctly save-independent; recurring per-season development is world state and must descend from the world's seed. Per-player streams keyed off the season seed, never touching game streams).
- **Potential recalibration:** `derivePotential`'s multipliers re-fit from the same (corrected, normalized, validated) curves; modest deterministic potential drift (breakout/bust) on the same stream discipline.
- **Tendency evolution policy (load-bearing):** tendencies shift **only as a deterministic function of rating changes** — never of simulated box scores. Sim-responsive tendencies remain a Horizon item with the feedback-loop warning.
- **Retirement:** deterministic rule (age + rating floor + years-of-decline, consistent with the exit-hazard curve from requirement 3), removing players via a real transaction-log entry type; the F3 primitive runs in **`sanitize` mode** after retirements so no departed ID survives, while starter filling/minute rebalancing wait until replacement generation and autofill finish.
- **Replacement-level player generation (the inflow half of retirement).** Retirement shrinks the pool every season; the draft doesn't exist until T-8; F3's autofill would exhaust a monotonically depleting FA pool, and the authoritative 5c baseline would be captured on a starving world. F4 ships a clearly-fenced continuity rule (same documentation pattern as the autofill): when the eligible FA pool drops below a named floor at the autofill step, generate replacement-level players — low ratings, plausible age/position distribution, minimum asks — via `SeededRNG` on `deterministicSeed(season.seed, 'gen_' + seasonId + '_' + index)`, entering through the FA pool and the real gate. After generation and autofill restore each roster, the F3 primitive runs in **`finalize` mode**. **Not the draft**: no prospects, no upside beyond replacement level, no draft event — the function name and header say so; T-8 replaces it as the league's inflow (demoting it to a final fallback, exactly the autofill's fate at T-7). Without this rule, F4's own acceptance criteria conflict.
- **Dynamic spacing/versatility baselines** — the `constants.ts` deferral comes due when the pool changes year over year: a per-season **deterministic, frozen calibration snapshot** (pure arithmetic from the eligible season-start pool, no RNG), static constants remaining the season-1 anchor and fallback. If persisted on `SeasonState`, label it as immutable season-start context—not a mutable derived-current value—and provide a recomputation assertion so save/load drift is detectable. Define the eligible pool explicitly (rostered standard players vs. all free agents) before implementation.
- Schema bump **v10** (per-season baselines, retirement entries, generated-player marker if persisted) + migration + round-trip.

**Out of scope:** draft prospects (Phase 8; they develop through this system once they exist); morale/personality; injuries affecting development (Horizon); any same-season rating change.

**Acceptance:** F4 is world-model work that affects later game outcomes; year-1 invariance alone is necessary but insufficient. F4a commits the curve report and held-out numbers with profile/calibrate unchanged. F4b/F4c assert the year-1 profile is byte-identical, then run the enforced profile against deterministic evolved pools at **years 3, 5, and 10** (via a reusable pool parameter or equivalent non-mutating harness); all enforced stats must remain in band or the phase stops for a model discussion. `test-multi-season.ts` also asserts league-wide rating mean/spread remains anchored, age distribution is bounded and not old-skewed, retirements occur, pool + roster population remains solvent for 10+ seasons, rotations are valid after every boundary, and double-runs are byte-identical while different world seeds produce different development outcomes. Snapshot baselines must recompute identically from their declared eligible season-start pool.

### 5.5 F5 — In-season transaction integration (Wave 6 — ahead of the harness)

**Goal:** make mid-season roster movement *livable* — paid **before any code executes a mid-season trade at all** (the 5c fuzzer trades through the real gate at in-season dates). Revision 4 note: the rotation-repair *primitive* now ships at F3; F5's scope is its **in-season call sites** plus the genuinely in-season-specific work — stat stints and deadline wiring.

**Verified gaps this closes:** in-season trades/signings/cuts don't call rotation repair; `PlayerSeasonStats` carries a single `teamId` (no stints); the temporal-legality validator takes a configured deadline while the live season has a real `trade_deadline` marker to wire. Pre-F5, a mid-season trade also means F3's fold-in writes an unrepairable wrong single-stint `careerStats` row — one more reason no automated path may trade mid-season before this phase.

**Adds:**
- **In-season rotation-repair wiring:** every in-season roster mutation (trade/sign/cut) calls the **F3 primitive** (`normalizeRotation`) for each affected team — no new repair logic, no parallel implementation (§9.10).
- **Per-team stat stints:** `PlayerSeasonStats` (or a parallel structure) splits by team stint; season totals remain derivable; F3's fold-in updated to emit one row per stint (real-NBA convention; each stint row carries `source: 'sim'`).
- **Live-calendar wiring:** in-season transactions pass `season.currentDate` and the `trade_deadline` marker into the gate's temporal validator (which already fails closed on missing/invalid dates); FA signing remains legal post-deadline per real rules.
- Schema bump **v11** (stint shape) + migration (legacy single-stint rows migrate losslessly) + round-trip.

**Out of scope:** proposal AI, offer inbox, any UI (T-7/U1); waiver periods (Horizon).

**Acceptance:** standard non-engine checklist; extend `scripts/test-transactions.ts` (or a new `test-inseason.ts`): trade at mid-season → rotations valid for the very next game, stats split correctly, fold-in emits correct per-stint rows, determinism of subsequent games unchanged (per-game seeds are `(season.seed, gameId)`, so identical futures given identical rosters — assert the mechanism); deadline enforcement flips exactly at the marker.

---

## 6 · Track T — GM & transactions (amendments to `docs/TRANSACTIONS_ROADMAP.md`)

Phases 5c–8 are specified in the transactions roadmap; that document remains authoritative for their mechanics and per-phase contracts, while this section records the global prerequisites and amendments applied by R0a.

### 6.1 T-5c — league-balance harness (amendments)

The transactions roadmap defines the metrics (talent dispersion / Gini, championship & playoff entropy, churn and value-pump signals), the paired fixed-seed-suite N-season structure, the machine-diffable summary, and the baseline-first discipline. Five amendments from this roadmap's vantage:

1. **World advance goes through the F3 seam.** The harness's season loop is `advanceToNextSeason`. A harness-private season cycle is exactly the parallel-notion drift `AGENTS.md` bans. If the seam's pure-at-the-boundary contract creates memory pressure at harness scale, the fix is inside the seam (§5.3's performance note) — never a harness fork.
2. **The harness ships a deterministic proposal fuzzer.** A clearly-fenced, harness-only generator of legality-respecting candidate trades (seeded, deterministic, dumb by design — random-ish asset pairings filtered through the real gate), used purely to stress the valuation/sanity layer. Lives under `scripts/`, never imported by app code, header states it is **not** the Phase-7 proposal AI. A fuzzer is test infrastructure; Phase 7's proposal generation is heuristic-bounded game AI.
3. **The fuzzer trades at real in-season dates.** F5 precedes 5c, so the fuzzer executes across the legal calendar — including the deadline window — through the live temporal validator, with rotation repair and stints absorbing each trade. Fuzzer dates are seeded and deterministic. The offseason-only alternative remains rejected (§3.2).
4. **Sequence-level value-flow metrics are NORMATIVE (revision 4; suite-hardened in revision 8).** The per-trade referee (§6.2) is a filter, not a proof — cyclic laundering (A→B→C→A) and slow asymmetric bleed are *sequence* phenomena a per-trade check cannot see. The harness therefore computes, for **each declared fixed seed**, cumulative net base-value flow per team over N seasons (under the versioned shared valuation model, marked-at-trade-time), value-bearing cycle detection over the trade graph, and drift bounds (no team's cumulative net base-value inflow from CPU↔CPU trades exceeds a named tolerance). A cycle is not itself a failure; it fails only when marked-at-trade-time value transported around it exceeds the declared tolerance or exhibits repeatable laundering. Hard invariants (asset-universe conservation, duplicate absence, deterministic rerun) pass for every seed; statistical acceptance reports paired per-seed deltas plus declared aggregate tail bounds. These are pass/fail criteria for T-6 and T-7 acceptance — not informational.
5. **Baseline policy binds to the re-baseline matrix (§3.3).** The authoritative trade-free baseline is the paired suite captured on the post-**S2d/F2/F3/F4c/F5** world, immediately before T-6, and re-captured whenever a ● phase lands. Championship entropy uses the real F2 champion; no top-seed proxy is permitted at this gate.

### 6.2 T-6 — trade AI / CPU valuation (amendments)

- **Calibrate on the real pool.** T-6 lands post-S2d; its valuation calibration pass runs against the activated pipeline-derived pool, re-run if anything in the matrix fired since.
- **One shared valuation module, two value layers (revision 4 — the load-bearing distinction).** Recommended home: `src/transactions/value.ts`. The module produces (a) a **context-free base value** per asset — the league-wide, team-independent worth under the versioned model — and (b) **team-context adjustments** (lineup fit, positional scarcity for *this* roster, timeline fit) that produce per-team **desirability**. `evaluateTradeForCpu` consumes desirability. Fit-adjusted mutual gains are legitimate gains from trade. Do not describe an ordinary base-value transfer from one team to another as "league-value creation": with one shared additive model, the receiver's gain is the sender's loss.
- **Information policy (settled for v1).** The shared base-value referee and CPU desirability both read **true ratings**. The latter is an explicit omniscient-front-office simplification, not a leak from the GM UI: U1's scouted rendering affects only what the controlled user sees and never changes legality, referee value, or CPU valuation. Team-scoped CPU scouting is a later product feature; if added, it requires a T-6 recalibration and 5c-suite re-baseline rather than a silent change in information quality.
- **Three separate referee claims (do not collapse them):** (1) **bounded per-trade imbalance** — compare each side's sent/received base totals and reject a difference outside a named absolute-and-relative tolerance; this is a fairness/exploit guard, not conservation; (2) **asset-universe conservation** — the orchestration proves the same typed assets exist exactly once before and after execution and their summed context-free value is unchanged except for explicitly modeled transaction consequences; this is the no-creation/no-duplication invariant; (3) **sequence flow** — §6.1 measures cumulative marked-at-trade-time transfers and value-bearing cycles over N seasons. The first two apply to every game-facing trade; the third is normative for autonomous CPU trading.
- **Controlled-team policy is explicit:** the current `AGENTS.md` rule makes the bounded base-value guard universal, so a controlled team may not knowingly make a materially lopsided overpay or underpay even when the counterparty CPU would accept it contextually. Treat that as a conscious anti-exploit product decision, not an implication of "value conservation." Changing to an asymmetric exploit-only guard is a maintainer decision that must update `AGENTS.md` first; an implementing agent may not choose silently.
- **Where the referee enforces: shared execution orchestration, never the gate.** The gate is the legality layer; legality ≠ desirability is permanent, and legality stays CBA-mechanical and valuation-free. One shared game-facing execution entry point composes the context-free referee → legality gate, with proposer-specific desirability checks before it: CPU↔CPU auto-execution uses both teams' desirability decisions; a controlled-team proposal uses the counterparty CPU's desirability decision. There is no app/runtime path around this orchestration layer (assert it). Low-level direct gate calls remain available to focused legality tests, but are not game-facing execution. Human involvement does not exempt a trade from the base-value invariant; CPU desirability remains the gameplay defense against a deal that is base-balanced but contextually bad for the CPU. The valuation model is versioned, deterministic, and reads ratings without ever writing them.
- **Acceptance:** the 5c harness with fuzzer + valuation enabled, paired against every seed in the trade-free suite, **passing the normative sequence metrics** (§6.1.4) and declared aggregate tail bounds over N seasons.

### 6.3 T-7 — AI-initiated ecosystem, then U1 — GM UI v1 (ordered program)

This wave is not one diff. Its ordered execution units are:

1. **T-7a — autonomous league agency.** Heuristic-bounded proposal generation (never brute-force), CPU FA signing via Phase-6 valuation + Phase-4 room, deadline buy/sell behavior, and persisted offer/inbox events. F3's continuity autofill becomes a final fallback. CPU↔CPU proposals reaching auto-execution route through the shared referee-then-gate entry point (§6.2). Acceptance is the 5c harness with proactive trading, including the normative sequence metrics.
2. **U1a — offer inbox + trade workspace.** Accept/reject/counter, an asset picker over `TradeAsset[]`, and live unified legality reasons. No free-agency dashboard or scouting work in this unit.
3. **U1b — free agency + financial surfaces.** Pool browser, desired contracts, exception context, and the payroll/cap/tax/apron/dead-money/TPE dashboard, consuming existing derived transaction accessors.
4. **U1c — scouting fog of war.** Wire stable scouted rendering and accuracy improvement after the transaction UX is independently accepted.

Each unit lands and revalidates before the next. T-7a has F5 as a hard prerequisite; UI units consume T-7a's persisted event contracts rather than inventing parallel client state.

**The completed U1 program provides the first real GM surface:**
- **Offer inbox** (accept / reject / counter), **trade-proposal screen** (asset picker over `TradeAsset[]`, live legality read-out from the gate's unified reasons), **free-agency flow** (pool browser, desired contracts, exception context via `getTeamCapStatus`/`getTeamFinancialSummary`), **team financial dashboard** (payroll/cap/tax/aprons/dead money/TPEs — existing derived accessors).
- **Scouting fog-of-war:** GM-facing ratings render through `getScoutedRatings` with per-player `scoutingAccuracy`; `improveScoutingAccuracy` wired to minutes observed. Prompt-time decision (OOTP lens): recommend everything scouted, own-team accuracy high and improving. **Hard rule unchanged:** no simulation path ever reads the scouted view; the scouted render draws from a **UI-side seeded stream keyed on `fnv1a(playerId + '|' + accuracyBucket)`** or equivalent, so displayed noise is stable between page loads (save-independence is fine here — this stream renders display noise and never touches world state; §9.2's lineage rule governs persisted generation, not UI fuzz).
- **Out of scope for U1:** draft UI (T-8), RFA UI (7.5), rotation/tactics editors beyond what repair requires (Horizon).

### 6.4 T-7.5 — restricted free agency

As specified in the transactions roadmap (qualifying offers on the explicit rights-owned hold model; offer sheets via Phase-6/7 machinery; match window as a controlled-team decision point and a CPU valuation decision). No amendments beyond sequencing; UI extends U1's FA flow.

### 6.5 T-8 — the draft (amendments)

The transactions roadmap owns the structure. T-8 is an ordered program, not one diff:

1. **T-8a — draft order and pick ledger.** Define canonical saved pick ownership with explicit F3 rollover carry-forward. Build deterministic lottery/order resolution from regular-season standings, playoff finish, named current-NBA lottery constants sourced at implementation, and stable tiebreaks; the lottery stream descends from `deterministicSeed(season.seed, draftId)`. Include both rounds and a script harness that proves the same season yields the same order.
2. **T-8b — pick assets and predicates.** Extend `TradeAsset[]` with picks, then add protections, conveyance, swaps, and Stepien predicates behind the single asset constructor and shared execution/referee path. The asset universe must account for every owned pick exactly once across rollover and transactions.
3. **T-8c — empirical prospect priors and contracts.** `combine` (2000–25) and `players` (draftYear/round/pick) joined to `box_advanced` careers yield real **pick-value curves** and measurable-vs-outcome priors, shaping deterministic prospect generation and feeding Phase-6 valuation a pick-value input that isn't folklore. `tsx scripts/derive-pick-value.ts` follows the S1/F4 discipline, including survivor-bias treatment and held-out validation. Prospects develop through F4 — no parallel path; scouting uncertainty is fuzz over potential.
4. **T-8d — draft event and integration.** Run the deterministic selection event in the F3 seam between rollover and free agency, instantiate rookie-scale contracts, and replace F4's replacement-level generation as the league's normal inflow (demoting it to a final fallback). Draft UI follows the event contract rather than inventing client state.

---

## 7 · Track U — presentation & UX (running list)

U1 (§6.3) is the anchor deliverable. Around it, smaller UI work slots wherever convenient **provided it stays read-only over existing derived state** (read-only UI phases need no schema bumps and can't perturb calibration):

- Box score & play-by-play viewer for completed games (the event stream is the source of truth; pure render).
- League leaders / stat pages off `playerStats` (+ playoff splits post-F2, stint-aware post-F5).
- Bracket & series views (with F2), offseason hub (with F3/T-7/T-8), franchise history page (championships, career logs — the self-contained per-season records were designed for this concatenation).
- Save-slot polish (rename exists; duplicate/export if appetite).

Standing UI rules: server components read through existing API routes/stores; no UI-side derivation duplicating a transactions accessor; scouted-vs-true display policy set once in U1 and reused.

---

## 8 · Horizon (consciously unscheduled — decisions, not surprises)

- **Waiver wire / claims**, **cash considerations** (a `TradeAsset` kind — payload ready), **10-day/hardship contracts**, **Disabled Player Exception**, **two-way roster structure**.
- **Advanced stats & awards:** populate the deliberately-empty `StatLine` advanced fields post-game, then MVP/All-League/etc. The `addXStats` stubs remain no-ops until deliberately scheduled.
- **Playoff-context sim behavior** (rotation tightening, leverage minutes — note: S1-Rb's margin diagnosis landed the bounded regular-season effort/coasting response (`COAST_*`); this item is now its playoff extension), **coaching/tactics AI**, **morale/chemistry**, **sim-responsive tendency drift** (feedback-loop warning; damping design required first), **new play types** (possession-model redesign — and the escape hatch if S2's frequency fix can't reconcile real diets with in-band shares).
- **Modern-era calibrate benchmark:** a dedicated derivation from normalized modern games so `npm run calibrate` regains acceptance meaning. `docs/LEAGUE_TARGETS.md` alone is insufficient because the calibrate table also needs scoring spread, home-win percentage, and home scoring advantage; ship all fields from one provenance-consistent derivation rather than assembling a partial row.
- **Finances beyond the cap**, **news feed / narrative**, **historical-era league starts** (would need its own era-pinned target derivation — `derive-league-targets.ts --seasons` already structurally supports it), **records & Hall of Fame**.

---

## 9 · Cross-cutting invariants (deltas on top of `AGENTS.md`)

`AGENTS.md` remains the constitution; nothing here weakens it. These are the additions this roadmap introduces, each folded into `AGENTS.md` by the phase that makes it live:

1. **No sim-stat feedback into ratings or tendencies (live from F3) — enforced by provenance.** Sim-generated `careerStats` rows carry `source: 'sim'`; `recomputeUsageAndFreeThrowFields` and every Stage-2 derivation function filter to `'real'` rows only — covering the migration door. Player change flows through F4's development functions exclusively. An agent asked to "refresh ratings from stats" mid-franchise must stop and surface.
2. **Seed policy (LIVE — shipped at S1-Ra, codified in `AGENTS.md` by R0b).** `Math.random` and ambient time-based seeds are prohibited inside `src/engine`, **without exception** — engine public constructors require a seed. Ambient randomness is sanctioned only at the app boundary (menu/API — the shared resolver `src/lib/seed.ts`), choosing a brand-new world's validated seed, which is then persisted; everything downstream is `SeededRNG` on stable keys. Data-shaping/generation scripts take their seed as input (`scripts/seed-test.ts` is out of policy; resolved at S2). **Lineage:** one-shot boundary generation may use save-independent per-id keys (`fnv1a(id)`); *recurring per-season* world-state generation must descend from the world's seed via `deterministicSeed(season.seed, stableKey)`. UI-only display noise (scouted-ratings fuzz) is exempt — it renders, never persists.
3. **Derivation scripts are artifacts (LIVE — shipped with S1).** Any constant sourced from data ships with a re-runnable derivation script printing the values it justifies and the era window used; the constant's annotation names the script and season basis. The shipped exemplar sets the bar: `derive-league-targets.ts` — pure function of the normalized data, `--check` byte-idempotency, full provenance report. F4's and T-8's scripts match this standard, **plus their statistical contracts (proxy tables, coverage windows, corrections, held-out validation — §5.4)**.
4. **The re-baseline duty (LIVE — from S1).** A phase that invalidates a tuned artifact per §3.3 re-derives/re-verifies it inside its own acceptance. Corollary: ∥ phases land sequentially against main. Second corollary: a *documented, owner-assigned* compensation (§1.3.3) is the only acceptable form of leaving one — silent compensation remains the named trap. Third corollary (revision 4): **status is earned by a reported acceptance run, never inferred from artifacts** (§2).
5. **One world-advance seam (live from F3).** Harnesses, UI flows, and scripts that cycle seasons call `advanceToNextSeason` — never a private reimplementation. Performance concerns are solved inside the seam.
6. **UI-side scouting noise is stable (live from U1).** The scouted render draws from a seeded stream on a stable key; ratings must not visibly re-roll between views. No simulation path reads scouted values — unchanged and eternal.
7. **The gate is valuation-free, forever (live from T-6).** Legality ≠ desirability extends to the base-value referee: the gate validates CBA mechanics only; valuation-derived checks live in shared game-facing execution orchestration outside it. **Every game-facing executed trade—including controlled-team proposals—passes the bounded-imbalance and asset-universe-conservation checks before the gate;** proposer-specific CPU desirability is a separate preceding decision. A transfer is not creation; fit-adjusted mutual gains are legitimate; the normative anti-laundering guarantee for autonomous CPU trading is the 5c cumulative-flow and value-bearing-cycle metrics (§6.1.4), not the per-trade check alone.
8. **Schema-version ledger.** v7 = current (F1 controlled-franchise identity; v6 = usage/FT recompute). Planned: v8 F2 · v9 F3 (careerStats provenance + season counter) · v10 F4 (per-season baselines, retirement entries) · v11 F5 (stat stints) — indicative, renumber freely as phases land (S2 expected to need no bump), but **every** persisted-state phase bumps, migrates, and round-trips, and the `models/save.ts` docblock ledger stays the canonical history.
9. **Tier assignment is fixed before tuning, never outcome-based (LIVE — shipped with S1).** ENFORCED vs INFORMATIONAL is declared (with a stage owner per informational gap) in the committed provenance report *before* tuning. Re-tiering to make a failing run pass is prohibited — **explicitly including re-tiering margin during S1-R.** Informational items with named residual status (the assisted sign structure) cannot block acceptance but cannot be dropped silently: they are fixed, or their diagnosis is written and handed to their owner.
10. **One rotation-repair primitive (live from F3 — refined in revision 5).** All roster-membership repair of persisted rotations — offseason (rollover, autofill, retirement, replacement generation) and in-season (trades, signings, cuts) — goes through the single deterministic primitive shipped at F3 (which generalizes `adjustRotation`'s existing injury-repair pattern). Its two explicit modes preserve operation ordering: `sanitize` removes stale membership and permits a temporarily incomplete rotation; `finalize` runs only after roster restoration, fills starters, and rebalances minutes. Parallel repair implementations are banned; a phase needing different slotting behavior extends this primitive with documented, deterministic rules.

---

## 10 · Per-phase prompt template

Instantiate this skeleton for every phase. The prompt must be fully self-contained — Claude Code has no memory of this document, the discussion, or prior sessions.

```
CONTEXT
- One paragraph: what Off the Court is, the stack, and what this phase does.
- Read AGENTS.md in full before any change; treat its rules as hard constraints.
- Read docs/ROADMAP.md §<phase> and (if transaction-layer) docs/TRANSACTIONS_ROADMAP.md §<phase>.
- Current verified state this phase builds on: <the 2–5 facts that matter, stated, not assumed>.

PRE-FLIGHT — BEFORE EDITING
- Inspect staged, unstaged, and untracked files; preserve unrelated user work.
- Capture the fixed-seed `npm run profile` output and exit code plus `npm run calibrate` output.
  These are the before side of every unchanged/delta claim; never reconstruct a baseline afterward.
- If the `tsx` CLI fails with sandbox IPC `listen EPERM`, use the behavior-equivalent fallback
  `node --import tsx <script>` (including `node --import tsx scripts/profile-engine.ts`).
- Run the phase's existing focused harness before editing so inherited failures are separated
  from regressions introduced by this unit.

TASK
- Precise scope: files, functions, data-model changes, named constants (with sane ranges).
- Design decisions already made (restate them; do not re-litigate): <list>.
- Decisions intentionally left open, each with a STOP-AND-SURFACE instruction: <list>.

HARD CONSTRAINTS (restate; do not paraphrase away)
- No Math.random anywhere in src/engine — engine entry points require a seed; SeededRNG only,
  stable keys (one-shot boundary generation: fnv1a per-id; recurring per-season world-state
  generation: deterministicSeed(season.seed, key)); stable draw order.
- Stats derive from the PlayByPlayEvent stream; addXStats stubs stay no-ops.
- 1–80 ratings centered at 40; shot math additive and clamped; constants in constants.ts, annotated.
- Six-zone shot model per the settled Stage 1 mapping (docs/LEAGUE_TARGETS.md); rim = restricted
  area only. Never re-derive targets by hand — re-run derive-league-targets.ts and re-transcribe.
- ENFORCED/INFORMATIONAL tier assignment is fixed before tuning; no re-tiering to pass (ROADMAP §9.9).
- Rotation-membership repair goes through the shared primitive only (ROADMAP §9.10; from F3 on).
- Never read scouted ratings on a sim path. Never sum ratings to value a lineup.
- No sim-stat feedback into ratings/tendencies; derivation/recompute tools consume
  source:'real' careerStats rows only (ROADMAP §9.1).
- Transaction layer (if touched): atomic validate-then-mutate gate; composable validators with
  unified reasons; legality ≠ desirability (the gate is valuation-free — §9.7);
  every game-facing trade passes bounded base-value imbalance plus asset-universe-conservation
  checks in shared orchestration outside the gate; transfer is not mislabeled as creation;
  derive-don't-store (documented event-set exceptions); append-only log; asset-typed payload.

OUT OF SCOPE (binding)
- <the phase's list from the roadmap, verbatim, plus "nothing from any later phase">

SCHEMA & MIGRATION (if persisted state changes)
- Bump SAVE_SCHEMA_VERSION to <n>; migration from <n-1>; migration twice is a no-op;
  extend the scripts/ round-trip check; generation seeds per the §9.2 lineage policy.

VERIFICATION (run all; report results and before/after deltas)
[ ] npm run typecheck
[ ] npm run profile   — engine phases: PASS (exit 0; all ENFORCED stats in band), deltas reported,
                        informational tables included in the report.
                        non-engine phases: byte-identical to the captured pre-flight baseline.
[ ] npm run calibrate — drift comparison, NOT an acceptance: non-engine phases show output
                        UNCHANGED; engine phases report deltas and explain their direction.
                        (Historical benchmark ends 2015; a modern-tuned engine sits above it
                        by design.)
[ ] tsx scripts/test-determinism.ts
[ ] tsx scripts/test-spacing-ab.ts and test-defense-ab.ts (engine phases)
[ ] <phase-specific harness(es), named>
[ ] Re-baseline duty per ROADMAP §3.3: <artifacts this phase must re-derive/re-verify, or "none">
[ ] Scope guard: nothing from a later phase was built early.
[ ] Baseline provenance: attach/hash the actual pre-flight outputs used for every unchanged claim.

REPORT
- What changed, why, before/after profile deltas, harness output, and any surfaced decisions.
- Update docs/PROJECT_STATUS.md in the same diff: snapshot date/commit, verification
  evidence (including stdout SHA-256 baselines captured with --silent), and the track table.
```

---

## Appendix A · Stop-and-surface registry (global halt conditions)

Any phase, any agent — halt and report rather than improvise when:

1. A task appears to require violating an `AGENTS.md` rule or a §9 invariant.
2. A required normalized contract is missing, `manifest.json` is not `complete`, or `validate-nba-data` SKIPs a contract the phase consumes.
3. A pbp↔shot_events exact join drops below 99.9% coverage in any future derivation, or a description-parsed quantity would become **load-bearing** (enforced or constant-pinning) without an independent box-score cross-check inside a named tolerance. (Stage 1's record: join at 100%; parsed assisted rates kept informational because of the definitional gap — the default posture for parsed quantities.)
4. Crosswalk match rate (if the migrate-current-pool path is ever chosen) falls below its declared threshold, or any player identity would have to be guessed.
5. A derived constant can't be reconciled with observed data through the modifier stack within tolerance; two derivation scripts would use different era windows for constants feeding the same simulated league; or a tuning task would require *silent* shading of a data-derived table (documented, owner-assigned shading per §9.4 is the only acceptable form).
6. A migration would need to rewrite an append-only log entry, or rollover/gate code encounters a state outside its tested contract, or a migration/recompute path would consume `source: 'sim'` careerStats rows (§9.1).
7. Determinism would require a branch that sometimes draws RNG and sometimes doesn't, with no stable-order restructuring available — or any change would reintroduce ambient randomness inside `src/engine` (§9.2).
8. `careerStats`/derivation interactions imply re-deriving ratings from sim output (§9.1).
9. Roster continuity can't be maintained (autofill can't reach `ROSTER_MIN` — pre-F4; post-F4, replacement generation is the sanctioned response and this halt fires only if generation itself can't restore solvency), or rotation normalization can't produce a valid rotation from an at-minimum roster.
10. A tuned stat can only reach its band by suppressing a symptom. Canonical example: turnovers spiking after chain changes → tune the advantage bonus, don't mask turnovers. **Margin corollary (S1-R):** margin reachable only via score-targeting mechanisms, variance suppression that breaks other bands, or re-tiering — halt; that outcome indicts the possession model's advantage compounding, a design conversation. **Aging-curve corollary (F4):** survivor-only deltas are symptom-suppression of decline. **Tier corollary (§9.9):** re-tiering an ENFORCED stat to pass is the same failure.
11. Two documents in the repo contradict each other about shipped state (fix the doc as part of the phase or surface it — never silently trust the older claim). *(The Phase-5b/schema-v6 contradiction was resolved by R0a.)*
12. Any code path would execute an **in-season** roster mutation before F5's wiring exists (stints and repaired rotations for the next game); pre-F3, this extends to *any* automated roster mutation touching persisted rotations, since the repair primitive doesn't exist yet.
13. An S2/S3 task would tune the engine putback play-type frequency to the pbp putback-attempt share — the report explicitly warns these are different concepts.
14. **An F4/T-8 curve would claim a historical basis its proxies don't cover** (e.g. an "athleticism 1996–2025" curve silently leaning on 2013+ tracking data) — declare coverage honestly or halt (§5.4.2).

## Appendix B · Artifact & oracle registry

The tuned/derived artifacts the re-baseline matrix (§3.3) governs — location, owner, refresh path.

| Artifact | Lives in | Refresh via | Notes |
|---|---|---|---|
| **Profile targets + tolerance bands** | `scripts/profile-engine.ts` (transcribed) ← `scripts/derive-league-targets.ts` → `docs/LEAGUE_TARGETS.md` | Re-run the derivation (`--check` gates the committed report; `--seasons` for a window change), re-transcribe via the printed block | **Live (S1).** Era window 2023-24..2025-26 pooled. Targets change only when the data or the declared window changes — never by hand-edit, never to make a run pass. |
| **Profile PASS status** | the engine itself | `npm run profile` (exit code) | **PASSING** (32/32 ENFORCED, exit 0; margin 13.4 vs 12.87 ± 1.0 — S1-Rb accepted run, 2026-07-06). Every subsequent phase's baseline. |
| Zone bases & shot-context constants (`BASE_FG_PCT_BY_ZONE`, `PLAY_TYPE_SHOT_ZONES`, …) | `engine/constants.ts` | `npm run profile` tuning against the derived targets | Annotated tuned knobs (pre-modifier ≠ observed). Carries the documented `KNOWN STAGE 2 ARTIFACT` shading — S2 owns the unwind. |
| Six-zone mapping + heave rule + `deep_three` boundary | `derive-league-targets.ts` constants + `constants.ts` mapping block + `docs/LEAGUE_TARGETS.md` | Settled Stage-1 decisions; re-open only with a deliberate era-window change (2025-26 heave-basis caveat) | 14 ft short/long split · 27 ft deep-three · 32 ft ∧ ≤3 s heave. |
| **Calibrate drift report** | `scripts/calibrate-history.ts` (+ `npm run download-history` data) | Re-run; report deltas | **Reclassified (revision 4):** historical data ends 2015 → a drift comparison, not an era acceptance. Expected gap vs a 2023–26-tuned engine (~114.4 vs 99.3). A complete modern-era row requires its own normalized-games derivation (Horizon); it is not part of S1-R. |
| FT inverse pair (`FT_LEAGUE_AVG_PCT`/`FT_PCT_SLOPE`/`FT_DERIVE_SCALE`) | `engine/constants.ts` | Round-trip asserted by the S2d harness (`scripts/test-s2c1-r.ts`) | Change together, always. Settled at S2d (2026-07-14): anchored to the empirical 0.7823. |
| Spacing/versatility baselines (`SPACING_*`, `VERSATILITY_*`) | `engine/constants.ts` | `tsx scripts/calibrate-spacing.ts` | Re-derived at S2d (2026-07-14) from the activated pool, spacing weighted by production finisher-selection shares (shared `primaryPlayerWeight`); per-season deterministic snapshots at F4 (constants remain the season-1 anchor). |
| A/B expectations | `scripts/test-spacing-ab.ts`, `test-defense-ab.ts` | Re-verified at S2d on the activated pool (defense fixtures rescaled to its rating scale) | Material, correctly-signed effects. Green 2026-07-14. |
| Rating statistical contract (spread/tails/shrinkage/correlations) | S2 derivation module + its committed report | S2 derivation re-run | New at S2 (§4.2). The modifier-distribution comparison is the operative check. |
| Aging/development curves + evolved-pool profile | `engine`- or `ratings`-side constants (F4) plus the reusable pool-profile harness | `tsx scripts/derive-aging-curves.ts` over Stage-0 longitudinal data; profile deterministic year-3/year-5/year-10 pools | New at F4a–c; proxy-mapping table + coverage windows + survivor-bias correction + era normalization + held-out validation, followed by enforced behavioral checks on evolved leagues (§5.4). |
| Rotation-repair primitive | `engine`/shared module (F3) | Deterministic; extended, never duplicated (§9.10) | Generalizes `adjustRotation`; `sanitize` after removals, `finalize` only after roster restoration; consumed by F3/F4/F5. |
| Pick-value curve | valuation constants (T-8) | `tsx scripts/derive-pick-value.ts` | New at T-8; feeds Phase-6 valuation; survivor-bias caution applies (§6.5). |
| 5c trade-free baseline + **normative sequence metrics** | committed summary JSON from `scripts/league-balance.ts` | Re-run the paired fixed seed suite | Capture post-S2d/F2/F3/F4c/F5, immediately pre-T-6; re-capture on any ● phase. Per-seed hard invariants plus paired aggregate-tail bounds for sequence metrics (cumulative base-value flow, value-bearing cycle detection, drift bounds) are pass/fail for T-6/T-7 (§6.1.4). |
| Phase-6 valuation calibration (base value + context adjustments) | `src/transactions/value.ts` constants + calibration notes | T-6 calibration pass | On the real (post-S2d) pool only; base/context split per §6.2. |
| CBA constants | `src/transactions/constants.ts` (`CAP_RULES_YEAR = '2025-26'`) | Manual, sourced-at-implementation updates | Tunable game constants, never derived, never from memory. |

---

*Maintenance rule for this document: it is grounded, not aspirational — update a phase's status only after it ships **and its acceptance run is reported** (revision 4's S1 correction is the standing example of why inference doesn't count). When a phase's execution diverges from its spec here, the divergence gets written back in the same commit.*
