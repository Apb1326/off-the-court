# S3.b2 — zone-specific defender influence

Implement the authorized partial S3.b2: use normalized defended-category FG%± evidence to derive how the existing perimeter and interior defensive ratings blend at the rim, short midrange, and the shared 3PT band, while preserving long-midrange's accepted perimeter-only behavior as an explicit legacy fallback.

This unit changes only the defender-rating term already consumed by `resolveShot`. Defender assignment is inherited unchanged from accepted S3.b1. Do not add a second defense modifier.

## Read first

- `AGENTS.md`, `CLAUDE.md`, `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md` §3.2, §3.3, §4.3, §9, Appendix A/B
- `docs/S3_LINEUP_VALIDATION.md`
- the accepted S3.b1 derivation/report and `scripts/test-s3b1-defender-assignment.ts`
- `src/data/nba/types.ts` (`DefendedCategoryLine`)
- `pipeline/normalize.py` (`DEFEND_CATEGORY_KEYS` — the authoritative category list)
- `src/engine/shot.ts`
- `src/engine/constants.ts`
- `src/engine/fatigue.ts` (`getEffectiveRating`)
- `src/ratings/nba-derivation.ts` defense inputs and the season-as-of derivation seam used by `scripts/validate-lineups.ts`, to document circularity and construct historical predictors precisely
- `scripts/profile-engine.ts`, `scripts/test-defense-ab.ts`, and `scripts/validate-lineups.ts`

## Preconditions

1. Start from a clean working tree on `main` with S3.b1 accepted. Reproduce S3.b1's focused harness and the current profile/calibrate hashes from `docs/PROJECT_STATUS.md`.
2. Confirm normalized defended categories and finite `dFga` / `dFgm` / `dFgPct` / `normalFgPct` coverage. Do not repair raw or normalized data in this unit.
3. Capture preflight outside the repo: profile, calibrate, build-league check, determinism, both A/Bs, the S3.b1 harness, and lineup validation. Capture deterministic stdout separately and record its SHA-256; do not place preflight artifacts in the working tree.
4. Confirm the live `getDefenderRating` uses interior defense at the rim and perimeter defense in all five other zones. If the source has already changed, stop and reconcile the prompt with the roadmap.
5. Confirm by grep that `getDefenderRating` is consumed only by the defender-modifier term in `resolveShot`. If another call site exists, stop and surface before changing behavior.
6. Confirm the defended-category set is exactly the six keys in `DEFEND_CATEGORY_KEYS`: `overall`, `threePointers`, `twoPointers`, `lessThan6Ft`, `lessThan10Ft`, `greaterThan15Ft`. Do not invent additional categories.
7. Use completed normalized defense seasons `2013-14` through `2024-25`, inclusive. The live manifest also contains `2025-26`, but the accepted project artifacts classify it as in-progress; exclude it in this unit. If that classification has changed, stop and reconcile the manifest, `docs/S3_LINEUP_VALIDATION.md`, and the roadmap before changing the fitting window.

## Authorized partial decision (locked 2026-07-21)

A read-only diagnostic applied the derivation contract below before runtime implementation. Its deterministic stdout SHA-256 was `c147250bf80c745f700947f92f1585643d8d2cae6ea0fb00269cdd7b47cc448d`.

The unchanged player-clustered 95% confidence gate identified publishable full-window weights for `<6ft` ≈ rim, `6–10ft` ≈ short midrange, and the shared 3PT band. It did **not** identify long two: the unprojected joint slope-sum confidence interval included zero in the full window and both predeclared sensitivities (full **−0.0028 to 0.0512**, early **−0.0093 to 0.0561**, late **−0.0147 to 0.0641** defended-FG percentage points per rating point).

Therefore this execution unit is authorized only as a partial derivation:

- derive and publish the rim, short-midrange, and shared-3PT weights from the predeclared full window;
- preserve `long_midrange`'s accepted perimeter-only runtime behavior with `interiorWeight = 0`;
- label that long-midrange value everywhere as a **legacy fallback**, never as a derived weight or an identified long-two result;
- continue fitting and reporting long two as measurement evidence, but do not convert its coefficients into a runtime weight;
- keep `2013-14` through `2024-25` as the primary fit. The diagnostic short-midrange full-window interior weight is approximately **0.590**; its early **0.738** and late **0.461** values are sensitivity evidence that must be disclosed, not alternate runtime modes or a basis for selecting a preferred window.

This decision does not change the confidence level, projection rule, regression specification, or any finite-sample filter. It changes only the phase response to one band that failed the unchanged gate: preserve the already-accepted behavior instead of claiming or publishing an unstable ratio. If the implementation generator does not reproduce the recorded diagnostic measurements within its declared deterministic numerical precision, stop and surface the mismatch.

## Goal

Derive a centered per-zone blend:

```text
defenderRating(zone) = perimeterDefense * (1 - interiorWeight[zone])
                     + interiorDefense  * interiorWeight[zone]
```

Store only `interiorWeight`. Use three derived source constants — rim, 6–10ft, and shared 3PT — plus one separately named long-midrange legacy-fallback constant fixed at `0`, then compose the six-zone lookup from those four sources. The `corner_three`, `above_break_three`, and `deep_three` entries must all reference the same shared 3PT constant rather than repeat independently authored numbers. Clamp every derived weight to `[0, 1]`; complementary perimeter weight is always `1 - interiorWeight`, so the weights sum to 1 by construction. Never place the long-midrange fallback in a list or comment that calls all four values derived.

The blended rating replaces the existing defender-rating lookup; it does not create an additional additive penalty.

Evaluation order in `resolveShot` is fixed: blend the raw ratings first, apply `getEffectiveRating` to the blended rating exactly once, then call `ratingToModifier`. This ordering makes the degenerate weights `{rim: interiorWeight = 1, all other zones: interiorWeight = 0}` reproduce the existing defender term exactly.

## Identifiability constraints (locked)

The six categories cannot distinguish the engine's three 3-point zones. All of `corner_three`, `above_break_three`, and `deep_three` share one derived 3PT blend. Do not invent per-zone 3PT differences.

The disjoint evidence bands fitted and reported are:

- `<6ft` (direct);
- `6–10ft` = `lessThan10Ft` minus `lessThan6Ft`;
- long-two = `greaterThan15Ft` minus `threePointers`, subject to the composition check below and retained as non-publishing measurement evidence under the authorized partial decision;
- `threePointers` (direct).

Before using a differenced band, empirically verify category composition against the data. Check whether `greaterThan15Ft` includes threes using `dFga` and `freq` accounting identities per player-season and at league aggregate. State the numerical tolerances used for stored-frequency rounding. Document the verified composition in the generated report; do not assume either reading. If the composition cannot be resolved, stop.

For a direct band, use its stored values. For a differenced band `outer - inner`, reconstruct counts and expected makes; never subtract percentages directly:

```text
bandFga           = outer.dFga - inner.dFga
bandDefendedMakes = outer.dFgm - inner.dFgm
bandNormalMakes   = outer.dFga * outer.normalFgPct
                  - inner.dFga * inner.normalFgPct

bandDFgPct        = bandDefendedMakes / bandFga
bandNormalFgPct   = bandNormalMakes / bandFga
bandDefendedDelta = bandNormalFgPct - bandDFgPct
```

Require positive finite `bandFga`, finite non-negative derived makes, and derived percentages in `[0, 1]`. Drop and separately count rows failing each condition. Also report negative-attempt, zero-attempt, non-finite-input, invalid-derived-makes, and invalid-derived-percentage drops for every differenced band. Use exact `dFgm` differences for defended makes so stored `dFgPct` rounding is not compounded.

State the band→zone mapping honestly as approximate: `pt_defend` bands are radial distance, while engine zones follow `shot_zones` semantics. `<6ft` ≈ `rim` and `6–10ft` ≈ `short_midrange` are documented approximations, not identities; the engine's `rim` is restricted area only, and paint-non-RA belongs to `short_midrange`.

## Historical rating predictors (locked)

Each regression observation is one player-season defended-band row.

For season `S`, construct that player's `perimeterDefense` and `interiorDefense` season-as-of `S` through the same shared historical NBA derivation path used by `scripts/validate-lineups.ts`:

- re-key recency weights and the full-window anchor to `S`;
- load no input row after `S`;
- use the exact player population eligible for the season-as-of derivation as the standardization pool;
- join the defended row and derived ratings by `personId`;
- retain the runtime 1–80 rating scale and center predictors as `rating - 40`;
- report player-season eligibility, join coverage, fallback usage, and every exclusion by season and band.

Do not join historical outcomes to the static active-player pool or reuse one present-day rating across all seasons. Do not derive ratings with future-season leakage. Repeated seasons for one player are repeated observations, not independent players; the uncertainty calculation below must cluster by `personId`.

## Derivation contract

Create deterministic `scripts/derive-s3b2-defender-influence.ts` that:

- hardcodes and reports the completed fitting window `2013-14` through `2024-25` and declares all finite-sample filters before fitting;
- uses attempt-weighted (`bandFga`) evidence, never unweighted player averages;
- pins the sign convention once: defended delta = `normalFgPct - dFgPct`, positive = the defender suppresses FG% (matching `nba-derivation.ts`); `pctPlusMinus`, when used only as a diagnostic, has the opposite sign and must be negated;
- fits, per disjoint band, an attempt-weighted linear regression with an intercept of defended delta on centered `perimeterDefense` and `interiorDefense` jointly;
- reports the intercept and both joint slopes in defended-FG-probability points per rating point;
- converts joint slopes to `interiorWeight = interiorCoefficient / (interiorCoefficient + perimeterCoefficient)` after projecting slopes onto the non-negative orthant: clamp a negative slope to 0 and report the original and clamped values; if both slopes are non-positive, stop and surface;
- reports the unclamped slope sum and its uncertainty; if the slope sum is non-positive or its player-clustered 95% confidence interval includes zero, that band fails the unchanged publication gate and no derived ratio may be emitted for it;
- reports the attempt-weighted cross-player correlation between `perimeterDefense` and `interiorDefense` in each fitting pool, deduplicating a player's rating pair within a season before calculating it;
- defines the marginal-vs-joint sensitivity as two separate one-predictor WLS models, each using the same observations, intercept, and `bandFga` weights as the joint model, and reports the weight implied by those two marginal slopes beside the joint result;
- uses player-clustered (`personId`) sandwich uncertainty for the primary fit;
- reports predeclared window sensitivities for `2013-14`–`2018-19` and `2019-20`–`2024-25`, plus leave-one-season-out ranges, using the same construction and filters as the primary fit;
- reports coverage, coefficients, effective attempt totals, uncertainty, sensitivity, and all differencing-drop counts for every band;
- writes a generated measurements/provenance report to `docs/S3B2_DEFENDER_INFLUENCE.md`;
- writes the three named derived source constants, the separately named `long_midrange` legacy-fallback constant fixed at `0`, and the six-zone lookup inside a marked generated block in `src/engine/constants.ts`; provenance and comments must distinguish the fallback from derived values;
- supports deterministic `--check` that recomputes and byte-compares both the generated report and the generated constants block;
- updates `CLAUDE.md`'s generated-doc map and the roadmap's artifact ownership table for the new report/generator.

The predeclared full-window primary coefficients determine the three committed derived weights. Sensitivity results are diagnostics, not alternate runtime modes. In particular, disclose the short-midrange movement from approximately `0.738` early to `0.461` late beside the approximately `0.590` full-window primary result; do not average windows differently or select a favorable window after seeing results. Long two remains measured but supplies no committed weight. If the rim or shared-3PT structural prior reverses in either predeclared half-window or in the full window, apply the stop condition below.

## Circularity disclosure (required, specific)

The generated report must state the complete S2b rating formulas relevant here:

- `perimeterDefense` is `0.70 × standardized(threePointers defended delta) - 0.30 × standardized(guard matchup FG%)`;
- `interiorDefense` is `0.70 × standardized(lessThan6Ft defended delta) - 0.30 × standardized(center matchup FG%)`.

Therefore the rim and 3PT fits partly recover S2b's own construction; their orderings are expected partly by echo and are not independent confirmation. The 6–10ft and long-two bands carry the genuinely new defended-category information in this unit, although they remain observational and share the same derived rating predictors. Only 6–10ft cleared the publication gate; long two did not, and the generated measurements must not imply otherwise. S3.b2 calibrates the runtime mapping of existing ratings to zones; it is not an independent causal estimate of defense.

## Runtime implementation

- Make the smallest pure defender-blend/helper seam testable; export `getDefenderRating` only if the focused harness genuinely needs it.
- Blend raw ratings → `getEffectiveRating` once → `ratingToModifier`, in that locked order.
- Map `long_midrange` to the named legacy fallback `interiorWeight = 0`, preserving its existing perimeter-only behavior exactly; do not route the failed long-two ratio through projection and call the resulting zero a derived weight.
- Preserve `ratingToModifier` and the single additive defender term inside the existing shot-probability clamp.
- Do not alter contest level, block chance, foul chance, shooter ratings, form, momentum, advantage, rush, effort, or base zone percentages.
- Add no RNG and preserve the existing draw count and order in `resolveShot` exactly.
- Do not add a mutable weight override, environment switch, runtime mode, or test-only configuration seam to production entry points.

## Expected calibration behavior

A raw 40/40 defender has modifier zero in every zone at zero fatigue. At nonzero fatigue, the existing `getEffectiveRating` behavior still applies and may move the effective rating below 40; do not special-case that behavior.

League-level zone FG% may shift because blending changes the zone-specific rating distributions passed through the nonlinear, S-shaped `ratingToModifier`, fatigue rounding, and final probability clamp. `ratingToModifier` is concave below 40 and convex above 40; do not describe it as globally convex or claim a single Jensen direction. Centering guarantees the zero-fatigue 40/40 point, not aggregate neutrality. Report and explain all zone-level profile deltas.

If any enforced target leaves tolerance, stop and surface. Do not compensate anywhere else in the engine.

## Focused harness

Create `scripts/test-s3b2-defender-influence.ts` proving:

1. Every `interiorWeight[zone]` is finite and within `[0, 1]`; complementary weights sum to 1; all three 3PT zone entries reference the same shared derived constant; `long_midrange` references the separately named legacy-fallback constant fixed at `0`.
2. **Degenerate-formula equivalence:** under `{rim: 1, others: 0}`, exhaustively compare the new raw-blend → fatigue → modifier pipeline with the legacy expression for all integer perimeter/interior ratings 1–80, all six zones, and a predeclared representative fatigue grid including `0` and `1`. Every result must be exactly equal. Do not introduce a mutable runtime override merely to force a simulated game through degenerate weights.
3. At zero fatigue, a 40/40 defender produces raw blended rating 40 and defender modifier zero in every zone.
4. Interior defense has the stronger correctly signed rim effect (`interiorWeight[rim] > 0.5`).
5. Perimeter defense has the stronger correctly signed shared-3PT effect (`interiorWeight[three] < 0.5`).
6. `short_midrange` matches the full-window derivation report's committed generated value exactly. `long_midrange` equals the named legacy fallback exactly and is never described or tested as a derived long-two ordering.
7. Fatigue is applied exactly once, after raw blending and before `ratingToModifier`.
8. The RNG draw count and order in `resolveShot` are unchanged: trace the underlying `SeededRNG.next()` values for fixed blocked and unblocked cases and compare them with preflight traces. The blocked path consumes the existing contest and block draws; the unblocked path additionally consumes the make and foul draws. Assert both count and raw-value order.
9. Fixed-seed shot A/B inputs chosen away from the `[0.05, 0.95]` clamp show that the defender term remains one additive term inside the clamp. Increasing either defensive rating must never increase make probability. Require a strict decrease only when that rating's committed zone weight is positive; a clamped zero coefficient may correctly produce no response.
10. Clamp-edge cases remain within `[0.05, 0.95]` and may saturate without being misclassified as a sign failure.

The focused equivalence check proves the changed mathematical term; the full determinism harness remains the fixed-game byte-identity proof. Do not add a second copied shot resolver to the harness.

## Hard out of scope

- No `selectDefender` changes or S3.b1 retune.
- No contest distribution, steals, fouls, blocks, rebounds, or advantage mechanics.
- No target/tolerance or `BASE_FG_PCT_BY_ZONE` edits. If the derived blend alone makes an enforced zone unreachable, stop and surface rather than compensating.
- No player/save/event schema change and no normalized-data runtime read.
- No runtime choice among derivation windows or weight tables.
- No claim that long two was identified, and no relabeling of its legacy fallback as a projected or derived result.

## Stop and surface

Stop if:

- the composition check for `greaterThan15Ft` cannot be resolved from the data;
- the historical rating predictors cannot be constructed season-as-of without future leakage or without adding new per-player fields;
- any of the three authorized derived bands yields both joint coefficients non-positive, or the player-clustered 95% confidence interval for its sum includes zero;
- long two is omitted from the fit/report, is emitted as a derived weight, fails to reproduce the recorded zero-crossing confidence intervals within declared deterministic precision, or is described as identified;
- a derived weight inverts the structural priors (`interiorWeight[rim] <= 0.5` or `interiorWeight[three] >= 0.5`) in the full fit or either predeclared half-window;
- profile requires compensation outside this unit's scope;
- the S3.a lineup score regresses beyond its frozen tolerance from `docs/S3_LINEUP_VALIDATION.md`;
- the mechanic needs new per-player fields.

## Verification

```sh
npm run typecheck
npm run validate-nba-data
node --import tsx scripts/build-league.ts --check
node --import tsx scripts/derive-s3b2-defender-influence.ts --check
node --import tsx scripts/test-s3b1-defender-assignment.ts
node --import tsx scripts/test-s3b2-defender-influence.ts
node --import tsx scripts/validate-lineups.ts --check
npm run profile
npm run profile --silent > /tmp/s3b2-post-profile.out
npm run calibrate
npm run calibrate --silent > /tmp/s3b2-post-calibrate.out
node --import tsx scripts/test-determinism.ts
node --import tsx scripts/test-spacing-ab.ts
node --import tsx scripts/test-defense-ab.ts
```

Acceptance requires the three authorized derived bands to pass the unchanged publication gate, the long-two measurements to reproduce the authorized legacy-fallback decision without an identification claim, all other derivation checks and A/B signs green, profile PASS 32/32, deterministic output, the lineup score within its frozen S3.a tolerance, and explained pre/post profile/calibrate deltas including zone-FG% shifts. Record postflight SHA-256 values and compare them with preflight. Update `docs/PROJECT_STATUS.md` with hashes and verification evidence; S3.c1 becomes next. Do not change foul logic in this branch.
