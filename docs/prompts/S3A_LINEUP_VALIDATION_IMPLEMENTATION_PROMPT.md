# S3.a — historical lineup-model validation

Implement S3.a: the deterministic historical validation harness for the production spacing + defensive-versatility model.

This is a **measurement and behavior-preserving derivation-seam unit**, not an engine retune. It must not change a game outcome, the active player pool, a save shape, or any production constant. Its output becomes the regression oracle for later S3 fit work.

## Read first

Read in full before editing:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md` §3.2, §3.3, §4.3, §9, and Appendix A/B
- `docs/S2B_RATINGS_CONTRACT.md`
- `docs/S2C1_TENDENCIES_CONTRACT.md`
- `docs/S2D_ACTIVATION_CONTEXT.md`
- `scripts/build-league.ts`
- `scripts/calibrate-spacing.ts`
- `scripts/test-build-league.ts`
- `src/ratings/nba-derivation.ts`
- `src/ratings/nba-tendencies.ts`
- `src/engine/spacing.ts`
- `src/engine/play-types.ts` (`primaryPlayerWeight` and finisher selection)
- `src/data/nba/types.ts` and `src/data/nba/load.ts`
- `src/models/player.ts` and `src/models/save.ts`

Do not edit Next.js files in this unit.

## Preconditions

1. Start from clean `main` containing S2d and F2 acceptance. Preserve unrelated user changes and stop if they overlap this unit.
2. Confirm the active profile prints `S2D ACTIVATION CONTEXT — VERIFIED` and passes 32/32.
3. Confirm `data/nba/normalized/manifest.json` is complete and that normalized `lineups` covers 2007-08 through 2024-25. Do not harvest or regenerate missing data merely to continue.
4. Confirm the current production player shape contains no raw NBA matchup/tracking fields and `SaveFile` snapshots `Player[]`. S3.a must not change either shape.
5. Export the repository Node runtime first. If `tsx` fails with `listen EPERM`, use `node --import tsx`.
6. Before editing, capture outside the repo:

   ```sh
   npm run typecheck
   npm run validate-nba-data
   node --import tsx scripts/build-league.ts --check
   node --import tsx scripts/test-build-league.ts
   npm run profile --silent > /tmp/s3a-pre-profile.out
   npm run calibrate --silent > /tmp/s3a-pre-calibrate.out
   node --import tsx scripts/test-determinism.ts
   node --import tsx scripts/test-spacing-ab.ts
   node --import tsx scripts/test-defense-ab.ts
   ```

   Record the profile/calibrate SHA-256 values and active `teams.json` / `players.json` hashes. They are unchanged-output gates for this unit.

Stop if the live facts conflict with the roadmap, a required season is absent, the manifest is incomplete, or the current baselines do not reproduce `docs/PROJECT_STATUS.md`.

## Goal

Create `scripts/validate-lineups.ts` and deterministic generated report `docs/S3_LINEUP_VALIDATION.md`. Score the production spacing and versatility model against real five-man lineup outcomes from 2007-08 through 2024-25 without using a sum of player ratings as lineup value and without leaking future-season information into a historical row.

## Locked design decisions

### 1. One shared season-as-of projection seam

The harness needs engine-compatible `Player` inputs for historical people. Do not copy rating/tendency formulas into the script.

If the current builder/derivation is too 2025-26-specific, extract the minimum pure, parameterized seam needed to construct a season-as-of player projection. The default production configuration must remain byte-identical. A historical season may consume only data available at or before that season.

The seam may return an in-memory engine-compatible projection. It must not write a historical league, generate contracts, mutate saves, or add fields to `Player`.

### 2. Honest coverage strata

The report covers all lineup seasons 2007-08 through 2024-25, but input availability differs by era:

- lineups: 2007-08+
- defense/tracking: 2013-14+
- hustle: 2015-16+
- play-type/shot-event inputs: use only seasons actually present; fallbacks remain explicit

Report at least:

- long-run cohort: 2007-08 through 2024-25;
- defense/tracking cohort: 2013-14 through 2024-25;
- full hustle-era cohort: 2015-16 through 2024-25;
- per-season usable rows, possessions, identity-join rate, and fallback rates.

Never guess an identity. Require at least 95% usable lineup-row coverage and 95% usable-possession coverage in every season after exact `personId` joins; otherwise stop with the coverage table and no model judgment.

### 3. Production model, not a parallel formula

- Defensive score: call production `rawVersatility` / `computeVersatility`.
- Offensive score: for each possible finisher, call production off-ball gravity/spacing on the other four players; combine the five outcomes using the same `primaryPlayerWeight` logic used by production selection.
- Keep `spacing.ts` pure. Do not add RNG or validation-only branches to it.
- Do not redefine the 40-centered rating convention.

### 4. Primary comparison isolates fit

The primary observation is a within-team, within-season lineup pair sharing exactly four players. This treats the fifth-player substitution as the fit contrast instead of pretending raw lineup net rating is pure fit.

For every eligible pair, compute:

- spacing delta versus observed offensive-rating delta;
- versatility delta versus negative observed defensive-rating delta;
- combined model delta versus observed net-rating delta.

Weight pair observations deterministically by the harmonic mean of the two lineups' possessions so one tiny lineup cannot dominate. Do not create quadratic duplicate pairs; canonicalize pair keys and sort all inputs.

### 5. Metrics and leakage control

Report for each cohort:

- usable lineups, possessions, and four-of-five pair count;
- possession-weighted Pearson and Spearman correlations;
- direction accuracy, with exact observed ties excluded and model ties reported;
- a cross-validated linear calibration's weighted RMSE/MAE;
- leave-one-season-out results and dispersion across held-out seasons;
- sensitivity rows using all finite-possession lineups and minimum-possession cutoffs of 100, 250, and 500. The all-row possession-weighted result is primary; cutoff rows are sensitivity only.

Do not fit and evaluate on the same season. Do not use future seasons to standardize a held-out season. Do not turn player-rating sums into the baseline comparator.

### 6. Regression floor

The first accepted run records the current model honestly; model quality is not a pass/fail requirement for S3.a. Derive and freeze a future non-regression tolerance from the leave-one-season-out dispersion, with a documented small numerical floor for floating-point stability. Do not choose the tolerance based on whether a later mechanic passes.

`--check` must regenerate the report in memory and compare byte-for-byte with the committed file. Generated content contains measurements and provenance only—no “S3 blocked,” “S3 complete,” or implementation recommendation.

## Required files

Expected surface:

- `scripts/validate-lineups.ts` — CLI, deterministic derivation, report generation, and `--check`.
- A small shared historical-projection module only if necessary to avoid copied builder logic.
- `scripts/test-s3a-lineups.ts` for pair canonicalization, season leakage, weighting, and deterministic output.
- `docs/S3_LINEUP_VALIDATION.md` — generated measurement/provenance.
- `CLAUDE.md` and ROADMAP Appendix B — classify/register the generated artifact.
- `docs/PROJECT_STATUS.md` — handwritten interpretation, evidence, hashes, and next unit S3.b1.

Do not update engine constants or gameplay files.

## Stop and surface

Stop without retuning if:

- historical engine-compatible projections cannot be constructed without copying derivation logic or reading future seasons;
- any season misses the declared identity/possession coverage gate;
- validation would require a new persisted player field;
- production `build-league` output changes after the extraction;
- profile/calibrate stdout changes;
- a bad initial validation score tempts an outcome-driven constant change.

An unfavorable score is a valid S3.a result. Land the oracle and put interpretation in ROADMAP/PROJECT_STATUS.

## Verification and acceptance

Run:

```sh
npm run typecheck
npm run validate-nba-data
node --import tsx scripts/build-league.ts --check
node --import tsx scripts/test-build-league.ts
node --import tsx scripts/validate-lineups.ts
node --import tsx scripts/validate-lineups.ts --check
node --import tsx scripts/test-s3a-lineups.ts
npm run profile --silent > /tmp/s3a-post-profile.out
npm run calibrate --silent > /tmp/s3a-post-calibrate.out
node --import tsx scripts/test-determinism.ts
node --import tsx scripts/test-spacing-ab.ts
node --import tsx scripts/test-defense-ab.ts
```

Acceptance requires:

- production pool files byte-identical;
- profile and calibrate stdout byte-identical to preflight;
- fixed-seed game determinism unchanged;
- lineup report byte-idempotent and coverage gates green;
- historical projection proven season-as-of;
- no runtime/save-schema change;
- documentation records the measured baseline without claiming the model passed a target that did not exist.

Final handoff: list the derivation seam, exact cohort coverage, primary/sensitivity scores, frozen regression tolerance, all unchanged hashes, and any measured weakness. Do not begin S3.b1 in this branch.
