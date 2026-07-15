# S3.c1 — made/missed shooting-foul conditioning

Implement S3.c1: condition the existing shooting-foul probability on whether the shot was made so the engine stops producing and-ones at more than twice the observed rate while preserving the enforced FTA anchor.

This unit changes shooting-foul conditioning only. It does not change shot accuracy, defender assignment/influence, contest levels, free-throw accuracy, foul targets, or event/stat accounting.

## Read first

- `AGENTS.md`, especially shot math, event-derived stats, determinism, and calibration
- `CLAUDE.md`, `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md` §4.3 S3.c1, §9, Appendix A #3/#5/#7/#10/#13
- `docs/LEAGUE_TARGETS.md` and the and-one derivation in `scripts/derive-league-targets.ts`
- `scripts/profile-engine.ts`
- `src/engine/shot.ts`, `possession.ts`, `constants.ts`, and `stats-accumulator.ts`
- accepted S3.b1/S3.b2 harnesses and `scripts/validate-lineups.ts`

## Preconditions

1. Start from clean `main` with S3.a, S3.b1, and S3.b2 accepted sequentially.
2. Reproduce the live profile PASS 32/32, activation banner, current profile/calibrate hashes, lineup check, and both defender harnesses.
3. Confirm the live shot order remains: contest draw → block draw → make draw → exactly one shooting-foul draw for an unblocked shot.
4. Confirm the profile still reports and-one rate as `andOnes / made FGs` and FTA remains ENFORCED.
5. Before treating the PBP-derived and-one rate as a tuning reference, add/verify the independent aggregate cross-check required by ROADMAP Appendix A #3: PBP made-FG and FTA universes must reconcile with the independent box totals inside named, predeclared tolerances. Keep the and-one row INFORMATIONAL; do not promote it into the 32 enforced profile rows.

If the cross-check cannot support the reference, stop with the measured discrepancy. Do not pin a constant to an unverified parsed/subtype proxy.

## Starting evidence

At prompt authoring, the activated seed-2026 profile measured:

- and-one rate: 13.7% per made FG;
- PBP-derived reference: 5.6%;
- FTA: 22.2 vs 22.3 ± 1.2;
- FG% and every zone FG% inside tolerance.

Re-measure these values. The live run governs.

## Mathematical contract

The current independent foul roll gives made and missed shots the same foul probability. Lowering made-shot fouls while moving those fouls to misses changes attempts per foul event: an and-one yields one FT, a missed shot yields two or three. Therefore S3.c1 cannot preserve both total foul-event incidence and FTA.

The binding preservation target is expected free-throw attempts.

For an unblocked shot with:

- make probability `q` (the already-clamped `finalProbability`),
- current unconditional foul probability `p`,
- missed-foul attempts `n` (2 or 3),
- derived made-foul multiplier `m`,

use a documented form equivalent to:

```text
pMade = p * m
baselineExpectedFTA = p * (q * 1 + (1 - q) * n)
pMiss = (baselineExpectedFTA - q * pMade) / ((1 - q) * n)
```

Then use exactly one existing foul draw against `pMade` when `made`, otherwise `pMiss`. Account explicitly for probability clamps and prove they do not create material FTA drift over the production distribution.

The final implementation may use an algebraically equivalent stable form, but it must preserve these claims:

- one foul RNG draw per unblocked shot;
- expected FTA neutral before bounded clamps;
- `drawFoulRate` and defensive `foulMult` remain monotonic inputs through `p`;
- made-foul probability moves toward the verified and-one reference;
- the resulting change in foul-event incidence is derived and reported, not mislabeled as unchanged.

Put the multiplier, clamp(s), reference window, and any numerical-stability floor in `engine/constants.ts` with source and sane range.

## Derivation and acceptance band

Create deterministic `scripts/derive-s3c1-and-ones.ts` and extend the generated league-target provenance only where needed for the independent cross-check. The focused derivation must:

- reports per-season and pooled and-one rates using the existing structural definition;
- prints the independent PBP-vs-box FGM/FTA cross-check;
- derives a predeclared informational acceptance band from observed season dispersion plus a documented floor;
- mechanically checks the committed multiplier/reference rather than hand-transcribing an unexplained value;
- does not change `docs/LEAGUE_TARGETS.md` enforced targets, tolerance bands, or tier labels except to add factual provenance/cross-check text through its generator.

## Focused harness

Create `scripts/test-s3c1-and-ones.ts` covering:

1. Algebraic expected-FTA neutrality across representative `q`, zone, draw-foul, and pressure values.
2. One foul RNG draw on made and missed unblocked shots; blocked shots retain their existing early-return draw behavior.
3. Monotonic ordering for draw-foul skill and defensive pressure.
4. Probability bounds and clamp-frequency reporting.
5. Fixed-seed A/B: conditioned versus legacy formula over a large synthetic sample, showing and-one rate decreases and expected FTA remains neutral.
6. Repeat output byte-identical.

Do not add a post-hoc correction roll.

## Hard out of scope

- No base FG%, shooter/defender modifier, contest, block, or free-throw percentage changes.
- No direct stat assignment or event-shape change.
- No target/tolerance/re-tier change.
- No attempt to repair all personal-foul texture.
- No S3.c2 contest or S3.c3 pressure work.
- No new persisted player/save field.

## Stop and surface

Stop if:

- the reference fails its independent aggregate cross-check;
- expected FTA neutrality cannot be maintained without another RNG draw;
- profile can pass only by changing base shooting, FTA target, or free-throw accuracy;
- assists, turnovers, margin, or zone efficiency leave tolerance and the cause is outside foul conditioning;
- the lineup score regresses beyond its frozen tolerance.

## Verification

```sh
npm run typecheck
npm run validate-nba-data
node --import tsx scripts/derive-league-targets.ts --check
node --import tsx scripts/derive-s3c1-and-ones.ts --check
node --import tsx scripts/test-s3c1-and-ones.ts
node --import tsx scripts/test-s3b1-defender-assignment.ts
node --import tsx scripts/test-s3b2-defender-influence.ts
node --import tsx scripts/validate-lineups.ts --check
npm run profile
npm run profile --silent > /tmp/s3c1-post-profile.out
npm run calibrate
npm run calibrate --silent > /tmp/s3c1-post-calibrate.out
node --import tsx scripts/test-determinism.ts
node --import tsx scripts/test-spacing-ab.ts
node --import tsx scripts/test-defense-ab.ts
```

Acceptance requires profile PASS 32/32, FTA in its existing band without target edits, and-one rate within the predeclared informational band, one stable foul draw, deterministic output, no lineup regression, and fully reported changes to foul-event incidence and calibrate drift.

Update `docs/PROJECT_STATUS.md`, then stop. The next action is the read-only S3 Checkpoint A review—not S3.c2 implementation.
