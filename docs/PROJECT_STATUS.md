# Project status — verified snapshot

> **Date:** 2026-07-12 · **Commit:** `67cb8f0` + the S2c2-R measurement repair (verified pre-commit on the working tree) · **Save schema:** v7 · **NBA data schema:** 3
>
> This file answers "where is the project right now?" with executable evidence. It owns
> **nothing else**: `AGENTS.md` (hard rules) > `docs/TRANSACTIONS_ROADMAP.md` (transaction
> phase contracts) > `docs/ROADMAP.md` (global sequencing and phase specs) all take
> precedence, and this file never restates their content — it points at it. Statuses here
> follow the roadmap's maintenance rule: **earned by reported acceptance runs, never
> inferred from artifacts.** Update this file when a phase lands or a fresh verification
> run changes the picture; correct stale entries with evidence rather than silently
> rewriting them.

## Verification evidence (2026-07-12 run)

All commands run on the S2c2-R working tree atop `67cb8f0` on the working machine
(node v24.17.0 via nvm — not on PATH by default;
`export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"` first).

| Command | Result | What it proves |
|---|---|---|
| `npm run typecheck` | clean | compiles |
| `npm run profile --silent` | **PASS, exit 0**; stdout SHA-256 `74460aa472a3c2bcfa9dabc90aee6c4abbe5e1e2dd3aff87bd811b54cfbf1848` — byte-identical to the post-S2c2 baseline below | the engine acceptance test holds, and S2c2-R's `explainShotZoneSelection` extraction is FP-identical over the full 1,290-game season |
| `npm run calibrate --silent` | exit 0; stdout SHA-256 `a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4` matches the recorded reference | drift comparison unchanged (informational by design — its benchmark ends 2015) |
| `node --import tsx scripts/test-determinism.ts` | PASS — 4 seeds, box-score and play-by-play hashes identical | same seed → identical game |
| `node --import tsx scripts/test-spacing-ab.ts` | PASS | spacing effect present and correctly signed |
| `node --import tsx scripts/test-s2c1-r.ts` | PASS — S2c2 dual-table invariants OK; seeds 2026/7/42, total abs play-type error 4.3/4.3/4.1 pp; default-legacy output hashes OK (S2c2 appendix stripped) | candidate selector terminal bands hold; both shot-zone tables normalize and stay structurally shared; the active default is guarded byte-identical |
| `node --import tsx scripts/validate-nba-data.ts` | 211 passed, 0 failed, 80 skipped | normalized NBA contracts intact |
| `npm run build-league -- --check` | candidate pool + S2A/S2B/S2C1 generated docs byte-identical | the S2c2-R configuration work changed no candidate artifact |
| `node --import tsx scripts/report-s2c2.ts --base-commit=67cb8f0 --check` | byte-identical (re-runs all four deterministic seasons) | the S2c2 measurement report is regenerable and deterministic |
| `scripts/diagnose-s2c2-zones.ts` same-seed repeat | byte-identical | the decomposition diagnostic is deterministic |

Earlier per-phase harness evidence (seed-boundary, save-migration, phase-5b) stands as
recorded in the 2026-07-11 run at `21fe8e6`; nothing in S2c2/S2c2-R touches those
surfaces.

### Current byte-identity baselines (active pool)

Capture with `npm run <cmd> --silent > out` — **the npm run banner poisons hashes
without `--silent`.** Non-engine phases must reproduce these exactly; engine phases
record their new post-acceptance values here in the same change.

- `npm run profile --silent` stdout SHA-256:
  `74460aa472a3c2bcfa9dabc90aee6c4abbe5e1e2dd3aff87bd811b54cfbf1848` (exit 0; S2c2's appended informational proxy table is the only permitted change)
- `npm run calibrate --silent` stdout SHA-256:
  `a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4` (exit 0)

**Limitations of this evidence:** `profile`, `calibrate`, and the harnesses consume the
**gitignored** `data/` artifacts on the working machine (active pool `data/players.json`
last modified 2026-07-01, `data/teams.json` 2026-06-27, history CSVs 2026-06-24,
`data/nba/normalized/` from the OP-1 harvest). All byte-identity claims are relative to
that data state; a bare clone cannot reproduce them without regenerating/harvesting the
same artifacts. The candidate league (`data/league-candidate/`) and its three generated
contracts are `--check`-gated via `npm run build-league`; the S2c2 measurement report is
separately `--check`-gated via `node --import tsx scripts/report-s2c2.ts
--base-commit=<base> --check` (re-runs four full deterministic seasons; S2d retires or
regenerates it at activation — ROADMAP §4.2). The *active* pool has no equivalent
committed hash manifest.

## Where each track stands

Statuses per `docs/ROADMAP.md` §3.2 (the authoritative sequence), verified against
source and the runs above.

| Track | Verified state | Next unit |
|---|---|---|
| **S — Simulation & data** | S1 accepted. S2a through **S2c2** are done on the **inactive candidate**. S2c2 records the scorekeeper-aligned proxy and keeps dual shot-zone tables candidate-scoped; the **S2c2-R repair (2026-07-12)** closed its measurement gaps — mechanical 2·tol predicates, the modifier decomposition earning the S2d attribution, dual-table invariants in `test-s2c1-r.ts`, and the `--shot-zones=real` guard; see `docs/S2C2_ASSIST_AND_DIET_REPORT.md`. | **S2d** — sole activation and coupled re-baseline/retune point. S3 remains gated on S2d. |
| **F — Franchise** | F1 done (schema v7, `SaveFile.controlledTeamId`, accessors in `src/franchise/controlled.ts`; save-migration harness green today). | **F2 — playoffs** is dependency-ready now (ROADMAP §5.2); F3 → F4 → F5 follow in order. |
| **T — Transactions** | Phases 1–5b implemented; Phase 5b harness green today. `evaluateTradeForCpu` remains the documented accept-all stub. | **T-5c** is the next transaction unit but is **hard-gated on S2d + F2 + F3 + F4c + F5** — not startable yet. |
| **U — Presentation** | App shell only: menu (saves/new game/team picker), league, roster, schedule+standings, player detail, single-game sim; API routes for players/teams/season/sim/saves. No transaction UI, no playoffs UI, no offseason flow. | U1 is pinned to T-7. Read-only UI items (box-score viewer, leaders) may slot anytime per ROADMAP §7. |
| **Pipeline (Stage 0/OP-1)** | Built and harvested; `npm run validate-nba-data` green in the recorded 2026-07-06 run. Manual, residential-IP, working-machine-only by design. | Only re-harvests (runbook in ROADMAP §4.0). |

## Gates and blockers

- **Nothing currently in flight is blocked.** The two startable units are **S2d**
  (Track S) and **F2** (Track F); per ROADMAP §3.2 ∥-rule they must land sequentially,
  not on concurrent branches.
- **S3** (engine mechanics from richer data) is blocked until **S2d** activates the
  candidate pool.
- **T-5c and everything after it** (trade AI, ecosystem, RFA, draft) is blocked on the
  full pre-baseline chain S2d → F2 → F3 → F4c → F5.
- Do **not** activate the candidate league outside S2d — the evaluation-only seam is a
  hard guard (`AGENTS.md` invariants; `PlayTypeSelectionConfig` in
  `src/engine/play-types.ts` is threaded explicitly, never inferred).

## Known documentation drift (as of 2026-07-11)

1. **RESOLVED 2026-07-11 — `docs/S2C1_R_SELECTION_DIAGNOSIS.md` "Verdict" was stale.**
   It read "S2c2 remains blocked" (a string hardcoded in the generator) while ROADMAP
   recorded S2c2 as unblocked. Fixed by replacing the generator's verdict with a neutral
   measurements-and-provenance-only pointer (`scripts/diagnose-s2c1-selection.ts`) and
   regenerating the artifact; the regeneration diff touched **only** the provenance
   commit stamp and the verdict line — every measurement was byte-identical, re-proving
   the generator's determinism. The no-interpretive-text-in-generated-docs rule is now
   codified in `AGENTS.md` ("What not to do").
2. **README refreshed 2026-07-11** (this pass): added the `npm run build-league` row and
   the S2-era docs to the project tree — it previously predated S2a (last touched at R0b,
   commit `d185824`, 2026-07-06).
3. **RESOLVED 2026-07-11 — `docs/prompts/` archive discipline lapsed after F1.** No
   prompts were committed for S2a, S2b/S2b-R, S2c1, or S2c1-R (last prompt commits: R0b
   `d185824`, F1 `1e71570`). Decision implemented: the discipline **resumes at S2c2**;
   the gap is recorded as history in `docs/prompts/README.md` and ROADMAP §0 — the lost
   prompts are not reconstructable and are not to be back-filled from memory.
4. **RESOLVED 2026-07-12 — S2c2's acceptance was partially self-certified (S2c2-R).**
   The S2c2 landing (`67cb8f0`) skipped its spec's failure-path decomposition despite
   five zone-share rows exceeding 2·tol, left the predicate evaluation to the reader,
   shipped no table-invariant test, ran the report's pass-provenance section under
   shaded diets while labeling it real, and left this file's evidence table and gates
   stale. S2c2-R repaired all of it: `scripts/diagnose-s2c2-zones.ts` (stage
   decomposition via the new pure `explainShotZoneSelection`, FP-identity proven by the
   unchanged profile hash), mechanical predicates + exact permitted-diff lines in the
   regenerated report, dual-table invariants in `test-s2c1-r.ts`, `--shot-zones=real`
   guards on the profiling tools, shared-module classification in
   `diagnose-assists.ts`, and the resolution markers in ROADMAP §1.3/§1.4/§4.1/§4.2.
5. **Documentation-structure pass (2026-07-11):** ROADMAP's per-revision change logs
   (revisions 2–8) moved verbatim to `docs/ROADMAP_HISTORY.md` (§ numbering untouched);
   `CLAUDE.md` gained the session quickstart (reading order, nvm PATH, `tsx` fallback,
   `data/` warning) and the docs map with authority levels; `AGENTS.md`'s verification
   checklist gained expected outputs/runtimes and the SHA-256 baseline discipline; the
   §10 template and the transactions acceptance checklist now require updating this file
   in the same diff.

## Repository hygiene notes (non-blocking)

- 17 local branches are fully merged into main and can be pruned (e.g.
  `feat/lineup-spacing`, `fix/s1ra-seed-boundary`, `agent/s2b-r-ratings-repair`).
- 4 local branches are unmerged but superseded or abandoned: `feat/team-selection`
  (superseded by F1), `feat/multi-save-system` (content landed; stale tip),
  `codex/fix-pipeline-harvest-safety` (schema-v2 bump; main is at contract schema 3),
  and `feat/s2a-league-builder` whose tip `264f526` removes calls to the intentional
  no-op `addXStats` stubs — behavior-neutral and consistent with `AGENTS.md`'s
  "leave the stubs alone" rule; confirm before deleting.
- Deleting branches is a maintainer action; none of this blocks any phase.

## What was deliberately *not* created

A separate decision log and workstreams doc were considered and rejected: settled
decisions live in ROADMAP §2 (north stars), §9 (invariants), the per-revision header
changelog, and the phase outcome records; tracks/dependencies live in §3.1–§3.3. A
second copy would create the dual-source-of-truth failure mode Appendix A #11 exists to
catch. If ROADMAP ever splits, revisit.
