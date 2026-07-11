# S2c2 — Assist-Definition Decision + Stage-1 Compensation Unwind

You are implementing execution unit **S2c2** of the Off the Court roadmap (`docs/ROADMAP.md` §4.2, priority row 2c). This unit settles two named Stage-1 residuals **on the candidate pool only**:

- **Deliverable 1 — the assist-definition decision (inherited from S1 decision 6, carrying S1-Rb's written diagnosis).** Adopt, document, and implement a measurement-side mapping between the NBA scorekeeper assist and the engine's strict chain assist, and report per-zone assisted rates under both definitions against the NBA reference.
- **Deliverable 2 — the compensation unwind.** Restore the two deliberately shaded play-type shot diets (`cut`, `spot_up`) to locked restoration values inside the ranges quantified in the `KNOWN STAGE 2 ARTIFACT` block's own comments, expressed as a **second table selected only on the candidate evaluation path**, so the active pool is untouched. Report the candidate's play-type distribution and zone shares under the real diets.

The candidate remains **inactive**. S2d is the sole activation point; it owns promoting the real-diet table to sole table, retuning the profile to PASS on the activated pool, and any `PLAY_TYPE_PASS_RATE` adjustment. S3.g owns any change to engine assist-credit *mechanics*. Nothing in this unit changes how any stat is credited or what the active pool simulates.

---

## Step −1 — Preflight: prompt archival and base branch (do this before any code)

1. This finalized prompt is committed as **`docs/prompts/S2C2_IMPLEMENTATION_PROMPT.md`** before execution, per the repository's prompt-archival policy.
2. The documentation branch `docs/project-status-and-agent-ergonomics` is merged first. Implementation begins from a **clean, up-to-date `main` containing commit `f3487d9` or its merged descendant** — the updated `AGENTS.md` rules and `docs/PROJECT_STATUS.md` must be present on your base.
3. **STOP** if the working tree is dirty, if `docs/PROJECT_STATUS.md` or the updated `AGENTS.md` rules are absent from the base, or if this prompt is not committed under `docs/prompts/`.

## Step 0 — Read before touching anything

1. **`AGENTS.md`** — the hard engineering rules and the verification checklist, including the updated generated-document rule (generated reports carry measurements and mechanically evaluated check results, never interpretive phase status) and the canonical-hash policy. Every rule applies: all randomness through `SeededRNG` in stable draw order; stats derive only from the `PlayByPlayEvent` stream; constants in `src/engine/constants.ts` with source annotations; targets never hand-edited; the `addXStats` stubs untouched.
2. **`docs/PROJECT_STATUS.md`** — the canonical baseline hashes and status conventions this unit must consume and update.
3. **`docs/ROADMAP.md`** §4.2 — the S2c2 definition ("The Stage-1 compensation unwind (S2c2's named duty)" and "Assist-definition decision (S2c2; inherited from S1 decision 6)" paragraphs) and the acceptance line: *"S2c2 reports the candidate play-type, zone-share, and assisted-zone consequences of the explicit mapping/unwind decision without activating it."*
4. **`docs/ROADMAP.md`** §4.1 decision 6 and §4.1a — the S1-Rb assisted sign-structure diagnosis and hand-off. This unit closes that hand-off.
5. **`scripts/diagnose-assists.ts`** — the existing diagnostic. Its classification of shots (chain-assisted; zero-pass; initial play type `spot_up`/`off_screen`) is built on the read-only **`onShot` diagnostic observer**, whose shot payload carries `initialPlayType`, `terminalPlayType`, `passCount`, zone, made, and assisted. **The remap cannot be reconstructed from `PlayByPlayEvent` alone** — `initialPlayType` and `passCount` are not event fields. Note also that the script currently hardcodes the active `data/` pool and seed 2026; Deliverable 1 fixes that.
6. **`src/engine/constants.ts`** — the `KNOWN STAGE 2 ARTIFACT` comment block above `PLAY_TYPE_SHOT_ZONES`. Verified current shape you should confirm on read: the shading is confined to **`cut`** (shipped rim 0.65 / short_midrange 0.35; comment: *"Real cut rim share is ~.75-.85; shaded toward short_midrange"*) and **`spot_up`** (shipped rim 0.07 / short_midrange 0.09 / long_midrange 0.05 / corner 0.34 / above_break 0.35 / deep 0.10; comment: *"Real spot-up rim share is ~.12-.15; shaded low"*). The other seven diets carry no shading note and are treated as already real. If your read contradicts this, **STOP AND SURFACE**.
7. **The S2c1 evaluation seam as shipped**: the `--league-dir` input on `profile-engine.ts`, the fact that `--league-dir` already engages **`CANDIDATE_PLAY_TYPE_SELECTION`** via the threaded, immutable **`PlayTypeSelectionConfig`** seam, `scripts/test-s2c1-r.ts`, and which artifacts `npm run build-league -- --check` now byte-compares. The new shot-zone-table selection extends this existing configuration seam — it must **compose with** the candidate selector, never replace or bypass it.
8. **`scripts/profile-engine.ts`** — the informational section already computes `assisted.*` per-zone rates and `playType.*` shares. Deliverable 1 extends that informational block; it does not build a parallel measurement.
9. **`docs/S2A_LEAGUE_COVERAGE.md`** / **`docs/S2B_RATINGS_CONTRACT.md`** — the generated-report conventions: provenance header, regenerate-never-hand-edit, `--check` byte-comparison. `scripts/build-league.ts` shows the house `StopAndSurface` pattern (throw before writing anything); reuse it.

## Step 0a — Hard preconditions (verify, then proceed or stop)

- **S2c1 (and S2c1-R) have landed and were accepted**: the seam exists, `--league-dir` engages the candidate play-type selection, and the candidate carries *derived* tendencies (real Synergy play-type frequencies), not S2a placeholders. If any of this is absent, **STOP AND SURFACE** — the unwind's premise is that S2c1 already moved the candidate's play-type distribution near the Synergy reference.
- **Baseline verification against the canonical hashes.** Capture with the banner-suppressed invocations:
  ```sh
  npm run profile --silent
  npm run calibrate --silent
  ```
  and verify SHA-256 against `docs/PROJECT_STATUS.md`'s established values:
  - profile: `7482a68d7859ff8c8f962832ff4978ba32621c700594fd4deae785e82759e95a`
  - calibrate: `a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4`

  A mismatch before any edit means your base is not the accepted state — **STOP AND SURFACE**. All later comparisons use the same `--silent` normalized capture.

---

## Deliverable 1 — the assist-definition decision

### The decision (made; restate it, do not reopen it)

The adopted mapping is the measurement-side **scorekeeper-aligned assisted proxy**, validated by S1-Rb's diagnosis:

> **Scorekeeper-aligned assisted proxy** = (chain-assisted makes) + (zero-pass makes whose initial play type was `spot_up` or `off_screen`).

Rationale, recorded in the decision document: the NBA scorekeeper credits catch-and-shoot makes as assisted even when the engine's strict pass-into-the-make chain does not (the shooter was the possession's initial actor). `scripts/diagnose-assists.ts` showed the chain's kick-out routing is correct (~90% of corner attempts terminate as spot-up catches) and that this remap **reproduces the observed per-zone sign structure** (corner 94.2% vs. real 96.7%, highest by a wide margin). The gap between the definitions is definitional, not mechanical. The decision record must state plainly that this is a **proxy that reproduces the observed sign structure, not a possession-level reconstruction of NBA scorekeeper decisions** — initial spot-up/off-screen makes are not guaranteed to have had a pass that would earn an official assist.

Explicit consequences, all stated in the decision document:

- **Engine assist-credit mechanics do not change.** The chain remains the only source of credited assists. Deliberately loosening the engine definition was considered and **not chosen**; if it is ever wanted, it is an **S3.g** engine-mechanics item. State this in exactly those terms — the roadmap requires the non-use of the loosening option to be explicit, never silent.
- **The enforced anchor does not change.** The box assist total (26.66/team-game) remains the only enforced chain constraint. Per-zone assisted rates remain INFORMATIONAL.
- **The proxy per-zone rates become the canonical informational comparison** to the NBA per-zone assisted-rate reference (corner three 0.967 ≫ all others); the sign-structure sanity check is henceforth evaluated on the proxy rates, with strict-chain rates reported alongside, labeled. The proxy rates are hereby **eligible to inform S2d's `PLAY_TYPE_PASS_RATE` retune** as reference data. No `PLAY_TYPE_PASS_RATE` value changes in this unit.

### Implementation

1. **Promote the existing read-only `onShot` provenance classification into a shared pure measurement module**, consumed by both `diagnose-assists.ts` and `profile-engine.ts` (place it where the profiling tools already share measurement helpers; verify the convention). The module consumes the diagnostic shot payload (`initialPlayType`, `terminalPlayType`, `passCount`, zone, made, assisted); it does not mutate simulation state, write stats, consume RNG, or change persisted `PlayByPlayEvent`. Strict-chain counts may be cross-checked against emitted events, but the proxy cannot be reconstructed from `PlayByPlayEvent` alone — do not pretend otherwise in comments or docs.
2. **Extend `scripts/diagnose-assists.ts`** to support the candidate league (`--league-dir`, composing with `CANDIDATE_PLAY_TYPE_SELECTION`), an explicit seed argument validated at the CLI boundary (the S1-Ra rule), and the candidate selector — removing the hardcoded active-pool path and seed 2026 as defaults-only rather than the only option.
3. **Extend `profile-engine.ts`'s informational assisted section** to print, per zone: strict chain rate, scorekeeper-aligned proxy rate, and the NBA reference, plus the mechanically evaluated sign-structure boolean on the proxy column (corner three highest by the largest margin — a deterministic numeric predicate, reported true/false, no prose verdict). **Permitted-diff rule:** full byte-identity of default `npm run profile --silent` is replaced for this unit by a constrained diff — every pre-existing line and number byte-identical to the Step-0a baseline; the *only* diff is the added informational assisted lines. Produce and inspect the actual diff of the normalized `--silent` captures; if any pre-existing number, the PASS status, or the exit code moves, stop — something leaked. Default `npm run calibrate --silent` remains fully byte-identical to the canonical hash.
4. **Write the decision document**: `docs/S2C2_ASSIST_DECISION.md`. A short declarative handwritten *decision record*, not a generated artifact: the proxy definition, the rationale with the diagnostic's numbers, the proxy-not-reconstruction caveat, the rejected alternative (engine loosening → S3.g, explicitly not chosen), the unchanged enforced anchor, and the S2d eligibility of the proxy rates.

---

## Deliverable 2 — the compensation unwind (candidate-scoped)

### Why this must not move the active pool

The shading exists because the *active* pool's play-type frequencies are skewed (cut and isolation over-selected; transition and PnR under-selected — hardcoded in `play-types.ts`, out of scope here), and fully real diets under that skew would land league rim share several points high. The active pool's Stage-1 profile PASS depends on the shaded table. S2c1's derived candidate tendencies remove the frequency skew **on the candidate only**. Therefore the real diets apply to the candidate evaluation path only; the shaded table remains what every default invocation simulates until S2d promotes the real one.

### The locked restoration values (fixed here, before any simulation)

These are **documented-range midpoint restoration values** — the artifact block's comments quantify only the real rim-share ranges, so this is a principled restoration into those ranges, not an independently harvested empirical diet. They are locked now and **do not move after observing candidate output**. If the locked table fails the vicinity check below, that is a stop-and-surface, not a license to retune.

- **`cut`**: rim **0.800**, short_midrange **0.200** (midpoint of ~.75–.85).
- **`spot_up`**: rim **0.130** (midpoint of ~.12–.15); long_midrange unchanged at **0.050**; the 0.060 added to rim is taken **proportionally from the four zones the shading inflated** — each scaled by (0.88 − 0.06)/0.88 and rounded to 3 decimal places, which sums exactly to 1.000:
  - short_midrange 0.09 → **0.084**
  - corner_three 0.34 → **0.317**
  - above_break_three 0.35 → **0.326**
  - deep_three 0.10 → **0.093**

Document the formula and the before/after table in the source annotation.

### Implementation

1. **Add `PLAY_TYPE_SHOT_ZONES_REAL`** in `src/engine/constants.ts`, built by spreading the existing table and overriding only `cut` and `spot_up` with the locked values above — the seven unshaded diets are structurally shared and cannot drift apart. Add a unit test asserting both tables' per-type weights sum to 1 (match the normalization tolerance implied by how `selectShotZone` actually consumes the weights — verify before asserting an invariant it doesn't have).
2. **Rewrite the `KNOWN STAGE 2 ARTIFACT` block — keep the history.** The rewritten comment states: the shaded table is the legacy-active compensation, kept solely for the active pool's Stage-1 PASS; `_REAL` is the candidate/S2d target carrying the S2c2 locked restoration (dated); **S2d promotes `_REAL` to the sole table and deletes the shaded one** — name S2d explicitly so the promotion cannot be forgotten or improvised.
3. **Table selection through the existing configuration seam.** Extend the immutable **`PlayTypeSelectionConfig`** that `--league-dir` already threads (or introduce a sibling typed configuration passed explicitly beside it — whichever the shipped seam's shape makes cleaner) with shot-zone-table selection, defaulting to the shaded table. Surface it on the profiling tools as `--shot-zones=real` (default shaded). The flag **composes with** `--league-dir`/`CANDIDATE_PLAY_TYPE_SELECTION`; it never replaces the candidate selector, and the candidate path always retains it. Hard requirements: no module-level mutable state, no environment-variable side channel, no change to the default path's draw order or output (proven by the Step-0a byte-identity and permitted-diff rules). If the shipped seam cannot carry this without out-of-scope ripple, **STOP AND SURFACE** with the shape you found.
4. **Report the candidate under real diets** via `--league-dir` + `--shot-zones=real`: the informational play-type distribution (terminal emitted `PlayByPlayEvent` types, per the Stage-1 measurement convention — never `selectPlayType` output) vs. the Synergy reference shares, and the six-zone + three-bucket shot-mix shares vs. the `docs/LEAGUE_TARGETS.md` references and bands. The seed is an explicit recorded input per Deliverable 3's seed rule; deterministic.

### The unwind's evidence bar and its stop condition

The roadmap defines success as the candidate's informational play-type table sitting in the **vicinity of the Synergy shares** while its **zone shares remain reportable** under the real diets. This is informational reporting — S2d owns the enforced PASS — with a named predicate check, not an unconditional halt: for every candidate zone share, compute |Δ| against its `docs/LEAGUE_TARGETS.md` target. **If any zone share has |Δ| > 2·tol, produce the full delta table plus a read-only decomposition of the downstream shot-zone modifiers. Do not retune** (the locked values do not move). Interpretation, stated precisely: such a failure indicates that the locked diet restoration and the candidate's downstream shot-selection inputs — player-level rim/mid/three tendencies (S2b-derived), shooter-ability modifiers in `selectShotZone`, spacing/rim-deterrence effects, the global three-point dampener — do not *jointly* hold the zone mix near its reference. It does **not**, by itself, reopen S2c1-R (terminal play-type selection is already proven aligned) or prove play-type selection is responsible.

**Outcome routing, decided from the decomposition:**
- If the decomposition attributes the residual to **downstream shot-selection inputs** (tendencies, ability multipliers, dampener — constants and derived inputs that S2d's coupled re-tune owns by definition), **S2c2 completes**: commit the report with the measured deltas and predicate outcomes, and add an explicit handwritten roadmap note assigning the residual to S2d's retune. This is the expected path — the pre-existing zone-mix gap under the *shaded* diets already implicates the downstream inputs, not the diets.
- If the decomposition implicates the **locked diets themselves** (e.g., the restoration values are directionally wrong per the decomposition, not merely insufficient) or a **Stage 3 selection mechanism**, **STOP AND SURFACE** with the decomposition — that is a design conversation, not an S2d tuning task.

Inside the envelope, report the deltas and proceed; S2d's retune absorbs residuals of that size.

**Note the known prior:** the candidate's zone mix under the *shaded* diets already sits well outside the envelope (observed rim −5.5pp, short-mid +5.7pp, mid bucket +9.5pp). The locked restoration contributes roughly +2.6pp rim at Synergy-aligned frequencies, so the predicate is expected to fail on the real-diet run with the residual attributed downstream. Treat that expected outcome with full rigor anyway — run the decomposition, verify the attribution, and route per the rules above rather than assuming the conclusion.

---

## Deliverable 3 — the generated report

One committed generated artifact: **`docs/S2C2_ASSIST_AND_DIET_REPORT.md`**. Prefer extending the candidate-report path S2c1 shipped over creating a parallel script; if a new script is cleaner, `scripts/report-s2c2.ts` run via `tsx`. Conventions per the S2A/S2B reports: provenance header, regenerate-never-hand-edit, `--check` byte-comparison mode joining whatever check set S2c1 left.

**Provenance must not be self-referential.** The report will itself be committed, so reading live `HEAD` at generation time would make every post-commit `--check` regeneration differ. The provenance header records the **immutable implementation base commit, supplied explicitly to the generator as an argument** — never `git rev-parse HEAD` during regeneration. (Alternative if simpler: omit the commit SHA entirely and record input paths, input hashes, seed, and invocation.)

**The seed is concrete, not aspirational.** `profile-engine.ts` currently fixes seed 2026 internally. Either extend it with `--seed <n>` (validated at the CLI boundary per the S1-Ra rule, default 2026 so default output is unchanged), or have `report-s2c2.ts` own the explicit validated seed and run the candidate simulation directly. Whichever path, the seed used is an explicit recorded input, and the same seed twice yields a byte-identical report.

**Generated-document rule (binding):** the report contains **measurements and mechanically evaluated check results only** — targets, tolerances, deltas, and each deterministic numeric predicate's true/false outcome. It must **not** contain interpretive phase status: no "unwind accepted", no "S2c2 complete", no "S2d unblocked", no verdict prose. Acceptance interpretation lives in the handwritten `docs/ROADMAP.md` and `docs/PROJECT_STATUS.md` updates.

Contents:

1. Candidate play-type distribution (real diets active) vs. Synergy reference shares, with deltas.
2. Candidate six-zone and three-bucket shot-mix shares vs. targets, with deltas, bands, and the per-zone |Δ| ≤ 2·tol predicate results. If any predicate is false, the report also carries the read-only downstream-modifier decomposition **as measurements** (per-modifier contributions, no attribution prose); the attribution and outcome routing are interpretation and live in the handwritten roadmap note.
3. Per-zone assisted rates on the candidate: strict chain, scorekeeper-aligned proxy, NBA reference — side by side, with the sign-structure predicate result on the proxy column.
4. The pass-count distribution and per-zone zero-pass / catch-and-shoot-zero-pass shares, from the shared measurement module.
5. The `cut`/`spot_up` before/after weight table, the redistribution formula, and the locked-values provenance (documented-range midpoints).
6. The permitted-diff record for the default profile output (the exact added lines), the Step-0a canonical hashes verified, and the new post-S2c2 profile hash.
7. A link to `docs/S2C2_ASSIST_DECISION.md` (the handwritten decision record).

Same seed twice → byte-identical report.

---

## Determinism and byte-identity requirements

- Default `npm run calibrate --silent`: **byte-identical** to the canonical hash in `docs/PROJECT_STATUS.md`.
- Default `npm run profile --silent`: **constrained diff only** vs. the canonical baseline — every pre-existing line byte-identical; the sole additions are the informational assisted lines from Deliverable 1; PASS status and exit code unchanged. Record the diff and compute the new accepted profile hash.
- `tsx scripts/test-determinism.ts` — green.
- `tsx scripts/test-spacing-ab.ts` — green (no spacing math is touched; standing checklist).
- **`tsx scripts/test-s2c1-r.ts` — green**: the candidate selector is a prerequisite and the new configuration plumbing must not regress it.
- One same-seed repeat run of the `--league-dir` + `--shot-zones=real` path — byte-identical.
- `tsx scripts/validate-nba-data.ts` — green (no new contracts consumed; must stay green).
- No new `Math.random`, no `Date.now`, no timestamps in generated artifacts; sorted iteration and fixed formatting per the house style in `build-league.ts`.

## Out of scope (hard)

- **No activation.** `data/players.json`, `data/teams.json`, and every default runtime input untouched. S2d is the sole activation point.
- **No engine assist-credit mechanics change** (S3.g owns loosening; explicitly not chosen).
- **No `PLAY_TYPE_PASS_RATE` changes** — eligibility established, retune is S2d's.
- **No `play-types.ts` frequency changes** — the active pool's selection skew is a named Stage-1 condition; the candidate's fix arrived via S2c1's derived tendencies.
- **No post-observation movement of the locked diet values** — outcome-based re-shading of the real table is prohibited; a vicinity failure is a stop, not a tuning pass.
- **No target or tolerance edits** (`derive-league-targets.ts`, the transcribed `TARGETS`, `docs/LEAGUE_TARGETS.md` untouched). No re-tiering — per-zone assisted rates stay INFORMATIONAL.
- **No spacing/versatility re-baselining, no `spacing.ts` changes, no schema changes** (shapes stable; a needed bump is a stop-and-surface).
- **No deletion of the shaded table** — S2d's promotion step.
- Do not touch `download-history.ts`/`calibrate-history.ts`, the `addXStats` stubs, or anything from a later phase.

## Stop-and-surface conditions (halt via the `StopAndSurface` pattern, report, wait)

1. Preflight failure: dirty tree, wrong base branch, missing prompt archive, or missing updated rules/status docs.
2. Step-0a canonical-hash mismatch before any edit.
3. S2c1/S2c1-R seam or derived candidate tendencies absent, or shaped so differently that the `PlayTypeSelectionConfig` extension doesn't apply.
4. The `KNOWN STAGE 2 ARTIFACT` block contradicts Step 0 item 6 (shading not confined to `cut`/`spot_up`, or the quantified rim ranges absent).
5. The configuration seam cannot carry the table parameter without out-of-scope ripple.
6. The zone-share predicate fails (any candidate zone share |Δ| > 2·tol under the locked real diets) **and the read-only downstream-modifier decomposition implicates the locked diets themselves or a Stage 3 selection mechanism** — surface with the delta table and decomposition. If the decomposition attributes the residual to downstream shot-selection inputs (the expected outcome given the pre-existing gap under shaded diets), this is **not** a stop: S2c2 completes with the report and the handwritten roadmap note assigning the residual to S2d's retune. Either way, the diets are never retuned and S2c1-R is not reopened.
7. The default-path constrained diff shows any pre-existing number, PASS status, exit code, or calibrate byte moving.
8. Any other conflict between this prompt's assumptions and source reality — stop and report; never silently reconcile.

## Documentation (after acceptance, same commit series — handwritten, and this is where interpretation lives)

- **`docs/PROJECT_STATUS.md`**: record the new accepted post-S2c2 profile hash (from the `--silent` capture) replacing the superseded one; calibrate hash unchanged; note S2c2's acceptance and the dual-table state.
- **`docs/ROADMAP.md`**: mark the assist-definition hand-off (§4.1 decision 6 / §4.1a residual, §1.3 ledger item on the shading) **resolved by S2c2** with a pointer to `docs/S2C2_ASSIST_DECISION.md`; update priority-table row 2c; record the dual-table state and S2d's named promotion duty in the S2d unit description. **If the zone-share predicate failed with a downstream attribution, add the handwritten residual note here**: the measured deltas, the decomposition's attribution, and the explicit assignment of the residual to S2d's coupled re-tune — this note is the interpretation the generated report is forbidden to carry.
- **`AGENTS.md`**: one guard sentence pointing at the rewritten artifact block so no agent "simplifies" the two tables into one before S2d.
- No README changes — nothing user-facing shipped.

## Acceptance checklist (ordered; status is earned by these runs, not by artifact existence)

1. Preflight (Step −1) satisfied; prompt committed under `docs/prompts/`.
2. `npm run typecheck` — clean.
3. Step-0a canonical hashes verified pre-edit and recorded in the report's provenance section.
4. `npm run profile --silent` (default) — PASS, exit 0, constrained diff verified and recorded; new accepted hash computed.
5. `npm run calibrate --silent` (default) — byte-identical to the canonical hash.
6. `tsx scripts/test-determinism.ts`, `tsx scripts/test-spacing-ab.ts`, `tsx scripts/test-s2c1-r.ts` — green.
7. `tsx scripts/validate-nba-data.ts` — green.
8. Table-invariant test (both tables, per-type weight normalization) — green.
9. `npm run build-league -- --check` — byte-identical: the derived candidate and its existing generated contracts were not accidentally changed by the configuration work. Runs before any candidate simulation.
10. `--league-dir` + `--shot-zones=real` same-seed repeat run — byte-identical; report `--check` byte-idempotent.
11. Report content review: play-type vs. Synergy, zone shares with per-zone predicates (outcome routing per the evidence-bar rules — decomposition present as measurements if any predicate failed), three-column assisted rates with the sign-structure predicate, cut/spot_up before/after with locked-values provenance, permitted-diff record and hashes, pinned base-commit provenance (no live `HEAD`) — all present; **no interpretive status anywhere in the generated artifact**.
12. `docs/S2C2_ASSIST_DECISION.md` committed; `docs/PROJECT_STATUS.md` (new profile hash + acceptance note), `docs/ROADMAP.md`, and `AGENTS.md` updates in the same commit series as the code they describe.

Commit structure (adjust only if the work argues otherwise; keep the decision/measurement separable from the diet table): **commit 1** — shared measurement module + `diagnose-assists.ts` extension + decision doc + profile informational extension + permitted-diff record; **commit 2** — `PLAY_TYPE_SHOT_ZONES_REAL` with locked values, artifact-block rewrite, configuration-seam extension, candidate report; **commit 3** — PROJECT_STATUS/roadmap/AGENTS documentation.
