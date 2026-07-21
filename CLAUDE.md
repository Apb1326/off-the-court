@AGENTS.md

# Session quickstart

**Reading order for any task:** `AGENTS.md` (hard rules — imported above) →
`docs/PROJECT_STATUS.md` (verified current state + byte-identity baselines) →
`docs/ROADMAP.md` §<your phase> (the spec; transaction-layer phases also read
`docs/TRANSACTIONS_ROADMAP.md`).

**Environment (this machine):**
- `node`/`npm`/`npx` are NOT on PATH. First run:
  `export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"`
- If the `tsx` CLI fails with sandbox IPC `listen EPERM`, use the behavior-equivalent
  fallback `node --import tsx <script>`.
- `npm run profile` / `npm run calibrate` / the harnesses consume the **gitignored**
  `data/` artifacts (active pool, NBA harvest under `data/nba/`, history CSVs) that exist
  only on this machine. Never delete or regenerate anything under `data/` as cleanup.
- Expected outputs and typical runtimes for the verification suite are annotated in
  `AGENTS.md`'s verification checklist. Capture stdout for hash comparison with
  `npm run <cmd> --silent` — the npm banner poisons hashes otherwise.

**Docs map (authority levels):**
- *Canonical, hand-maintained:* `AGENTS.md` (rules) · `docs/ROADMAP.md` (global sequencing
  + phase specs) · `docs/TRANSACTIONS_ROADMAP.md` (transaction phase contracts) ·
  `docs/PROJECT_STATUS.md` (verified snapshot + baselines) · `README.md` ·
  `docs/S2C2_ASSIST_DECISION.md` (S2c2 decision record).
- *Generated — regenerate, never hand-edit:* `docs/LEAGUE_TARGETS.md`
  (`scripts/derive-league-targets.ts`) · `docs/S3_LINEUP_VALIDATION.md`
  (`scripts/validate-lineups.ts`) · `docs/S3B1_MATCHUP_DERIVATION.md`
  (`scripts/derive-s3b1-matchups.ts`) · `docs/S3B2_DEFENDER_INFLUENCE.md`
  (`scripts/derive-s3b2-defender-influence.ts`). Generated docs carry measurements and
  provenance only; status and interpretation live in ROADMAP/PROJECT_STATUS.
- *Frozen oracle input:* `docs/S3_LINEUP_VALIDATION_BASELINE.json` is the accepted
  S3.a primary-correlation baseline and regression allowance; update it only as an
  explicit acceptance decision, never as part of ordinary report regeneration.
- *Historical — background, not required reading:* `docs/ROADMAP_HISTORY.md` (revision
  changelogs) · `docs/prompts/` (archived phase prompts; see its README for the known
  gap) · `docs/S2C1_CANDIDATE_PROFILE.md` (phase record: generated body + addendum) ·
  the S2 evidence records frozen at S2d when their generators were deleted or
  stopped writing them: `docs/S2A_LEAGUE_COVERAGE.md`, `docs/S2B_RATINGS_CONTRACT.md`,
  `docs/S2C1_TENDENCIES_CONTRACT.md`, `docs/S2C1_R_SELECTION_DIAGNOSIS.md`,
  `docs/S2C2_ASSIST_AND_DIET_REPORT.md` · `docs/S2D_PREFLIGHT.md` and
  `docs/S2D_ACTIVATION_CONTEXT.md` (S2d evidence records).
