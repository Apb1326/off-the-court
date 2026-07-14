# Archived phase implementation prompts

Per `docs/ROADMAP.md` §0's working pattern, each execution unit's final self-contained
prompt is committed here **before** it runs. This folder is a historical record: prompts
describe the contract *as prompted*; where execution diverged, the divergence is written
back into `docs/ROADMAP.md` (see §4.1's `[DIVERGENCE]` markers), never patched here.

| File | Phase |
|---|---|
| `STAGE_1_IMPLEMENTATION_PROMPT.md` | S1 — league calibration (annotated with the §4.1 divergence log and the S1-R repair record) |
| `PHASE_3_IMPLEMENTATION_PROMPT.md` | Transactions Phase 3 — cap & financial state |
| `PHASE_5A_IMPLEMENTATION_PROMPT.md` | Transactions Phase 5a — dead money, exceptions, lifecycle |
| `PHASE_5B_IMPLEMENTATION_PROMPT.md` | Transactions Phase 5b — sign-and-trade |
| `F1_TEAM_SELECTION_IMPLEMENTATION_PROMPT.md` | F1 — controlled-franchise identity (schema v7) |
| `S2C2_IMPLEMENTATION_PROMPT.md` | S2c2 — assist definition and candidate-only diet unwind |
| `S2D_IMPLEMENTATION_PROMPT.md` | S2d — activation, coupled re-baseline, and legacy-ingest retirement |
| `F2_PLAYOFFS_IMPLEMENTATION_PROMPT.md` | F2 — playoffs (schema v8; committed ahead of execution per the working pattern) |

**Known archive gap (recorded 2026-07-11):** the prompts for **S2a, S2b/S2b-R, S2c1,
and S2c1-R** (landed 2026-07-07 → 2026-07-10) were never committed here — a lapse, not a
policy change. Their outcome records live in `docs/ROADMAP.md` §4.2 and the generated
`docs/S2A_LEAGUE_COVERAGE.md` / `docs/S2B_RATINGS_CONTRACT.md` / `docs/S2C1_*` reports.
The archive discipline resumes with **S2c2**.
