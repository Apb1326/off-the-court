<!--
HISTORICAL ANNOTATION — added by R0b (2026-07-06). Everything below the
"ORIGINAL PROMPT" divider is the finalized Stage 1 implementation prompt,
preserved verbatim as it was run (recovered from the 2026-07-02 execution
session; the work landed via PR #18, merge 7805d67). This annotation records
what happened after the prompt ran; the prompt itself did not predict these
outcomes.

1. Implemented divergences (recorded in docs/ROADMAP.md §4.1):
   - The profile itself became the acceptance test (ENFORCED targets with
     derived tolerance bands, non-zero exit), superseding the planned BASE
     oracle concept. [DIVERGENCE — improvement]
   - A full six-zone re-map shipped (rim = Restricted Area only;
     short_midrange = Paint(Non-RA) + Mid-Range < 14 ft; long_midrange =
     Mid-Range ≥ 14 ft; deep_three = above-break ≥ 27 ft), going further
     than the planned reconciliation. [DIVERGENCE — improvement]
   - Per-zone assisted rates were NOT used to anchor PLAY_TYPE_PASS_RATE:
     the NBA scorekeeper assist definition is more liberal than the engine's
     strict chain assist, so the enforced chain anchor became the box assist
     total (26.66/team-game from box_advanced); per-zone assisted rates were
     demoted to INFORMATIONAL with the sign structure as the sanity check,
     owner Stage 2/3. [DIVERGENCE — recorded]

2. Original acceptance failure: the 2026-07-06 local acceptance run showed
   `npm run profile` FAILING — average margin 16.8 vs target 12.87 ± 1.0
   (ENFORCED; exit 1) — and the INFORMATIONAL assisted-zone sign-structure
   check failing (corner three not the highest-assisted zone). Stage 1 was
   therefore reclassified "implemented, acceptance failing" (ROADMAP rev. 4)
   and the repair phase S1-R was inserted.

3. S1-Ra seed-boundary repair (PR #20, commit 8c27361, merged 2026-07-06):
   `simulateGame`, `simulateSeason`, and `createSeasonState` now require an
   explicit seed; the `Math.random()`/`Date.now()` fallbacks were removed
   from `src/engine`; seed validation/generation moved to the API boundary
   (`src/lib/seed.ts`); fixed-seed output was verified byte-identical to the
   pre-refactor baseline before any margin work began.

4. S1-Rb accepted repair (PR #21, commit acc011f, merged 2026-07-06):
   diagnosis (scripts/diagnose-margin.ts) found the margin excess was broad,
   not mismatch-driven, and rooted in the absence of margin-compressing
   effort behavior; the repair is a deterministic, bounded, symmetric
   coasting/effort response (COAST_LEAD_START / COAST_LEAD_FULL /
   COAST_SHOT_EFFORT_MAX) inside the existing shot clamp. Result:
   `npm run profile` PASS 32/32 ENFORCED, exit 0; average margin
   16.8 → 13.4 vs 12.87 ± 1.0; all other enforced stats unmoved.

5. Assisted-zone sign-structure disposition: diagnosed, handed off.
   scripts/diagnose-assists.ts showed kick-out routing is correct (90% of
   corner attempts terminate as spot-up catches); the flat per-zone assisted
   rates are definitional — zero-pass initial spot_up/off_screen shots are
   real-life catch-and-shoot that NBA scorekeeping credits as assisted.
   Remapping them reproduces the real sign structure (corner 94.2% vs real
   96.7%, highest by a wide margin). The fix is the S2/S3 assist-definition
   mapping; no Stage-1 engine change was taken.
-->

<!-- ═══════════════════ ORIGINAL PROMPT (verbatim) ═══════════════════ -->

# Stage 1 — League-Level Calibration Upgrade (Empirical Targets from the NBA Data Pipeline)

You are working on **Off the Court (OTC)**, a possession-by-possession NBA simulation engine (Next.js 16, React 19, TypeScript 5, Tailwind v4, JSON persistence, `tsx` for scripts). Every box-score number derives from a `PlayByPlayEvent` stream; stats are never assigned directly.

**Before making any changes, read `AGENTS.md` in full.** Its rules are binding. `CLAUDE.md` is a one-line `@AGENTS.md` import; keep the rules in `AGENTS.md`.

## Hard invariants (violating any of these fails the task)

- All randomness goes through `SeededRNG`. Never `Math.random`. A given seed must reproduce exactly.
- Stats derive from the `PlayByPlayEvent` stream. Nothing assigns stats directly.
- Ratings are on a **1–80 scale centered at 40**. Any code assuming a 50 midpoint or 0–100 range is wrong.
- Always simulate from true `ratings`, never the scouted view.
- Shot math stays **additive and clamped** around per-zone baselines.
- Tuning constants live in `src/engine/constants.ts`. No scattered magic numbers.
- The `addXStats` stubs are intentional no-ops. Leave them alone.
- The `pipeline/` Python directory is fenced off from the app. TypeScript never calls stats.nba.com; the TS side only reads `data/nba/normalized/`.

## What this stage is

Stage 0 built a Python pipeline that harvests stats.nba.com data into `data/nba/raw/` and normalizes it into versioned JSON contracts under `data/nba/normalized/`. Stage 1 **consumes that data to replace hand-set league constants and coarse calibration targets with empirically derived values**, and sharpens `npm run profile` into a stricter acceptance test.

**This stage changes `src/engine/constants.ts` and calibration scripts only. Engine logic is untouched. Ratings derivation is untouched. No per-player changes. No new mechanics.** In particular: play-type selection and transition coefficients are hardcoded in `src/engine/play-types.ts`, NOT in `constants.ts` — that file is out of scope, which constrains what can be enforced in this stage (see the tier table).

**This is a deliberate re-target, not a neutrality task.** Profile output is *expected* to move toward the new empirical targets. Pass/fail is judged against the new derived targets — never against the pre-change baseline.

## Prerequisites — verify before touching anything

1. `data/nba/normalized/` exists and is populated with, at minimum, the shot-zone, shot-location/shot-event, play-type (Synergy), play-by-play, and advanced box datasets produced by the Stage 0 pipeline.
2. The Stage 0 data-validation script passes (check the actual npm script name in `package.json`; the intended name was `npm run validate-nba-data`).
3. Read the Stage 0 pipeline README (`pipeline/README.md`) and the normalized-contract schemas/readers on the TS side to learn the **actual** file names, shapes, and field names. Do not trust any contract names in this document over the real source.

**STOP CONDITION:** If the normalized data is missing, incomplete for the required datasets, or fails validation — stop and report exactly what is missing. Do not synthesize, stub, or hand-enter substitute data.

## The critical structural distinction: targets vs. base constants

Two things this task produces must never be conflated:

- **Empirical targets** — real-league values derived from the data (per-zone realized FG%, shot-mix shares, play-type frequencies, assisted rates, etc.). These live in the profile harness as the **pass/fail oracle for realized engine output**.
- **Base constants** — internal knobs like `BASE_FG_PCT_BY_ZONE`. These are the *pre-modifier* base in `resolveShot`; realized FG% = base + the average of the full modifier stack (contest, shooter/defender, play type, fatigue, form, spacing), **which does not average to zero** (the contest roll tables skew contested-or-worse, fatigue averages negative, play-type mods average slightly positive).

**Therefore: do NOT transcribe observed league FG% directly into `BASE_FG_PCT_BY_ZONE`.** Set the profile target to the observed value; tune the base constant until realized output lands on target. Annotate each base constant with: the empirical target, the source seasons and sample size, and a note that the base-vs-target offset absorbs the average modifier stack and is tuned via profile. The same logic applies to any constant whose realized output passes through modifiers.

## Step 0 — Capture a fresh pre-change reference profile

Recent work has moved the engine since the `BASE` table inside `scripts/profile-engine.ts` was captured. Before changing anything:

1. Run `npm run profile` on the **unmodified** engine and record the full output. Note the seed and game count; **all post-change profile runs in this task must use the same seed and game count.**
2. This capture is for **before/after delta reporting and diagnosing surprises only**. It is NOT a pass/fail oracle — pass/fail belongs exclusively to the new derived targets. Quote the capture in your final report.

## Step 1 — Target-derivation script (`scripts/derive-league-targets.ts`)

Create a new script, run via `tsx scripts/derive-league-targets.ts`, that reads the normalized pipeline files and emits every derived league value. Requirements:

- **Deterministic, no RNG.** Pure aggregation. Re-running on the same data must produce **byte-identical output** (stable key ordering, fixed float formatting) — same discipline as the Stage 0 normalize step.
- **Season range is an explicit CLI parameter** with a documented default of the **last 3 completed seasons**. Zone baselines and shot mix must come from the modern game only — mixing older eras drags the three-point environment backwards. Deeper history is available; the modern default is a design decision, not a limitation.
- **Every emitted value carries provenance:** season range, sample size (shot counts, possession counts), and source dataset.
- **Every aggregate documents its numerator, denominator, weighting, and units.** Percentages and rates are computed from **summed counts across the pooled sample** — never averaged across players or across seasons.
- **Heave exclusion (explicit rule, not a blanket time cut):** exclude an attempt from both per-zone FG% and shot-mix derivation iff it is in the NBA "Backcourt" zone, OR (`shotDistance >= <documented cutoff>` AND period time remaining `<= <documented window>`). Document both thresholds (e.g., ≥32 ft and ≤3 s) and the counts excluded. A blanket final-seconds exclusion is wrong — it removes legitimate late-clock layups and jumpers.
- **Tolerance bands are derived, not invented:** for each target, band = `max(maximum absolute deviation of any single season's value from the pooled multi-season target, documented floor)`. Bands with no data-driven basis must be annotated as judgment calls.
- **Committed artifacts:** the script itself plus a human-readable provenance report in a **git-tracked** location (e.g., `docs/`). `/data/` is gitignored — anything emitted there is untracked by design, so do not treat it as the provenance record. Derived numbers are then transcribed into `constants.ts` / `profile-engine.ts` as annotated constants; no hand-transcribed numbers without provenance annotations.

## Step 2 — Settle the zone mapping (the one real judgment call)

The engine has **six shot zones**: `rim`, `short_midrange`, `long_midrange`, `corner_three`, `above_break_three`, `deep_three`. NBA shot-location data does not map onto these one-to-one. Stage 0 preserved the raw NBA zone columns alongside its provisional mapping precisely so this stage could revisit it without a re-harvest.

Decide and document the full six-zone mapping. The known judgment calls:

- **Paint (Non-RA):** does it belong to `rim` or `short_midrange`? This choice directly sets both the rim and short-mid baselines. Use shot-distance data if the normalized layer preserves it; otherwise pick the mapping whose resulting baselines best match the engine's semantic intent (rim = at-the-basket finishes; short_midrange = floaters/short pull-ups) and document the reasoning.
- **`deep_three`:** the NBA has no such zone. Define it as a distance-based subset of above-the-break threes (document the cutoff, e.g. 27+ ft — note this must sit BELOW the heave-rule distance cutoff — and its post-heave-exclusion sample size; expect it to be small and note that in the annotation). If the normalized shot-location data cannot support a distance split at all, **stop and surface** — do not silently fold deep threes into `above_break_three` without flagging it as a design decision needing sign-off.
- **`short_midrange` vs `long_midrange`:** the NBA's single Mid-Range zone must be split, again by distance if available. Document the cutoff.

Write the settled mapping as a comment block above `BASE_FG_PCT_BY_ZONE` in `constants.ts` and in the derivation script.

## Step 3 — Per-zone FG% targets and shot-mix targets

- Derive real league **realized FG% per engine zone** (under the settled mapping, post heave exclusion) as **enforced profile targets**. Tune `BASE_FG_PCT_BY_ZONE` per the targets-vs-base-constants rule above — do not transcribe directly.
- Derive the real league **shot-mix distribution** (share of FGA per engine zone, post heave exclusion): both the **six-zone shares** and the three-bucket rim/mid/three shares the profile already tracks. Both are enforced — the six-zone mix has direct `constants.ts` mechanisms (`PLAY_TYPE_SHOT_ZONES`, spacing shot-mix coefficients).
- This is the highest-leverage change in the task and will move nearly every profile stat. That is expected — see the retune step.

## Step 4 — League play-type distribution (informational in Stage 1)

From the Synergy play-type data: league-wide frequency of the **eight harvested categories** mapped onto the engine's `PlayType` union: `isolation`, `pick_and_roll` (Synergy's ball-handler + roll-man combined; note the roll-man split as a Stage 3 target), `post_up`, `spot_up`, `transition`, `cut`, `off_screen`, `handoff`.

- **`putback` is NOT a Synergy target here.** Stage 0 does not harvest a putback category and `selectPlayType` cannot emit it. Putback frequency is PBP-derived and informational (Step 5).
- **Synergy's "Misc" bucket has no engine home.** Exclude it and **renormalize the remaining frequencies to sum to 1**, documenting Misc's excluded share. Do not silently drop it — that skews every other target.
- **Transition's canonical source is Synergy.** A PBP timing-based transition estimate (shot within N seconds of a defensive rebound / live-ball turnover) may be computed as a documented **cross-check only** — the two definitions disagree materially, and only one can be the target.
- **Measurement side:** the profile must measure the distribution of **terminal emitted `PlayByPlayEvent` types**, not what `selectPlayType` initially returns — the possession chain can replace the initial play type before the event is emitted (see `src/engine/possession.ts`). "Stats derive from the stream" applies to calibration measurement too.
- **This entire family is INFORMATIONAL in Stage 1**, fixed upfront (see tier table): the play-type selection and transition coefficients live hardcoded in `src/engine/play-types.ts`, which is outside this task's diff scope, so the engine has no in-scope knob to tune toward these targets. Stage 2 owns closing the gap. Log values, targets, and deltas.

## Step 5 — PBP-derived targets

**Assisted-shot rate by zone (informational, fixed upfront — see tier table):**

- **Exact derivation:** join the shot-event records to PBP on `(gameId, gameEventId) = (gameId, actionNumber)`. The **zone comes from the shot-event record** (under the settled Step 2 mapping); the **assisted/unassisted classification comes from PBP's AST attribution** on the made FG. Verify the exact field names against the normalized contracts.
- **Report join coverage** (fraction of made FGs successfully joined). **STOP CONDITION: coverage below 99.9%** — report the failure modes rather than deriving from a leaky join.
- **Bands stay empirically honest — no vague "headroom" widening.** The NBA scorekeeper's assist definition (credited through a dribble or two after the catch) is materially more liberal than the engine's strict pass-into-the-make chain, which is why this metric is informational rather than enforced: the semantic gap is known upfront. Annotate the gap. The enforced chain constraint remains **total assists per game** in the box stats.
- Diagnostic to log: **corner-three assisted rate should be the highest of any zone by a wide margin** in both real data and the engine — a sign-level chain sanity check even at informational tier.

**Other informational targets (Stage 3 grow-into list):** turnover-type mix, and-one rate, putback rate, offensive-rebound rate.

## Tier assignment — fixed BEFORE tuning, never outcome-based

Tier assignment happens **immediately after the Step 0 reference run and before any constant changes**, and does not move afterward. Promotion or demotion based on what the retune manages to hit is cherry-picking and is prohibited.

**ENFORCED (pass/fail):**
- All existing box-score profile stats (pace, pts, ppp, fga, fg%, 3pa, 3p%, fta, ft%, reb splits, ast, stl, blk, tov, margin).
- Realized FG% per engine zone (six zones).
- Shot-mix shares: six-zone AND three-bucket.

**INFORMATIONAL (logged, never fails):**
- Play-type distribution (mechanism hardcoded in `play-types.ts`, out of scope — Stage 2 owns it).
- Assisted-shot rate by zone (known semantic gap between NBA AST attribution and chain assists — Stage 2/3 own it).
- PBP transition cross-check.
- Turnover-type mix, and-one rate, putback rate, offensive-rebound rate (Stage 3 mechanisms).

Every informational entry carries an annotation naming the stage that owns closing its gap. If an **enforced** target proves unreachable during the retune, that is a **stop-and-surface**, not a demotion.

## The pool-artifact rule (binding on all tuning)

The profile simulates the **current player pool**, whose ratings and tendencies still come from the old BDL box-score heuristics in `derivation.ts`. Stage 2 replaces that derivation. **Never tune a constant outside its documented semantic plausibility to force the heuristic-derived pool onto a real-NBA target** (e.g., pass rates must remain in the neighborhood of real assisted-make rates; per-play-type shot-zone weights must remain recognizable as that play type's real shot profile). If an enforced target cannot be reached within semantically plausible constants, stop and surface — report the target, the gap, and what it would require.

## Step 6 — Restructure `scripts/profile-engine.ts`

- The derived empirical targets, with their derived tolerance bands, become the **single pass/fail oracle**. The stale hand-entered `REAL` table is replaced by the derived targets (with provenance annotations).
- **Retire the old `BASE` neutrality table.** Its job — per-change neutrality against a frozen snapshot — is now served by capturing a fresh pre-change profile per task (the current working practice). Do not leave a stale dual-oracle in the script.
- Implement the two tiers exactly as fixed in the tier table above. The script must print, per enforced stat: engine value, target, delta, tolerance, pass/fail flag. Informational stats print the same, minus the flag, plus their owning-stage annotation.
- Play-type distribution is measured from **terminal emitted event types in the play-by-play stream** (per Step 4), and six-zone shot shares from the emitted shot events' zones.
- Preserve determinism: same seed → identical output.

## Step 7 — Retune to the new targets (constants.ts knobs only)

Once targets change, existing knobs will be off. This is a normal `constants.ts` tuning pass under the standard rules — additive, clamped, tuned via profile. **Only `constants.ts`-resident knobs are tunable**; anything hardcoded elsewhere (notably `play-types.ts`) is off-limits. Tune in this order, not whack-a-mole:

1. `BASE_FG_PCT_BY_ZONE` first, until realized per-zone FG% lands on target — accept the full profile shift this causes.
2. Then the six-zone shot mix via `PLAY_TYPE_SHOT_ZONES` (subject to the pool-artifact rule: each play type's zone profile must remain recognizable as that play type) and, if needed, light touch-up of the spacing shot-mix coefficients — verified against the spacing A/B check.
3. Then chain knobs (`PLAY_TYPE_PASS_RATE`, advantage-bonus constants) toward the enforced **total assists** and turnover box stats.

**Known diagnostic:** if turnover rates come out implausibly high after touching chain-adjacent knobs, the **shot-quality advantage bonus is mis-tuned** — do not "fix" turnover frequency directly.

**Do NOT re-derive the spacing/versatility centering baselines** (`SPACING_BASELINE_OFFBALL_FOUR`, `SPACING_SPREAD`, `VERSATILITY_BASELINE`, `VERSATILITY_SPREAD`). They are pool-derived, and the pool does not change in this task.

**Jensen's inequality caveat:** centered or re-centered inputs do not guarantee the aggregate lands where arithmetic says, given nonlinear shot-mix shifts and clamping. The profile run is the only proof a retune is done; never argue completion from centering.

## Verification (acceptance checklist — all required)

1. `npm run typecheck` (or the project's typecheck command — verify in `package.json`) clean.
2. Determinism scripts under `scripts/` pass (same seed → identical results), and `derive-league-targets.ts` is byte-identical on re-run.
3. `npm run profile` **green on all enforced targets** under the new derived bands, with before/after deltas reported against the Step 0 capture (same seed and game count).
4. Informational targets logged with values, targets, deltas, and owning-stage annotations.
5. Assisted-rate join coverage reported and ≥ 99.9%.
6. `npm run calibrate` run. New modern targets may worsen historical-era fits — that is acceptable and must be **explicitly noted in the report**, not silently retuned away.
7. The spacing A/B test (`tsx scripts/...` — locate the actual script, likely `calibrate-spacing.ts` or an A/B variant) still shows a **material, correctly-signed** spacing effect.
8. **Diff audit:** zero changes outside (a) `src/engine/constants.ts`, (b) `scripts/derive-league-targets.ts` (new), (c) `scripts/profile-engine.ts`, (d) the committed provenance report, and (e) docs — docs only after all calibration above is verified. `src/engine/play-types.ts` and all other engine logic are explicitly untouchable. If you find yourself needing to touch engine logic, derivation, models, or saves, **stop and surface why** instead of doing it.

## Documentation (last, only after calibration verified)

- `README.md`: note the empirical target derivation and the `derive-league-targets` script under the scripts section.
- `AGENTS.md`: add that league calibration targets are derived from `data/nba/normalized/` via `scripts/derive-league-targets.ts` with provenance annotations and must be re-derived (not hand-edited) when data changes; that `BASE_FG_PCT_BY_ZONE` values are tuned knobs annotated against empirical targets, not direct transcriptions; and that profile tier assignments are fixed per-task before tuning, never outcome-based.

## Stop-and-surface conditions (report and halt instead of improvising)

1. Normalized data missing, incomplete, or failing validation.
2. Any normalized contract shape/field mismatch versus what this document assumes — resolve against the real files; if the required data genuinely isn't in the contracts, stop.
3. The shot-location data cannot support the distance splits needed for `deep_three`, the short/long midrange boundary, or the heave-rule distance cutoff.
4. Assisted-rate join coverage below 99.9%.
5. An **enforced** target proves unreachable within semantically plausible `constants.ts` values — report the target, the gap, and the mechanism or data it would require. Do not demote it, and do not warp constants.
6. Historical (`calibrate`) drift so large it suggests the derivation itself is wrong (e.g., a zone target off by >5 percentage points from any plausible league value).

## Out of scope — do NOT do any of the following

- No edits to `src/engine/play-types.ts` or any other hardcoded engine coefficients — `constants.ts` is the only tunable surface.
- No changes to ratings derivation (`derivation.ts` or related) — that is Stage 2.
- No per-player anything. League-level aggregates only.
- No new engine mechanics (roll-man role, catch-and-shoot vs pull-up, contested rebounds) — Stage 3.
- No changes to the Python pipeline beyond reading its output. If the pipeline output is wrong, that's a stop-and-surface, not a pipeline patch.
- No touching the BDL ingest path (`npm run ingest`) or `npm run seed` — they remain untouched through Stage 1.
- No re-deriving spacing/versatility pool baselines.
- No save/schema changes, no migrations.
- No "fixing" the `addXStats` no-op stubs.

USE SUBAGENT THAT IS AN EXPERT IN THE NBA TO CROSSCHECK THE NBA LOGIC

Work in small, reviewable increments: fresh reference capture → tier assignment → derivation script → zone-mapping decision → target/constant transcription → profile restructure → retune → verification → docs.