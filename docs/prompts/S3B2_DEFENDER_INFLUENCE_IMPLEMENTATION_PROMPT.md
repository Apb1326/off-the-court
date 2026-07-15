# S3.b2 — zone-specific defender influence

Implement S3.b2: use normalized defended-category FG%± evidence to derive how the existing perimeter and interior defensive ratings blend by shot zone.

This unit changes only the defender-rating term already consumed by `resolveShot`. Defender assignment is inherited unchanged from accepted S3.b1. Do not add a second defense modifier.

## Read first

- `AGENTS.md`, `CLAUDE.md`, `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md` §3.2, §3.3, §4.3, §9, Appendix A/B
- `docs/S3_LINEUP_VALIDATION.md`
- the accepted S3.b1 derivation/report and `scripts/test-s3b1-defender-assignment.ts`
- `src/data/nba/types.ts` (`DefendedCategoryLine`)
- `src/engine/shot.ts`
- `src/engine/constants.ts`
- `src/ratings/nba-derivation.ts` defense inputs, to avoid circular claims
- `scripts/profile-engine.ts`, `scripts/test-defense-ab.ts`, and `scripts/validate-lineups.ts`

## Preconditions

1. Start from clean `main` with S3.b1 accepted. Reproduce S3.b1's focused harness and the current profile/calibrate hashes.
2. Confirm normalized defended categories and finite `dFga` / `pctPlusMinus` coverage. Do not repair raw/normalized data in this unit.
3. Capture preflight profile, calibrate, build-league check, determinism, both A/Bs, S3.b1 harness, and lineup validation.
4. Confirm the live `getDefenderRating` uses interior defense at the rim and perimeter defense everywhere else. If the source has already changed, stop and reconcile the prompt with the roadmap.

## Goal

Derive a centered per-zone blend:

```text
defenderRating(zone) = perimeterDefense * perimeterWeight[zone]
                     + interiorDefense  * interiorWeight[zone]
```

Weights sum to 1 for every zone. The result replaces the existing defender-rating lookup; it does not create an additional additive penalty.

## Derivation contract

Create deterministic `scripts/derive-s3b2-defender-influence.ts` that:

- uses possession/attempt-weighted defended-category evidence (`dFga`), not unweighted player averages;
- declares the exact season window and finite-sample filters before fitting;
- maps normalized categories (`lessThan6Ft`, `lessThan10Ft`, `twoPointers`, `greaterThan15Ft`, `threePointers`, etc.) to the engine's six zones explicitly;
- accounts for overlap between categories rather than treating overlapping samples as independent rows;
- reports coverage and uncertainty/sensitivity for every derived blend;
- keeps an average 40/40 defender at modifier zero by construction;
- writes named constants with provenance, units, and sane ranges to `engine/constants.ts`;
- supports deterministic `--check` or mechanically verifies the committed constants.

The defense source also contributes to S2b rating derivation. State that circularity limitation honestly: S3.b2 calibrates the runtime mapping of existing ratings to zones; it does not claim an independent causal estimate of defense.

## Runtime implementation

- Make `getDefenderRating` testable/exported only if needed by the focused harness.
- Apply fatigue to the final blended rating exactly once.
- Preserve `ratingToModifier` and the additive shot clamp.
- Do not alter contest level, block chance, foul chance, shooter ratings, form, momentum, advantage, rush, effort, or base zone percentages.
- Add no RNG and consume no additional draws.

## Focused harness

Create `scripts/test-s3b2-defender-influence.ts` proving:

1. Weight sums and bounds for all six zones.
2. A 40/40 defender is centered in every zone.
3. Interior defense has the stronger correctly signed rim effect.
4. Perimeter defense has the stronger correctly signed three-point effect.
5. Midrange blends follow the derived ordering rather than a hand-authored assumption.
6. Equal blended ratings produce equal defender modifiers.
7. No RNG is consumed by the blend.
8. Fixed-seed shot A/B effects remain additive and inside the clamp.

## Hard out of scope

- No `selectDefender` changes or S3.b1 retune.
- No contest distribution, steals, fouls, blocks, rebounds, or advantage mechanics.
- No target/tolerance or `BASE_FG_PCT_BY_ZONE` edits unless the derived blend alone makes an enforced zone unreachable; in that case stop and surface rather than compensating.
- No player/save/event schema change and no normalized-data runtime read.

## Stop and surface

Stop if defended categories cannot support a non-overlapping mapping, a derived blend contradicts the data across reasonable windows, profile requires unrelated compensation, S3.a regresses beyond tolerance, or the mechanic needs new per-player fields.

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

Acceptance requires all derived checks and A/B signs green, profile PASS 32/32, deterministic output, no lineup-score regression, and explained pre/post profile/calibrate deltas. Update `docs/PROJECT_STATUS.md`; S3.c1 becomes next. Do not change foul logic in this branch.
