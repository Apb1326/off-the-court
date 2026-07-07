<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Off the Court — engineering rules

Rules for anyone, human or AI, working on the simulation. They exist because the engine's correctness depends on invariants that are easy to break without an error ever being thrown: silently miscalibrated stats, a desynced RNG stream, value that quietly becomes additive again. Read this before touching `src/engine`.

> AI coding assistants: treat these as hard constraints. When a task appears to require violating one, stop and surface the conflict instead of working around it. Work in small, reviewable diffs, and after any engine change report what you changed, the before/after `npm run profile` deltas, and the A/B result.

> **Scope.** The golden rules and simulation invariants below govern `src/engine` and anything that affects a single game's outcome. `docs/ROADMAP.md` owns global sequencing across simulation, franchise, transactions, and UI. Work on the **transactions / GM layer** (trades, contracts, cap, draft) is a separate surface with its own hard rules — see *Transaction-layer rules* near the end of this file and `docs/TRANSACTIONS_ROADMAP.md` for its mechanics and phase contracts. The determinism rule (#2) applies to **both** surfaces.

## Golden rules

1. **Simulate from true ratings, never scouted.** The sim resolves from `player.ratings`. The scouted view (`ratings/scouting.ts`) is for the GM-facing UI and AI only. Any simulation path that reads scouted values to decide an outcome is a bug.
2. **All randomness goes through `SeededRNG`.** Never call `Math.random()` in simulation code. Determinism — same seed → byte-identical box score *and* play-by-play — is load-bearing for calibration and testing. This extends beyond the sim: any deterministic generation outside it (migration-time contract/prospect generation, AI tie-breaks) also goes through `SeededRNG`, seeded from a **stable key** (see *Transaction-layer rules*), never `Math.random()`. See *The seed boundary* below for where a brand-new world's seed may be chosen.
3. **Stats are derived from the `PlayByPlayEvent` stream, never assigned directly.** Emit the event; `recordEventStats` in `engine/index.ts` drives the `StatsAccumulator`. The `addXStats` functions in `possession.ts` are intentional no-op stubs — do not "implement" them or hand-increment a stat line.
4. **Tunable numbers live in `engine/constants.ts`, annotated.** No magic numbers in engine logic. A new knob goes there with a comment on what it does and its sane range.
5. **Calibration is the acceptance test.** After any engine change, `npm run profile` must bring every tracked stat back within its tolerance band. A change that "works" but breaks calibration is not done.
6. **Never value a lineup by summing player ratings.** Value is relational. Spacing, the ball-movement chain, and defensive versatility carry the non-additive effects that are the whole point of the engine.

## Simulation invariants

**Rating scale.** 1–80, centered at **40** (`ratingToModifier`: `(rating - 40) / 40`). Not 0–100, not centered at 50.
The derivation layer must honor the same 40-centered convention. The
`FT_LEAGUE_AVG_PCT`, `FT_PCT_SLOPE`, and `FT_DERIVE_SCALE` constants in
`engine/constants.ts` form the free-throw derivation/resolution inverse pair;
change them together so real percentage → rating → sim percentage still round-trips.

**Shot math is additive and clamped.** `resolveShot` sums base zone % plus shooter, defender, fatigue, play-type, contest, form, double-team, momentum, advantage, and rush terms, then clamps to `[0.05, 0.95]`. Keep new modifiers additive and inside the clamp — no multiplicative terms that escape the bounds.

**Determinism.** Any new variation must draw from `SeededRNG` and consume randomness in a stable order. A branch that sometimes draws and sometimes doesn't will desync the stream. `spacing.ts` and the versatility math are deliberately pure arithmetic (no RNG) so they don't perturb it — keep them that way. Verify with `tsx scripts/test-determinism.ts`.

**The seed boundary (shipped at S1-Ra).** Public engine entry points — `simulateGame`, `simulateSeason`, `createSeasonState` — **require an explicit validated seed**; there are no ambient `Math.random()`/`Date.now()` fallbacks inside `src/engine`, without exception. A brand-new world's seed may be selected only at the **menu/API boundary** (the shared resolver in `src/lib/seed.ts`, consumed by the season/sim API routes, which validate a supplied seed or choose one when omitted), and is then **persisted** on the season; everything downstream descends from persisted seeds through `SeededRNG`. Seed lineage: **one-shot per-id generation** (e.g. migration-time contracts) seeds from a stable save-independent key such as FNV-1a of the id; **recurring season/world generation** (per-game seeds, injuries, future development) descends from the persisted world seed via `deterministicSeed(season.seed, stableKey)`. UI-only, non-persisted display noise (e.g. scouted-ratings fuzz) lives outside simulation outcomes and is exempt from the lineage rule — it renders, never persists, and never feeds a sim path.

## Possession engine (`possession.ts`)

The possession can develop through the initial action plus **up to `MAX_EXTRA_PASSES`** additional actions. This is a hard ceiling — do not loosen it.

- **Quality is keyed to advantage state, not pass count.** A pass earns a shot-quality bonus only when it cashes a live advantage (a double-team, a drive that collapses help). The bonus has diminishing returns (`ADVANTAGE_BONUS_DIMINISH`) and a hard ceiling (`ADVANTAGE_BONUS_CEIL`). A no-advantage swing earns nothing but still costs clock and carries bad-pass risk. Rewarding every pass equally is the wrong model and will miscalibrate.
- **Real kick-outs, not faked rates.** A double-team forces a real pass into the chain (`DOUBLE_TEAM_PASS_PROB`), routed toward the open shooter via `openManWeight`. Do not model help defense by bumping an assist-rate number.
- **One assist source.** The assister is the player who threw the pass into the make. There is no post-hoc assist roll — do not add one, and do not credit an assist on an unassisted (self-created) shot.
- **Realized advantage is spacing-gated.** A cashed advantage only becomes a clean look on a spaced floor (`SPACING_ADVANTAGE_COEF`); in a packed paint the help recovers. Keep this centered/net-neutral.
- **Late-clock degradation.** Under `SHOT_CLOCK_PRESSURE_THRESHOLD` the shot takes `SHOT_CLOCK_RUSH_PENALTY`. Preserve it.
- **Net-neutral efficiency.** The chain must not quietly inflate scoring. Per-pass clock cost and per-pass turnover risk carry that constraint. If turnovers spike implausibly in `npm run profile`, the signal is usually that the advantage bonus is too generous — tune the bonus, don't suppress turnovers to mask it.

Preserve the existing clock, fatigue, foul, penalty/bonus, transition, momentum, and substitution logic when editing the loop.

## Spacing & versatility (`spacing.ts`)

This layer already exists. **Do not rebuild it.**

- Offensive output consumes a centered spacing value from the off-ball four (everyone except the finisher), built from outside shooting × three-point tendency plus a threat-gated movement term.
- Defensive versatility is a centered z-score off the weak-link perimeter defender and mobility/size spread.
- Both are pure arithmetic and centered so a league-average lineup nets ~zero. When adding lineup-level effects, extend this model — don't introduce a parallel additive sum of ratings.
- Baselines/spreads (`SPACING_BASELINE_OFFBALL_FOUR`, `SPACING_SPREAD`, the versatility params) are derived from the real player pool by `tsx scripts/calibrate-spacing.ts`. Re-derive there rather than hand-editing if the player pool changes materially.

## Transaction-layer rules (`src/transactions`, GM/franchise layer)

These govern the **state-mutation layer on top of `SeasonState`** — trades, signings, cuts, contracts, cap, draft. The sim is untouched by this layer, so the sim-engine acceptance test changes: see the calibration note below. Full phase sequencing and per-phase scope live in `docs/TRANSACTIONS_ROADMAP.md`; read it before starting any transaction-layer phase, and **do not build a later phase's mechanics early.**

- **The validate-then-mutate gate is the only path.** Every transaction passes through one atomic chokepoint: validators run first and **compose** (each an independent predicate returning a unified reason — not nested conditionals); mutation happens only if all pass; nothing is ever half-applied.
- **Legality ≠ desirability, permanently.** Deterministic, *shared* legality (roster → cap → apron → temporal/NTC) lives in the gate and applies to every trade regardless of proposer. The CPU's valuation judgment lives in `evaluateTradeForCpu` and is desirability-only — it may assume legality already passed. Do not move legality inside the CPU acceptance function.
- **Derive, don't store.** Payroll derives from contracts; cap status derives from payroll; dead money derives from (original contract + immutable cut event). Never persist a derived number you have to keep in sync. **Documented exceptions are event-set state** — hard-cap status (triggered by a transaction, not computable from payroll) and injuries. Store those, and label them so no one "fixes" them into getters.
- **The transaction log is append-only.** Never rewrite a log entry. When a later phase makes a past action consequential (e.g. dead money on an earlier cut), derive the consequence from the original immutable event — don't patch the entry.
- **The free-agent pool is the canonical home for unsigned players** — a real pool in `SeasonState`, not a flag on the player. Everything that releases a player puts them there; everything that signs draws from there.
- **Trades carry typed assets.** The payload is `TradeAsset[]` per side (players now; picks, cash, pick-swaps later). Keep the shape isolated behind one constructor so adding asset types doesn't rip up the engine.
- **Deterministic, idempotent migrations.** Every phase that adds persisted state ships a **schema-version bump + migration** from the prior version, plus a `scripts/` round-trip check (load old → migrate → assert invariants → re-serialize). Migration run twice must be a **no-op**. Migration-time generation seeds from a **stable per-player key** (a pure, platform-stable string hash of the id — e.g. FNV-1a; not engine string-hash internals, not key-order-dependent, not folding in mutable fields) on a **dedicated RNG stream**, so it's order-independent and reproducible.
- **CBA numbers are tunable constants, sourced at implementation.** Matching bands, apron/tax thresholds, exception amounts → named constants in `constants.ts`, taken from the *current* CBA when written, never hardcoded from memory.
- **No value-pump loops (shared base-value referee).** Every executed trade is judged under a **single shared, versioned, context-free base-value model** — but keep the referee's three claims distinct (a transfer is not creation): (1) **bounded per-trade imbalance** — each side's sent/received base totals stay within named absolute and relative tolerances; a fairness/exploit guard, not conservation. (2) **Asset-universe conservation** — the same typed assets exist exactly once before and after execution and their summed context-free value is unchanged except for explicitly modeled transaction consequences; this is what actually detects duplication or mutation that creates value. (3) **Sequence-level flow** — cumulative marked-at-trade-time value flow per team and value-bearing cycle detection over N seasons (the Phase 5c harness) are the **normative** anti-laundering protections; a pairwise reversal check is insufficient (it misses cyclic A→B→C→A laundering and slow asymmetric bleed). Per-team desirability (`evaluateTradeForCpu`) may legitimately differ — fit-adjusted mutual gains are gains from trade — and stays separate from both legality and the shared referee.

**Calibration for this layer.** No transaction phase touches the sim, so `npm run profile` and `npm run calibrate` must come back **unchanged** — a diff there is a bug, not a side effect. The transaction layer's real acceptance test is the **multi-season league-balance harness** (`scripts/league-balance.ts`, built in roadmap Phase 5c): from the trade-AI phases on, assert talent dispersion stays bounded, championship distribution stays non-degenerate, asset-universe conservation holds, and the sequence-level value-flow and cycle metrics stay within tolerance of the trade-free baseline.

## NBA data pipeline (`pipeline/`, `data/nba/`, `src/data/nba/`)

The offline stats.nba.com harvest tool is **outside the sim** — it changes
nothing about engine behavior, ratings, ingest, or saves, and the engine
rules above don't apply to it, including determinism: the harvester may use
plain `random` for rate-limit jitter. The exception is **`normalize.py`,
which must stay idempotent** — a pure function of the raw cache producing
byte-identical output on re-run (sorted rows, sorted keys, no timestamps in
data payloads).

- **TypeScript never calls stats.nba.com.** The TS side (`src/data/nba/`)
  only reads `data/nba/normalized/` — versioned, schema-stable contracts
  owned by the TS types in `src/data/nba/types.ts`. If the NBA changes an
  endpoint, only Python changes; the contracts stay stable (bump
  `schema_version` for intentional contract changes).
- **The raw cache (`data/nba/raw/`) is never hand-edited.** It is the
  harvester's checkpoint/resume layer; fix problems by re-fetching
  (`--force`), not by editing files.
- The pipeline runs manually from a residential IP, never in CI or at app
  runtime, and is never imported by app code.
- The normalizer computes **no derived analytics** (no rating math, no
  league targets) — that work belongs to later pipeline stages.

**League calibration targets (Stage 1).** The targets `npm run profile`
enforces are **derived from `data/nba/normalized/` by
`npx tsx scripts/derive-league-targets.ts`**, which writes the provenance
report `docs/LEAGUE_TARGETS.md` (seasons, sample sizes, formulas, tolerance
derivation; `--check` verifies the committed copy byte-for-byte). Rules:

- **Re-derive, never hand-edit.** When the normalized data changes, re-run
  the script and re-transcribe; target numbers in `profile-engine.ts` carry
  provenance annotations and are never edited free-hand.
- **Targets ≠ base constants.** `BASE_FG_PCT_BY_ZONE` (and any constant whose
  realized output passes through modifiers) holds tuned knobs annotated
  against their empirical targets — never direct transcriptions of observed
  league values. Realized output = base + the average modifier stack, which
  does not average to zero; tune the base via profile until realized output
  lands on target.
- **Tier assignments are fixed per-task before tuning, never outcome-based.**
  ENFORCED stats pass/fail the profile; INFORMATIONAL stats are logged with
  the roadmap stage that owns closing their gap. Promoting or demoting a stat
  based on what a retune managed to hit is prohibited; an unreachable
  enforced target is a stop-and-surface, not a demotion.

## Verification checklist

Run after any engine change and report results:

- [ ] `npm run typecheck` — clean.
- [ ] `npm run profile` — the modern engine acceptance test: all ENFORCED stats within their derived tolerance bands (targets from `scripts/derive-league-targets.ts`; provenance in `docs/LEAGUE_TARGETS.md`); exits non-zero on failure. Report before/after deltas; watch assists and turnovers when chain logic changed.
- [ ] `npm run calibrate` — a **deterministic historical drift comparison, not pass/fail era acceptance** (its benchmark ends in 2015, so a 2023–26-tuned engine sits above its era rows by design). Engine changes report the deltas and explain their direction; the comparison stays useful precisely because it is deterministic — no silent drift.
- [ ] `tsx scripts/test-determinism.ts` — same seed → identical game.
- [ ] `tsx scripts/test-spacing-ab.ts` — spacing still shows a material, correctly-signed effect.

**For transaction-layer changes, additionally:**

- [ ] `npm run profile` / `npm run calibrate` — output **unchanged, byte-for-byte,** vs. an unmodified league (the sim is untouched; any diff is a bug). Calibrate's role as a drift-only comparison does not relax this: non-engine work must preserve both outputs exactly.
- [ ] Schema bump + migration shipped; `scripts/` round-trip check passes and migration run twice is a no-op.
- [ ] New validators are composable predicates returning a unified reason; legality stays out of `evaluateTradeForCpu`.
- [ ] No derived value stored as an independent source of truth (event-set exceptions documented).
- [ ] (Trade-AI phases) `scripts/league-balance.ts` within tolerance of the trade-free baseline; no value-pump loops.
- [ ] Scope guard: nothing from a later roadmap phase was built early.

## What not to do

- Don't call `Math.random()` anywhere in simulation code.
- Don't reintroduce an ambient seed default (`Math.random()` / `Date.now()`) on an engine entry point — seeds are validated or chosen at the menu/API boundary (`src/lib/seed.ts`) and persisted.
- Don't read scouted ratings on a simulation path.
- Don't hand-assign stats or fill in the no-op `addXStats` stubs.
- Don't sum player ratings to value a lineup.
- Don't reintroduce a post-hoc assist roll, or credit assists outside the chain.
- Don't let the possession chain exceed `MAX_EXTRA_PASSES`.
- Don't add RNG to `spacing.ts`.
- Don't scatter tuning numbers through the code — they go in `constants.ts`.
- Don't ship an engine change without re-running calibration.
- Don't store a derived value (payroll, cap status, dead money) as its own source of truth — derive it; only documented event-set state (hard-cap status, injuries) is persisted.
- Don't put legality logic inside `evaluateTradeForCpu`, or rewrite an append-only transaction-log entry.
- Don't use `Math.random()` or a platform-dependent hash in migrations or AI tie-breaks — `SeededRNG` from a stable key.
- Don't build a later roadmap phase's mechanics early.

## Known cleanups

- None currently. (The stale `shouldDoubleTeam` doc comment in `defense.ts` was fixed in R0b.)
