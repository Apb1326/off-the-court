# S2d — Preflight evidence

> **Frozen historical pre-activation evidence.** Recorded before S2d activation edits.
> Local checkout was fast-forwarded to `origin/main` `9ee5dfa` (including the S2c2-R
> repair); the worktree was clean. Candidate-only generator checks below are historical
> results, not current commands.

## Required local artifacts

- `data/nba/normalized/`: present
- Active `data/teams.json` and `data/players.json`: present
- Candidate `data/league-candidate/teams.json` and `players.json`: present
- Calibration history artifacts: present

## Baseline verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `validate-nba-data` | PASS (211 passed, 0 failed, 80 intentionally unharvested skips) |
| Historical builder check | PASS (candidate JSON and all three generated S2 contracts byte-identical) |
| `test-build-league` | PASS (30 teams, 582 players, 450 rostered; deterministic) |
| Historical S2c2 report reproducibility check | PASS; generator retired at S2d activation |
| Historical candidate real-diet decomposition, seed 2026 | PASS; zero skipped stage vectors |
| Determinism | PASS |
| Spacing A/B | PASS (+16.0pp rim-attempt rate, +6.0pp TS%) |
| Defensive versatility A/B | PASS |
| S2c1-R focused harness | PASS (including S2c2 dual-table invariants) |

The package `tsx` launcher cannot create its IPC pipe in this sandbox, so the
verification commands that invoke it were run through the documented equivalent
`node --import tsx <script>`; the program stdout is the same script stdout.

## Silent-output SHA-256

| Command stdout | SHA-256 |
| --- | --- |
| `profile-engine.ts` | `74460aa472a3c2bcfa9dabc90aee6c4abbe5e1e2dd3aff87bd811b54cfbf1848` |
| `calibrate-history.ts` | `a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4` |

## Binding decomposition snapshot

The pre-activation candidate decomposition measured, in percentage points:
tendencies/ability move toward threes modestly;
the global dampener/deterrence then moves rim `+3.00`, short mid `+2.92`, long
mid `+1.32`, corner three `-1.64`, above-break three `-4.30`, and deep three
`-1.29`; the old spacing baseline then moves rim `-4.32`, short mid `+3.55`,
long mid `+3.27`, corner three `-0.70`, above-break three `-1.08`, and deep
three `-0.72`. This confirms that the locked cut/spot-up diets are not the
residual source and bounds the S2d retune to the named coupled constants.
