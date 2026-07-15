# S3.b1 — defender assignment fidelity

Implement S3.b1: use normalized opponent-position matchup evidence to sharpen `selectDefender` and nothing else.

This is the first engine-touching S3 unit. It changes which on-court defender is assigned to the shooter; it does not change the defender's zone strength, contest distribution, foul logic, steal pressure, ratings derivation, or persisted data.

## Read first

- `AGENTS.md`
- `CLAUDE.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md` §3.2, §3.3, §4.3, §9, Appendix A/B
- `docs/S3_LINEUP_VALIDATION.md`
- `docs/prompts/S3A_LINEUP_VALIDATION_IMPLEMENTATION_PROMPT.md`
- `src/data/nba/types.ts` (`DefenseRow`, `matchupsByOppPosition`)
- `src/data/nba/load.ts`
- `src/engine/play-types.ts` (`selectDefender`)
- `src/engine/spacing.ts`
- the versatility/mismatch constants in `src/engine/constants.ts`
- `scripts/test-defense-ab.ts`
- `scripts/validate-lineups.ts`

Do not edit Next.js, save, franchise, transaction, or pipeline-normalization code.

## Preconditions

1. Start from clean `main` with S3.a accepted and `validate-lineups --check` green. Do not run this concurrently with another S3/F engine branch.
2. Confirm normalized defense coverage is present and `manifest.json` is complete. Do not re-harvest.
3. Reproduce the current PROJECT_STATUS profile/calibrate hashes and capture new preflight files outside the repo.
4. Record the current `selectDefender` assignment distribution using a fixed synthetic lineup matrix before editing.
5. Run typecheck, profile, calibrate, determinism, spacing A/B, defense A/B, build-league check, and lineup validation before edits.

Stop if S3.a is absent, its report is stale, normalized matchup coverage is missing, or baseline profile is not 32/32.

## Goal

Derive an empirical opponent-position matchup matrix from `DefenseRow.matchupsByOppPosition[*].partialPoss`, then express that evidence through one centered defender-selection weighting model using only existing runtime inputs:

- defender primary/secondary position;
- shooter primary/secondary position;
- defender perimeter/interior defense and defensive IQ;
- play type;
- centered lineup versatility / mismatch-hunt state.

The normalized data informs committed constants and derivation provenance; production simulation never reads the normalized files.

## Locked design

### Measurement/derivation

Create deterministic `scripts/derive-s3b1-matchups.ts`. It must:

- use the declared modern defense window present in the manifest, excluding incomplete seasons if applicable;
- possession-weight rows by `partialPoss`, never average player percentages equally;
- map NBA `G`, `G-F`, `F-G`, `F`, `F-C`, `C-F`, and `C` buckets to the engine's five positions with an explicit documented mapping;
- report composite-position treatment, null/zero samples, coverage, raw matrix, centered matrix, and normalization checks;
- derive constants before gameplay tuning and support deterministic `--check` or a mechanically checked committed constant block.

Do not use `matchupFgPct` here; S3.b2 owns defender influence.

### Runtime selection

Replace the current stack of mismatch coin flip, first positional match, and fallback weighting with one auditable weight calculation per defender.

- Combine the empirical position-match weight with existing defensive quality and mismatch-hunt effects.
- Preserve the weak-link story: isolation/post-up may hunt a sieve, and a switchable lineup reduces that hunt through centered versatility.
- An average matchup/lineup must remain centered against the empirical baseline.
- Select exactly once from the final weights. Prefer one unconditional `weightedChoice` draw per `selectDefender` call so the new implementation has a fixed draw contract.
- Sort/order only through the existing on-court lineup order; never use object-key enumeration or player IDs as behavioral tie-breakers.
- Put every tunable coefficient, clamp, and empirical matrix in `engine/constants.ts` with units/source/window/sane range.

Do not change `resolveShot`, `getDefenderRating`, `determineContestLevel`, `checkTurnover`, or player ratings/tendencies.

## Focused harness

Create `scripts/test-s3b1-defender-assignment.ts` proving on fixed inputs:

1. Exact fixed draw count per selection.
2. Guards/wings/bigs match the derived direction across a large fixed-seed sample.
3. Composite/secondary positions behave according to the declared mapping.
4. Isolation/post-up hunt the weak link more than neutral play types.
5. A switchable lineup suppresses hunting relative to a studs-plus-sieve lineup with comparable mean defense.
6. No defender becomes unreachable unless the empirical matrix and a named minimum weight explicitly justify it.
7. Output is identical on repeat.

The harness compares distributions, not individual sampled selections.

## Hard out of scope

- No zone-specific defender blend—that is S3.b2.
- No contest, deflection, steal, block, foul, rebound, drive, touch, screener, or assist changes.
- No rating/tendency derivation change.
- No new `Player`, `PlayByPlayEvent`, or save field.
- No new RNG branch or runtime data mode.
- No target/tolerance edits or base-shot retune.

## Stop and surface

Stop if:

- the position buckets cannot be mapped without guessing or the possession-weighted coverage is inadequate;
- fixed draw count cannot be achieved without violating engine invariants;
- profile can pass only by editing unrelated shot/turnover/foul constants;
- S3.a's score regresses beyond its frozen tolerance;
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

Acceptance requires profile PASS 32/32, deterministic fixed draw behavior, correctly signed matchup/mismatch distributions, no lineup-score regression, and explained pre/post profile + calibrate deltas. Update `docs/PROJECT_STATUS.md` with hashes and make S3.b2 next. Do not implement S3.b2 in this branch.
