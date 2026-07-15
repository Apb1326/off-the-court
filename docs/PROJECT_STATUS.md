# Project status — verified snapshot

> **Date:** 2026-07-15 · **Merged F2 implementation:** `694886f` · **Accepted repair:** `33e4926`, merged to `main` by `c8e4b46` · **Save schema:** v8 · **NBA data schema:** 3
>
> This file answers "where is the project right now?" with executable evidence. It owns
> **nothing else**: `AGENTS.md` (hard rules) > `docs/TRANSACTIONS_ROADMAP.md` (transaction
> phase contracts) > `docs/ROADMAP.md` (global sequencing and phase specs) all take
> precedence, and this file never restates their content — it points at it. Statuses here
> follow the roadmap's maintenance rule: **earned by reported acceptance runs, never
> inferred from artifacts.** Update this file when a phase lands or a fresh verification
> run changes the picture; correct stale entries with evidence rather than silently
> rewriting them.

## Verification evidence (2026-07-14; repair merged 2026-07-15)

### F2 playoffs acceptance repair (accepted and merged)

`694886f` merged the initial F2 implementation but it was not accepted. Repair commit
`33e4926` restores the original contract and merge `c8e4b46` carries it on `main`:
regular-season output is byte-identical to `349575c`;
all completed games live in one append-only `results` ledger; series wins, winners,
status, and champion are derived from bracket construction plus that ledger; candidate-v8
mirrors are canonicalized at the save boundary; and injury history is immutable onset
evidence with its missed-game count derived from results. The live 86-game-per-team
schedule remains at its 1,290-game regular boundary.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS (clean) |
| `node --import tsx scripts/test-playoffs.ts` | PASS — exact `349575c` regular projection SHA, seed-2026 same-date order, regular invalid-roster compatibility, atomic playoff failure/retry, rest boundary, derived champion, replay idempotence, one-shot/day-by-day byte identity |
| `node --import tsx scripts/test-save-migration.ts` | PASS — v7 ownership-before-playoff-stat migration, candidate-v8 mirror reconciliation, duplicate/conflicting result rejection, legacy completion, and second-run byte identity |
| `node --import tsx scripts/test-saves.ts` | PASS — mid-playoff full save → reload → resume byte identity plus derived champion metadata |
| `node --import tsx scripts/test-season-monotonic.ts` | PASS |
| `node --import tsx scripts/test-determinism.ts` | PASS — four seeds identical |
| `node --import tsx scripts/test-spacing-ab.ts` | PASS — +6.5pp rim, +2.9pp TS |
| `node --import tsx scripts/test-injuries.ts` | PASS — same-seed immutable onset histories identical; 9.52 derived missed games/player through the completed postseason |
| profile stdout | PASS 32/32; before = after SHA-256 `c37dfded336b446e344f592e97a8c913aea2d4894602d86b06b3d5392de5438e` |
| calibrate stdout | exit 0; before = after SHA-256 `5d097b907f7869ff9fc97c4c82778fe1b66354008bb38cc479ad262491c4b8c7` |
| `npm run build` | PASS on Next.js 16.2.9 (existing broad-data-pattern warnings only; initial sandbox-only font fetch failed, approved-network rerun passed) |

Regular-season A/B projection (`currentDate`, `gamesPlayed`, ordered `results`,
`standings`, `playerStats`, `injuries`, `recoveries`; excluding F2-only playoff state
and the intentionally changed injury-history representation): `349575c` = repair =
SHA-256 `715ba6504be40472df855565061703710a4186a656a81354fdb02c06397d5800`.

## Earlier S2d verification evidence

The S2d correction landed as `071fd5a` and was merged to main at `349575c`. It adds
one runtime production-pool gate shared by new-game
creation and activation-context checks: the exact active JSON pair is read once,
structurally validated (including complete `rotation.minuteTargets`), required to use
NBA-derived IDs, hash-matched to the builder-owned manifest, and matched to the sole
selector/table identities. The builder no longer executes the retired heuristic
ratings/tendency derivation before overwriting its values. The historical
`test-s2c1-r.ts` filename now tests the active production terminal-event contract.

### Correction verification (before/after)

All commands below ran on the same ignored active data pair; no data artifact was
regenerated. Profile and calibrate output were byte-identical before and after the
correction (zero numerical deltas).

| Command | Result |
|---|---|
| `npm run typecheck` | PASS (clean) |
| `node --import tsx scripts/build-league.ts --check` | PASS — promotion invariants, manifest/production identities, and both active JSON files byte-identical |
| `npm run profile` | PASS (32/32 enforced); before = after stdout SHA-256 `c37dfded336b446e344f592e97a8c913aea2d4894602d86b06b3d5392de5438e` |
| `npm run calibrate` | PASS (exit 0); before = after stdout SHA-256 `5d097b907f7869ff9fc97c4c82778fe1b66354008bb38cc479ad262491c4b8c7`; engine row unchanged at 114.0 PTS/tm, SD 12.3, margin 12.3, home 58.5% |
| `node --import tsx scripts/test-determinism.ts` | PASS — seeds 42, 7, 123, and 2026 each produced identical box-score and play-by-play hashes on repeat |
| `node --import tsx scripts/test-spacing-ab.ts` | PASS — rim-attempt delta +6.5 points; true-shooting delta +2.9 points |
| `node --import tsx scripts/test-s2c1-r.ts` | PASS — production manifest/identity and synthetic/mismatched-pool rejection checks; active terminal total absolute errors: seed 2026 4.55pp, seed 7 4.43pp, seed 42 4.28pp (each within 6.00pp) |

Active-pair proof for every correction run: `teams.json`
`9fded301cb4930eec5f155329619ca7278edffb0c1e9e6e7ffe472aa0b20bee9`,
`players.json` `47364273b7622aaed1a11d2b966f2adac7d3c1f23b254bdc0345aef61ae19b24`;
selector `nba-derived-tendency-selector-v1`; table `PLAY_TYPE_SHOT_ZONES`;
manifest `verified`. These measurements/provenance remain the accepted S2d baseline.

### Activation acceptance evidence (pre-correction)

All commands run on the prior S2d activation working tree on the working machine
(node v24.17.0 via nvm — not on PATH by default;
`export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"` first; the sandboxed
`tsx` CLI cannot open its IPC pipe here, so npm-wired commands were run through the
documented equivalent `node --import tsx <script>`, whose stdout is the same script
stdout `npm run <cmd> --silent` captures).

| Command | Result | What it proves |
|---|---|---|
| `npm run typecheck` | clean | compiles |
| `npm run profile --silent` | **PASS (32 of 32 enforced), exit 0**; stdout SHA-256 `c37dfded336b446e344f592e97a8c913aea2d4894602d86b06b3d5392de5438e`; prints the `S2D ACTIVATION CONTEXT — VERIFIED` banner (pool SHAs + selector/table ids + manifest check) before the tables | the S2d acceptance: the engine profile passes on the **activated NBA-derived pool** under the sole production selector and shot-zone table, with the run's pool context proven, not assumed |
| `npm run calibrate --silent` | exit 0; stdout SHA-256 `5d097b907f7869ff9fc97c4c82778fe1b66354008bb38cc479ad262491c4b8c7`; engine row 114.0 PTS/tm, SD 12.3, margin 12.3, home 58.5% vs the 2010-2015 era's 99.3 / 11.9 / 11.0 / 59.2 | drift comparison re-based on the activated pool: the engine sits ~15 pts above the 2015-ending benchmark **by design** (tuned to 2023-26 scoring); spread/margin/home land in era range. Calibrate now runs the same activation-context gate as profile |
| `node --import tsx scripts/test-determinism.ts` | PASS — 4 seeds, box-score and play-by-play hashes identical | same seed → identical game on the activated pool |
| `node --import tsx scripts/test-spacing-ab.ts` | PASS | spacing effect present and correctly signed on the re-derived baselines |
| `node --import tsx scripts/test-defense-ab.ts` | PASS — z ordering 1.77 > 0.78 > −1.92, zGap 3.69, huntGap 0.300 (fixtures rescaled to the activated pool's rating scale) | versatility keys on the weak link, not the mean, on the re-derived baselines |
| `node --import tsx scripts/test-s2c1-r.ts` (S2d activation harness) | **PASS** — activation-context banner; seeds 2026/7/42 terminal total abs error **4.55 / 4.43 / 4.28 pp**, all inside the predeclared 6.00 pp band (seed 7 included — no band widening was needed); FT inverse round-trip + endpoint clamps asserted; profile rejects `--league-dir`/`--shot-zones`; `build-league --check` byte-identical; schema-v7 save load does not rewrite player snapshots | the activated selector's terminal play-type distribution holds the predeclared band on every predeclared seed, and the production interface is sole and unconfigurable |
| `node --import tsx scripts/test-build-league.ts` | PASS — hermetic `--out-dir` scratch build; 30 teams / 582 players / 450 rostered; byte-idempotent rebuild incl. the promotion manifest; live `data/` pair proven untouched by hash | builder determinism and the S2b statistical contract hold without side effects on the live pool |
| `npm run build-league -- --check` | active pair + promotion manifest byte-identical to a fresh in-memory build | the on-disk active pool is exactly the deterministic builder's output |
| Interrupted-promotion recovery simulation | crash-between-renames heals on `--check`; journal-only (completed promotion) cleans up quietly; journal with no staged copy and an incomplete pair stops with exit 2 and a manual-restore message | the two-file promotion is journaled and self-healing on every builder entry point |

Earlier per-phase harness evidence (seed-boundary, save-migration, phase-5b) stands as
recorded in the 2026-07-11 run at `21fe8e6`; S2d does not touch those surfaces
(`validate-nba-data` last green in the recorded 2026-07-12 preflight — S2d reads,
never writes, `data/nba/normalized/`).

### Current byte-identity baselines (activated pool)

Capture with `npm run <cmd> --silent > out` — **the npm run banner poisons hashes
without `--silent`** (or the sandbox-equivalent `node --import tsx <script> > out`).
Non-engine phases must reproduce these exactly; engine phases record their new
post-acceptance values here in the same change.

- `npm run profile --silent` stdout SHA-256:
  `c37dfded336b446e344f592e97a8c913aea2d4894602d86b06b3d5392de5438e` (exit 0; begins with the activation-context banner)
- `npm run calibrate --silent` stdout SHA-256:
  `5d097b907f7869ff9fc97c4c82778fe1b66354008bb38cc479ad262491c4b8c7` (exit 0; begins with the activation-context banner)
- Active pool: `data/teams.json` SHA-256
  `9fded301cb4930eec5f155329619ca7278edffb0c1e9e6e7ffe472aa0b20bee9`,
  `data/players.json` SHA-256
  `47364273b7622aaed1a11d2b966f2adac7d3c1f23b254bdc0345aef61ae19b24` —
  recorded in the machine-local promotion manifest `data/.league-manifest.json`
  (written atomically by `npm run build-league`; verified by every profile/calibrate run).

**Limitations of this evidence:** `profile`, `calibrate`, and the harnesses consume the
**gitignored** `data/` artifacts on the working machine (activated pool promoted from
`data/nba/normalized/` via `npm run build-league`, history CSVs 2026-06-24,
`data/nba/normalized/` from the OP-1 harvest). All byte-identity claims are relative to
that data state; a bare clone cannot reproduce them without regenerating/harvesting the
same artifacts. The active pool is integrity-anchored by the promotion manifest
(pair hashes + production selector/table identities); deep builder byte-identity remains
`npm run build-league -- --check`. The retired S2 generators' reports
(`docs/S2A_LEAGUE_COVERAGE.md`, `S2B_RATINGS_CONTRACT.md`, `S2C1_TENDENCIES_CONTRACT.md`,
`S2C1_R_SELECTION_DIAGNOSIS.md`, `S2C2_ASSIST_AND_DIET_REPORT.md`) are frozen historical
evidence — their generators were deleted or stopped writing them at S2d activation.

## Where each track stands

Statuses per `docs/ROADMAP.md` §3.2 (the authoritative sequence), verified against
source and the runs above.

| Track | Verified state | Next unit |
|---|---|---|
| **S — Simulation & data** | S1 accepted. S2a–S2c2 done, and **S2d landed (2026-07-14)**: the NBA-derived pool/selector/diets are the sole production path (legacy BDL ingest, seed-test, candidate seams, and the shaded/`_REAL` dual table all retired); baselines re-derived (`calibrate-spacing` now also derives versatility); the coupled retune re-passed the profile **32/32** on the activated pool; the promotion manifest + activation-context gate anchor every gated run; the predeclared 6.00 pp selector band held on all three seeds (4.28–4.55 pp — the earlier seed-7 failure was resolved by the selector/pass-rate retune, no band change); the spacing baseline is derived with the shared production finisher-selection weight (`primaryPlayerWeight`), and the builder harness asserts spreads against the frozen `S2B_TARGET_SDS` contract, never the mutable live pool. The S3 execution roadmap and first-tranche prompts were authored 2026-07-15; no S3 runtime work has landed. | **S3.a** — historical lineup-model validation; S3.b1 → S3.b2 → S3.c1 follow only after sequential acceptance. |
| **F — Franchise** | F1 done; **F2 accepted and merged** (`33e4926` via `c8e4b46`; schema v8, ledger-derived deterministic playoffs/champion, migration/save/playoff harnesses green). | **F3 — multi-season seam**; F4 → F5 follow in order. |
| **T — Transactions** | Phases 1–5b implemented; Phase 5b harness green today. `evaluateTradeForCpu` remains the documented accept-all stub. | **T-5c** is the next transaction unit but is **hard-gated on S2d + F2 + F3 + F4c + F5** — not startable yet. |
| **U — Presentation** | App shell plus the F2 bracket/champion view: menu, league, roster, season standings/leaders/playoffs, player detail, single-game sim; API routes for players/teams/season/sim/saves. No transaction UI or offseason flow. | U1 is pinned to T-7. Read-only UI items (box-score viewer, leaders) may slot anytime per ROADMAP §7. |
| **Pipeline (Stage 0/OP-1)** | Built and harvested; `npm run validate-nba-data` green in the recorded 2026-07-06 run. Manual, residential-IP, working-machine-only by design. | Only re-harvests (runbook in ROADMAP §4.0). |

## Gates and blockers

- **F2 repair is merged on `main`.** With S2d and F2 landed, **S3.a** and **F3** are
  independently ready; per ROADMAP §3.2 ∥-rule, each track still lands one unit at a
  time on main, not on concurrent branches that both touch shared foundations.
- **S3 first-tranche sequencing is locked:** S3.a → S3.b1 → S3.b2 → S3.c1 →
  read-only Checkpoint A. Later S3.c2/c3/d/e/f implementation prompts are intentionally
  deferred until that checkpoint authorizes at most one next mechanic. S3.g remains dormant.
- **T-5c and everything after it** (trade AI, ecosystem, RFA, draft) is blocked on the
  remaining pre-baseline chain F3 → F4c → F5 (S2d and F2 are done).
- Do **not** reintroduce a runtime selector/table/pool mode — the production interface
  is sole and unconfigurable (`AGENTS.md` "Sole production selector and table"); gated
  runs prove their context against `data/.league-manifest.json` via
  `scripts/s2d-activation-context.ts`.

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
