# S3.b1 — defender assignment fidelity

Implement S3.b1: use normalized opponent-position matchup evidence to sharpen `selectDefender` and nothing else.

This is the first engine-touching S3 unit. It changes which on-court defender is assigned to the shooter; it does not change the defender's zone strength, contest distribution, foul logic, steal pressure, ratings derivation, or persisted data.

## Step −1 — Preflight: prompt archival and base branch

1. This finalized prompt is committed as `docs/prompts/S3B1_DEFENDER_ASSIGNMENT_IMPLEMENTATION_PROMPT.md` (replacing the prior archived draft) **before** execution, per the repository's prompt-archival policy.
2. Implementation begins from a clean, up-to-date `main` containing the accepted S3.a commit. Verify `main` is synced with `origin/main` first.
3. **STOP** if the working tree is dirty, if `main` is behind `origin/main`, if this prompt is not committed under `docs/prompts/`, or if `docs/PROJECT_STATUS.md` does not record S3.a acceptance with hashes.

## Read first

- `AGENTS.md`
- `CLAUDE.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md` §3.2, §3.3, §4.3, §9, Appendix A/B
- `docs/S3_LINEUP_VALIDATION.md`
- `docs/prompts/S3A_LINEUP_VALIDATION_IMPLEMENTATION_PROMPT.md`
- `src/data/nba/types.ts` (`DefenseRow`, `MatchupPositionBucket`, `matchupsByOppPosition`)
- `src/data/nba/load.ts`
- `pipeline/normalize.py` — the matchup aggregation block and the players-contract position derivation, to understand provenance (do **not** edit pipeline code)
- `scripts/build-league.ts` — the primary/secondary position token mapping the runtime pool actually carries
- `src/engine/play-types.ts` (`selectDefender` and every call site)
- `src/engine/spacing.ts` (`computeVersatility`)
- the versatility/mismatch constants in `src/engine/constants.ts` (`VERSATILITY_HUNT_COEF` and neighbors)
- `src/lib/rng.ts` (`weightedChoice` — note it does not validate its weights)
- `scripts/test-defense-ab.ts` — including its header comment; its contract under the new mechanism is defined below
- `scripts/validate-lineups.ts`
- `pipeline/manifests/default.json` (per-contract season windows)

Do not edit Next.js, save, franchise, transaction, or pipeline-normalization code.

## Preconditions

1. Start from clean `main` with S3.a accepted and `validate-lineups --check` green. Do not run this concurrently with another S3/F engine branch.
2. Confirm normalized defense coverage is present and `manifest.json` is complete. Do not re-harvest.
3. Reproduce the current PROJECT_STATUS profile/calibrate hashes and capture new preflight files outside the repo (`npm run profile --silent`, `npm run calibrate --silent`, SHA-256, activation-context banner).
4. Record the current `selectDefender` assignment distribution using a fixed synthetic lineup matrix before editing (fixed seed; committed nowhere — preflight evidence only).
5. Run typecheck, profile, calibrate, determinism, spacing A/B, defense A/B, build-league check, and lineup validation before edits.

Stop if S3.a is absent, its report is stale, normalized matchup coverage is missing, or the baseline profile is not 32/32.

## Goal

Derive an empirical position-matchup **lift** matrix from `DefenseRow.matchupsByOppPosition[*].partialPoss`, then express that evidence through one centered defender-selection weighting model using only existing runtime inputs:

- defender primary/secondary position (engine positions);
- shooter primary position (engine position, mapped to a coarse NBA bucket for lookup — see locked design);
- defender perimeter/interior defense and defensive IQ;
- play type;
- centered lineup versatility / mismatch-hunt state.

The normalized data informs committed constants and derivation provenance; production simulation never reads the normalized files.

## Locked design

### Measurement/derivation

Create deterministic `scripts/derive-s3b1-matchups.ts`. The following are decided, not open:

1. **Matrix orientation.** Rows are the **defender's engine position** (`PG`/`SG`/`SF`/`PF`/`C`), joined from the normalized players contract by `personId` — the same position field S2b derivation consumes. Source columns are the NBA opponent buckets exactly as they appear in the data (`G`, `G-F`, `F-G`, `F`, `F-C`, `C-F`, `C`). Never split a coarse or composite bucket's partial possessions across engine positions — that apportionment has no data support.
2. **Runtime table shape: 5×3 coarse, by the production-derived rule.** Mechanically aggregate every source bucket into `G`/`F`/`C` using the rule production itself implies — the composition of the builder's raw-token→engine-position mapping with the runtime engine-position→bucket lookup — **not** a naive first-token rule:

   ```text
   G, G-F              → G
   F-G, F, F-C, C-F    → F
   C                   → C
   ```

   The load-bearing case is `C-F`: production maps raw `C-F → PF` and runtime maps `PF → F`, so `C-F` belongs to `F` (a first-token `C-F → C` rule would misfile ~4–5% of matchup partial possessions and break the shared derived vocabulary). Do not hardcode this table independently: the derivation must either consume a shared position-mapping seam exported from the builder/runtime, or mechanically assert its aggregation equals the composition of the two production mappings, stopping on mismatch. The runtime table has five rows and three columns; no derived column is unreachable at runtime. Report the full 5×7 raw partial-possession matrix as evidence alongside the aggregated table, with the aggregation rule and its verification stated. (The engine's secondary-position vocabulary is `{PG, SF, C}` only, so an exact-composite runtime table was considered and rejected: almost no engine primary/secondary pair maps unambiguously to an observed composite bucket. Record this as a settled decision.)
3. **Runtime quantity: supply-adjusted lift, not column shares.** Raw column shares `P(dPos | B)` embed the league's defender-position supply; applying them per on-court defender counts that supply twice, and duplicate-position lineups compound it. The runtime matrix is:

   ```text
   lift[dPos][B] = P(dPos | B) / P(dPos)
   ```

   where `P(dPos | B)` is the possession-weighted share of bucket B's coverage provided by position `dPos`, and `P(dPos)` is that position's share of **all** matchup partial possessions (same window, same exclusions). Lift is centered at 1 under independence. It is a **supply-adjusted matchup association used as a conditional-choice proxy** among the defenders actually available — without observed on-court alternatives it cannot identify the true conditional assignment model, and the derivation report states that scope honestly. Report raw partials, column shares, the position marginal, and the lift table; only the lift table becomes committed runtime constants. Include the mechanical consistency check `Σ_B P(B) · lift[dPos][B] = 1` per row (within rounding tolerance).
4. **Weighting.** Possession-weight by `partialPoss` only. Never average player-level percentages equally. Do not read `matchupFgPct`, `playerPts`, or any made/attempt field — S3.b2 owns defender influence.
5. **`UNK` handling.** Exclude `UNK` from the matrix, the marginal, and the lift computation consistently. Report its total partial possessions and share.
6. **Season window — verify, don't assume.** The matchup sub-data comes from a separate raw file than the defended categories and begins later than the defense contract's 2013-14 window (expected 2017-18 through 2024-25, with near-complete rostered-defender coverage). Determine the actual window mechanically: include a season only if its normalized defense file has non-empty `matchupsByOppPosition` coverage for at least a declared minimum share of rostered defenders (declare the threshold in the script before fitting; report per-season coverage). Exclude the in-progress build season (2025-26), consistent with S3.a's convention. If the discovered window differs materially from the expected pattern, report it; if it is empty or a single season, stop and surface.
7. **Provenance limitations, stated up front — both axes.** `pipeline/normalize.py` assigns **opponent** buckets from the current static bio index, and the seasonal players contract derives **defender** positions from the same present-day source — so both matrix axes carry present-day listed positions applied retroactively to historical players. Additionally, lift corrects for position *supply* but not for the builder's coarse token mapping (generic `G → PG`, `F → SF`): the matrix measures matchup propensity **within the derived-position vocabulary the runtime pool itself uses**, which is internally consistent, not a claim about true NBA positional identity. Both limitations go in the derivation report as documented context, not defects to fix in this unit.
8. **Named report artifact.** The derivation writes `docs/S3B1_MATCHUP_DERIVATION.md` — measurements, coverage, formulas, consistency checks, and provenance only, no interpretive status. Register it as a generated artifact per the CLAUDE.md / ROADMAP Appendix B convention. `--check` re-derives and byte-compares **both** the committed constant block and the committed report.
9. **Determinism.** Fixed iteration order (sort by `personId`/season), deterministic rounding, derivation before any gameplay tuning.

### Runtime selection

Replace the current stack — conditional mismatch coin flip, first-positional-match accept roll, fallback quality weighting (which today consumes **one to three** RNG draws depending on branch) — with **one auditable weight per defender and exactly one unconditional `rng.weightedChoice` draw per `selectDefender` call**.

Locked weight model (coefficients tunable; formulas, centering, and clamp order are not):

```text
avgDef(d)     = (perimeterDefense + interiorDefense + defensiveIQ) / 3
weakness(d)   = (40 - avgDef(d)) / 40   // signed, 40-centered — no zero clip

posTerm(d)    = max(lift[dPos][B], S3B1_SECONDARY_POS_FACTOR × lift[dSecPos][B])   // when d has a secondary position, else lift[dPos][B]
qualTerm(d)   = clamp(1 + S3B1_QUALITY_COEF × (avgDef(d) - 40) / 40, QUAL_MIN, QUAL_MAX)
huntStrength  = clamp(S3B1_HUNT_BASE - VERSATILITY_HUNT_COEF × versatilityZ, HUNT_MIN, HUNT_MAX)   // isolation/post_up only
huntTerm(d)   = clamp(1 + huntStrength × weakness(d), HUNT_TERM_MIN, HUNT_TERM_MAX)                // 1 on all other play types

rawWeight(d)   = posTerm(d) × qualTerm(d) × huntTerm(d)
finalWeight(d) = max(rawWeight(d), S3B1_DEFENDER_MIN_WEIGHT × max_over_on_court(rawWeight))
```

1. **Shooter bucket.** Map the shooter's **primary engine position** to `G`/`F`/`C` (`PG`/`SG → G`, `SF`/`PF → F`, `C → C`). The shooter's secondary position is deliberately unused — document this as settled.
2. **One shared defensive average.** `avgDef` above (three ratings) is shared by `qualTerm` and `huntTerm`. Note in the PR that this deliberately unifies the current code's two different averages (three-rating hunt inversion vs two-rating fallback quality); there is no single existing average to preserve.
3. **Quality direction.** Centered at rating 40 with `qualTerm = 1` exactly for a 40-rated defender; preserves the current direction (better defenders draw assignments slightly more), small and tunable.
4. **Weak-link story preserved — relatively, not just below 40.** `weakness` is deliberately **signed**: on isolation/post-up it penalizes strong defenders (`huntTerm < 1`) and boosts weak ones (`huntTerm > 1`), so hunting remains a relative weak-link effect even when the entire lineup sits above (or below) rating 40 — a zero-clipped weakness would silently disable hunting in above-40 lineups and let `qualTerm` route isolations to the *best* defender. The positive `HUNT_TERM_MIN` clamp keeps every weight safe. Four studs and one sieve still get hunted; a switchable (high-floor) lineup suppresses the hunt through centered versatility; at versatility z = 0 the base hunt strength applies unchanged. The matchup data has no play-type split, so the lift matrix is play-type-independent; play type enters **only** through `huntTerm`. Do not invent transition or putback cross-matching behavior in this unit.
5. **Floor semantics.** The floor is relative to the **maximum raw weight among the on-court five** and applies to final weights, as written above. No on-court defender is unreachable by construction; if the lift matrix plus the named floor still leave a defender's selection probability near zero in some configuration, report it.
6. **Signature and call sites.** Make the `playType` parameter **required** (drop the `= 'isolation'` default) and audit every call site so each passes the live play type explicitly.
7. **Auditable weights.** Export a pure, RNG-free `explainDefenderSelection(...)` (mirroring the `explainPlayTypeSelection` / `explainShotZoneSelection` precedent) returning each on-court defender's `posTerm`/`qualTerm`/`huntTerm`/`rawWeight`/`finalWeight`, and have `selectDefender` consume it so production and diagnostics cannot drift.
8. **Ordering.** Weights are computed and drawn in the existing on-court lineup order only; never use object-key enumeration or player IDs as behavioral tie-breakers.
9. **Constants.** Every coefficient, clamp, floor, and the lift matrix live in `engine/constants.ts` with units, source, derivation window, and sane range annotations.

Do not change `resolveShot`, `getDefenderRating`, `determineContestLevel`, `checkTurnover`, `computeVersatility`, or player ratings/tendencies.

### `test-defense-ab.ts` contract under the new mechanism

- The all-defenders-at-`C`-vs-PG-shooter fixture **still neutralizes the position term**: with all five defenders at the same position, `posTerm` is uniform within the on-court five and cancels under weight normalization. Do not rewrite the fixtures on the assumption that it doesn't.
- The current hunt assertion computes a hunt **probability** from the retired branch formula (`0.45 − VERSATILITY_HUNT_COEF × z`) and compares gaps against `HUNT_GAP`. That formula no longer exists in production, so keeping the assertion would test a retired mechanism. **Authorized surgical edit, and only this:** replace the hunt-probability assertion with a behavioral measurement on production `selectDefender` output — `softTargetRate(studsSieve) − softTargetRate(switchable) ≥ S3B1_AB_SUPPRESSION_GAP` — with the threshold **predeclared and frozen before any tuning** and recorded in the PR. Every other assertion (`Z_GAP`, `RIM_GAP`, soft-target ordering, versatility ordering) keeps its current threshold and must go green without edits. Any further fixture change requires the measurement to be provably ill-defined under the new mechanism, preserves every named property, and is reported with its reason.

## Focused harness

Create `scripts/test-s3b1-defender-assignment.ts` proving on fixed inputs:

1. Exactly one RNG draw per `selectDefender` call, on every play type and weight configuration (fixed draw contract).
2. Weight validity, inspected **directly via `explainDefenderSelection`**, not sampling: every `finalWeight` finite, nonnegative, and ≥ the floor times the on-court max; total weight strictly positive. (`weightedChoice` does not validate its inputs.)
3. On a synthetic positionally balanced lineup (one player per position, all ratings 40, no secondary positions, neutral play type), the computed selection probabilities equal the lift-derived probabilities `lift[dPos][B] / Σ lift` for each shooter bucket, within a declared tolerance — **not** the supply-skewed column shares.
4. Guards/wings/bigs match the derived lift direction across a large fixed-seed sample.
5. Composite/secondary defender positions behave per the locked max-blend convention; the shooter's secondary position is provably unused.
6. Isolation/post-up hunt the weak link more than neutral play types (via computed `huntTerm` and sampled distributions).
7. A switchable lineup suppresses hunting relative to a studs-plus-sieve lineup with comparable mean defense.
8. **Above-40 relative weak link:** in a lineup whose every defender is above 40 (e.g., 45/60/65/70/75), isolation/post-up still shift selection toward the relatively weakest defender versus the neutral-play-type distribution — proven from computed `huntTerm` values and a sampled distribution gap.
9. Reachability proven mathematically from computed weights (the floor guarantees a positive probability for every on-court defender), not by sampling for rare events.
10. Output is identical on repeat.

Sampled comparisons operate on distributions, not individual selections.

## Hard out of scope

- No zone-specific defender blend — that is S3.b2.
- No contest, deflection, steal, block, foul, rebound, drive, touch, screener, or assist changes.
- No rating/tendency derivation change.
- No new `Player`, `PlayByPlayEvent`, or save field.
- No new RNG branch, no conditional draw site, no runtime data mode.
- No target/tolerance edits or base-shot retune; no `test-defense-ab.ts` edits beyond the single authorized assertion replacement.
- No transition/putback matchup semantics beyond the existing (non-hunting) treatment.
- No pipeline/normalize edits; the static-bio-index position limitations (both axes) are documented, not repaired.

## Stop and surface

Stop if:

- the discovered matchup season window is empty, a single season, or the coverage threshold cannot be met without lowering it after seeing results;
- the defender-position join against the players contract fails for a material share of matchup rows;
- any lift cell would be computed from a position marginal or bucket total too small to be meaningful under a declared minimum-sample rule;
- a fixed one-draw contract cannot be achieved without violating engine invariants;
- the profile can pass only by editing unrelated shot/turnover/foul constants;
- `test-defense-ab.ts` can pass only through edits beyond the single authorized assertion replacement;
- S3.a's frozen lineup score regresses beyond its declared tolerance (near-vacuous for this unit since `spacing.ts` and its constants are untouched, but the gate stays);
- the change requires per-player raw matchup fields at runtime.

## Verification

```sh
npm run typecheck
npm run validate-nba-data
node --import tsx scripts/build-league.ts --check
node --import tsx scripts/derive-s3b1-matchups.ts --check
node --import tsx scripts/test-s3b1-defender-assignment.ts
node --import tsx scripts/validate-lineups.ts --check
npm run profile
npm run profile --silent > /tmp/s3b1-post-profile.out
npm run calibrate
npm run calibrate --silent > /tmp/s3b1-post-calibrate.out
node --import tsx scripts/test-determinism.ts
node --import tsx scripts/test-spacing-ab.ts
node --import tsx scripts/test-defense-ab.ts
```

Acceptance requires:

- profile PASS 32/32 on the activated pool with the activation-context banner verified;
- the fixed one-draw contract and weight validity proven; same-seed determinism green;
- correctly signed lift and mismatch distributions per the focused harness;
- `test-defense-ab.ts` green with only the authorized assertion replacement, its new threshold frozen pre-tuning;
- `docs/S3B1_MATCHUP_DERIVATION.md` and the committed constants byte-verified by `--check`;
- no lineup-score regression;
- explained pre/post profile and calibrate deltas (calibrate remains a drift report, not acceptance);
- SHA-256 of pre/post `--silent` captures recorded.

Update `docs/PROJECT_STATUS.md` in the implementation branch with the implementation commit/PR, verification evidence, stdout hashes, and next unit **S3.b2**; record the merge commit in the standard post-merge status update (an implementation commit cannot contain its own future merge SHA). Write any divergence from this prompt back into `docs/ROADMAP.md` §4.3 in the same diff. The derivation report remains measurements-and-provenance only; interpretation lives in the handwritten docs. Do not implement S3.b2 in this branch.
