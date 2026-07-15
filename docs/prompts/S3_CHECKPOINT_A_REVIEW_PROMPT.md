# S3 Checkpoint A — read-only next-tranche review

Perform the mandatory read-only S3 Checkpoint A review after S3.a, S3.b1, S3.b2, and S3.c1 have landed sequentially on `main`.

This prompt authorizes **analysis and roadmap recommendations only**. Do not edit engine code, constants, generated reports, targets, or implementation prompts. After the review, a separate docs-only change may record the approved disposition and archive exactly one next-unit prompt.

## Read first

- `AGENTS.md`, `CLAUDE.md`
- `docs/ROADMAP.md` §3.2, §3.3, §4.3, §9, Appendix A/B
- `docs/PROJECT_STATUS.md`
- `docs/S3_LINEUP_VALIDATION.md`
- all four accepted S3 prompts and their focused harnesses/derivation reports
- `scripts/profile-engine.ts` and `docs/LEAGUE_TARGETS.md`
- `src/engine/shot.ts`, `possession.ts`, `turnover.ts`, `rebound.ts`, `defense.ts`, `play-types.ts`, `spacing.ts`, and `constants.ts`
- normalized tracking/hustle/defense type contracts and loaders

## Preconditions

1. Verify `main` contains accepted S3.a, S3.b1, S3.b2, and S3.c1 commits and no later S3 mechanics.
2. Verify a clean worktree. If dirty, inspect the full diff and remain read-only; stop if it obscures the accepted state.
3. Confirm every accepted unit's profile/calibrate hashes, focused harness output, and documented deltas exist in `docs/PROJECT_STATUS.md`.
4. Re-run, without editing:

   ```sh
   npm run typecheck
   npm run validate-nba-data
   node --import tsx scripts/build-league.ts --check
   node --import tsx scripts/validate-lineups.ts --check
   node --import tsx scripts/test-s3b1-defender-assignment.ts
   node --import tsx scripts/test-s3b2-defender-influence.ts
   node --import tsx scripts/test-s3c1-and-ones.ts
   npm run profile
   npm run calibrate
   node --import tsx scripts/test-determinism.ts
   node --import tsx scripts/test-spacing-ab.ts
   node --import tsx scripts/test-defense-ab.ts
   ```

If an accepted gate is no longer green, report regression and stop. Do not authorize another mechanic on an unstable base.

## Review question

Which, if any, single provisional S3 unit now has enough evidence and isolation to implement next?

Evaluate candidates in this order:

1. S3.c2 — contest-level distributions.
2. S3.c3 — deflection/pass pressure.
3. S3.d — drive/touch advantage creation.
4. S3.e — rebounder positioning.
5. S3.f — screener/handoff involvement.

S3.g is not a candidate. It remains dormant under the S2c2 assist decision unless a separate decision review is explicitly requested.

## Required evidence per candidate

For each candidate, report:

- the precise current engine mechanism and files it would replace/refine;
- the normalized source fields, season coverage, sample/identity coverage, and semantic match;
- the current profile or focused diagnostic residual it would address;
- whether the intended effect can be centered using existing ratings/tendencies/positions without new persisted fields;
- the RNG draw contract;
- the enforced stats most likely to move and why;
- whether one mechanic can be isolated from adjacent ideas;
- the item-specific oracle/A-B that would prove the intended effect;
- any Appendix A stop condition that applies.

Candidate-specific cautions:

- **S3.c2:** contested-shot counts do not directly reveal the engine's four contest-level distribution. Require an explicit mapping/validation design; do not infer a distribution from volume alone.
- **S3.c3:** deflections are not steals or turnovers. Require a semantic bridge and keep pass pressure separate from initial-handler turnover logic.
- **S3.d:** tracking drives/touches are player behaviors, but S3 cannot persist new raw features. Require an existing-rating/tendency projection and preserve `MAX_EXTRA_PASSES` plus spacing-gated advantage.
- **S3.e:** ORB rate is already near target. Prefer rebounder attribution/positioning; do not tune engine putback frequency to the PBP putback-FGA proxy.
- **S3.f:** screen assists are not box assists. Credit must remain event-stream-only and non-persisted; no direct stat mutation or new play type.

## Disposition rules

Assign exactly one of these to every candidate:

- **AUTHORIZE NEXT** — evidence is sufficient, scope is one mechanic, runtime representation is legal, and an acceptance oracle can be predeclared.
- **DEFER** — plausible but evidence/semantic bridge/oracle is insufficient now; state what measurement would unblock it.
- **RETIRE** — current engine/profile evidence shows no useful problem or the mechanic cannot fit S3's persisted-shape/runtime constraints.

Authorize at most one next unit. “All look useful” is not a valid result.

## Required output

Return a concise evidence table plus:

1. Current accepted baseline and any drift from the recorded state.
2. One recommended next unit, or `STOP — NO S3-3 UNIT AUTHORIZED`.
3. Exact scope and out-of-scope boundaries for that unit.
4. Required derivation, focused harness, profile watches, RNG contract, and stop conditions for its future prompt.
5. Roadmap/PROJECT_STATUS lines that a later docs-only change should update.

Do not write the future implementation prompt during this review. The user must approve the disposition first; then create one prompt, commit it before implementation, and land that unit alone.
