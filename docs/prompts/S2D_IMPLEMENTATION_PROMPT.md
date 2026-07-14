# S2d — activation, coupled re-baseline, and legacy-ingest retirement

Implement S2d — activation, coupled re-baseline, and legacy-ingest retirement.

This is one engine-touching execution unit. Do not borrow Stage 3 mechanics, target changes, F4 work, transactions, or UI work.

## Read first

Read in full before editing:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/ROADMAP.md` (§3–4.2, §9, §10)
- `docs/PROJECT_STATUS.md`
- `docs/S2C2_ASSIST_DECISION.md`
- `docs/S2C2_ASSIST_AND_DIET_REPORT.md`
- `docs/S2A_LEAGUE_COVERAGE.md`
- `docs/S2B_RATINGS_CONTRACT.md`
- `docs/S2C1_TENDENCIES_CONTRACT.md`
- `docs/S2C1_R_SELECTION_DIAGNOSIS.md`
- `docs/prompts/S2C2_IMPLEMENTATION_PROMPT.md`
- `scripts/build-league.ts`
- `scripts/league-pool.ts`
- `scripts/profile-engine.ts`
- `scripts/calibrate-spacing.ts`
- `scripts/recompute-derived.ts`
- `scripts/report-s2c2.ts`
- `scripts/diagnose-s2c2-zones.ts`
- `scripts/diagnose-assists.ts`
- `scripts/assist-measurement.ts`
- `src/engine/play-types.ts`
- `src/engine/constants.ts`
- `src/engine/spacing.ts`
- `src/engine/shot.ts`
- `src/engine/possession.ts`
- `src/data/store/json-store.ts`
- the new-game API route
- `src/ratings/nba-derivation.ts`
- legacy derivation and save-migration consumers
- `scripts/ingest.ts`, `scripts/seed-test.ts`, and `src/data/ingest/`
- `package.json` and `README.md`

If you modify a Next.js route or convention, read the relevant guide under `node_modules/next/dist/docs/` first.

## Preconditions and stop conditions

1. Fetch and verify `origin/main` is at `9ee5dfa` or an explicit descendant containing its S2c2-R repair. Do not work from `67cb8f0` alone: the S2c2-R commits add required modifier decomposition, real-diet guards, and dual-table invariants.
2. Fast-forward the local checkout to that source of truth before edits. Start from a clean worktree; do not overwrite unrelated user changes.
3. Commit this exact finalized prompt first as `docs/prompts/S2D_IMPLEMENTATION_PROMPT.md`. Update `docs/prompts/README.md` if needed.
4. Confirm the required local artifacts exist. Stop rather than regenerate them:
   - `data/nba/normalized/`
   - active `data/teams.json` and `data/players.json`
   - `data/league-candidate/teams.json` and `players.json`
   - history artifacts required by `npm run calibrate`
5. Before edits, run and record:

   ```sh
   npm run typecheck
   npm run validate-nba-data
   node --import tsx scripts/build-league.ts --check
   node --import tsx scripts/test-build-league.ts
   node --import tsx scripts/report-s2c2.ts --base-commit=67cb8f0 --check
   node --import tsx scripts/diagnose-s2c2-zones.ts --league-dir=data/league-candidate --shot-zones=real --seed=2026
   npm run profile --silent > /tmp/s2d-pre-profile.out
   npm run calibrate --silent > /tmp/s2d-pre-calibrate.out
   node --import tsx scripts/test-determinism.ts
   node --import tsx scripts/test-spacing-ab.ts
   node --import tsx scripts/test-defense-ab.ts
   node --import tsx scripts/test-s2c1-r.ts
   ```

   Record SHA-256 values for both silent captures.
6. Stop and report rather than improvising if:
   - the candidate fails its deterministic build or structural contract;
   - required normalized/history artifacts are unavailable;
   - the candidate/default-path relationship conflicts with the roadmap;
   - the profile cannot reach a full PASS without changing targets/tolerances or adding Stage-3 mechanics;
   - a schema change appears necessary despite stable player/team shapes.

## Locked decisions

S2d is the sole activation point.

- The pipeline-derived league becomes the default roster source for every new game. Existing saves remain self-contained snapshots; do not rewrite their players, ratings, tendencies, or rosters.
- The accepted candidate selector becomes the sole production selector. Retire the legacy selector rather than keeping hidden fallback modes, path/ID inference, environment switches, or dual active behavior.
- Promote the accepted real diet to the sole `PLAY_TYPE_SHOT_ZONES` table. Delete `PLAY_TYPE_SHOT_ZONES_REAL`, shaded-table compensation, and `--shot-zones`.
- Keep cut and spot-up diets locked. The S2c2-R decomposition proves they are not the source of the residual.
- Strict chain assists remain the only stat-credit rule. The scorekeeper-aligned proxy stays measurement-only; no post-hoc assist rolls or S3.g mechanics.
- Settle the FT anchor against the empirical target (currently 0.7823; verify from `docs/LEAGUE_TARGETS.md`). Change `FT_LEAGUE_AVG_PCT`, `FT_PCT_SLOPE`, and formula-defined `FT_DERIVE_SCALE` together, then assert the quantized/clamped round trip.
- Retire the obsolete BDL/synthetic new-league path: `npm run ingest`, `npm run seed`, `scripts/ingest.ts`, `scripts/seed-test.ts`, and runtime-only BallDontLie generation code. Preserve only narrowly necessary historical-save migration compatibility.
- `npm run build-league` becomes the deterministic production new-league builder. Validate fully before promotion and make promotion recoverable/crash-safe. Do not call a two-file overwrite atomic unless it actually is.
- The default data/new-game path must consume the activated NBA-derived league, never a candidate directory or alternate-pool flag.

## Required implementation

### 1. Activate one production selector and one shot-zone table

Remove the legacy/candidate runtime split cleanly. The accepted candidate selection behavior, emitted labels, conditional transition handling, and real diets become default engine behavior.

Delete obsolete APIs and configuration rather than keeping them “for later.” There must be no reachable shaded table or legacy selector after S2d.

### 2. Activate the deterministic league builder

Make `npm run build-league` build and promote the active `data/teams.json` and `data/players.json` used by `JsonStore` and new-game creation.

Keep deterministic ordering, serialization, stable-key one-shot contract RNG, roster/rotation/free-agent validation, and generated S2 data contracts. Validate all output before activation.

Existing S2a–S2c2 documents remain historical evidence. Update any wording that falsely claims the current product remains candidate-only or BDL-derived.

### 3. Retire S2c2-only executable reporting

S2d deletes `PLAY_TYPE_SHOT_ZONES_REAL` and `--shot-zones`; therefore refactor or retire `scripts/report-s2c2.ts` and every executable check/report that depends on those interfaces.

Keep committed S2c2 reports as historical evidence, but leave no runnable dependency on the deleted dual-table model or `--shot-zones`. Replace ongoing useful measurement with an S2d production-path report/harness that only uses the activated selector and sole table.

Generated reports contain measurements and provenance only. Interpretation and phase status belong in ROADMAP and PROJECT_STATUS.

### 4. Re-derive spacing and versatility baselines

Extend or replace `scripts/calibrate-spacing.ts` so it derives and prints authoritative baseline/spread values for both:

- `SPACING_BASELINE_OFFBALL_FOUR` / `SPACING_SPREAD`
- `VERSATILITY_BASELINE` / `VERSATILITY_SPREAD`

Use `rawOffBallGravity` and `rawVersatility` with a documented, deterministic, representative lineup population. Keep `spacing.ts` pure arithmetic and RNG-free.

Adopt the measured values in `constants.ts`; do not guess values by hand.

### 5. Diagnose and retune only demonstrated coupled causes

The S2c2-R decomposition is binding:

- locked cut/spot-up real diets are not the residual source;
- the major contributors are the global three-point dampener and active-pool-derived spacing baselines.

Use the post-activation profile and decomposition to quantify those contributions, then retune only named constants in `src/engine/constants.ts`.

Do not characterize this as a generic long-mid/three mismatch. Explain the movement of points, margin, assists, turnovers, six-zone shares, and zone FG% with before/after evidence.

Do not change target derivation, tolerance bands, zone semantics, event accounting, assist mechanics, pass-chain ceiling, RNG order, or add multiplicative shot math.

### 6. Replace focused candidate-only tests

Replace or evolve `test-s2c1-r.ts` into an S2d-focused harness proving:

- default production selection is the accepted pipeline behavior;
- no legacy selector or shaded/real switch remains reachable;
- fixed seeds remain byte-identical;
- play-type terminal bands still hold for seeds 2026, 7, and 42;
- `build-league --check` remains byte-identical;
- new-game templates use the activated NBA-derived pool;
- existing saves load without their roster snapshots being rewritten.

Add a non-mutating FT inverse-pair test. If old-save migration needs a legacy normalizer, narrow and document it; loading a save must not silently rederive its roster.

## Hard out of scope

- No Stage 3 possession, assist, defense, or shot-model redesign.
- No target/tolerance/era-window change or re-tiering.
- No direct stat assignment or `PlayByPlayEvent` persistence change.
- No scouted ratings on simulation paths.
- No save schema bump or save rewrite unless a genuine incompatible persisted shape forces a stop-and-surface.
- No F2/F3/F4, transactions, draft, or UI-feature work.
- Do not remove `download-history.ts` or `calibrate-history.ts`.
- No `Math.random()`, ambient time seed, or unstable RNG consumption.

## Required final verification

Run against the activated active pool:

```sh
npm run typecheck
npm run validate-nba-data
node --import tsx scripts/build-league.ts --check
node --import tsx scripts/test-build-league.ts
npm run profile
npm run profile --silent > /tmp/s2d-post-profile.out
npm run calibrate
npm run calibrate --silent > /tmp/s2d-post-calibrate.out
node --import tsx scripts/test-determinism.ts
node --import tsx scripts/test-spacing-ab.ts
node --import tsx scripts/test-defense-ab.ts
node --import tsx <S2d focused harness>
```

Acceptance requires:

- `npm run profile` exits 0 with every enforced stat in band.
- Determinism is green.
- Both A/B tests remain material and correctly signed on the re-derived baselines.
- FT inverse round trip passes.
- The active builder and generated contracts are byte-idempotent.
- `npm run calibrate` remains deterministic; report its before/after deltas and direction.
- Existing saves load without player-pool rewrites.
- Final profile/calibrate SHA-256 values are recorded in `docs/PROJECT_STATUS.md`.

Use small, reviewable commits:

1. Prompt/archive and preflight evidence.
2. Activation builder, production selector, legacy retirement, and focused tests.
3. Re-baseline and profile retune.
4. Generated measurement artifacts and handwritten docs.

Final handoff must report the activation design, retired interfaces, changed constants, pre/post profile deltas, calibrate deltas, A/B and determinism results, final SHA-256 hashes, and any unresolved limitation. Do not claim acceptance or commit final status if profile is not green.
