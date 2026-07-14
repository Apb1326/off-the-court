# S2d activation-context diagnosis

> Diagnosis-only record, 2026-07-12. It records the active runtime context;
> it does not promote artifacts, retune constants, or change game behavior.

## Verdict

The current profile run uses the active NBA-derived pool, the sole production
selector, and the sole production shot-zone table. Its numerical output is
therefore context-valid for S2d interpretation. It is **not** an S2d acceptance
run: the profile has 16 of 32 enforced rows out of tolerance, and the focused
selector-band harness fails for seed `7`. Do not begin a retune from a claim of
a passing/accepted S2d baseline until that predeclared selector-band failure is
resolved by a separately scoped decision.

## Active-pool proof

| Item | Result |
| --- | --- |
| Active directory | `/Users/atticusboyle/Desktop/Claude Code/OffTheCourt/data` |
| `data/teams.json` SHA-256 | `9fded301cb4930eec5f155329619ca7278edffb0c1e9e6e7ffe472aa0b20bee9` |
| `data/players.json` SHA-256 | `47364273b7622aaed1a11d2b966f2adac7d3c1f23b254bdc0345aef61ae19b24` |
| Teams / players | 30 / 582 |
| Representative player IDs | `nba_101108`, `nba_1626145`, `nba_1626156`, `nba_1626157`, `nba_1626162`, `nba_1626164` |
| Identity validation | all teams match `nba_team_<id>`; all players match `nba_<personId>` |
| Pool validation | passed roster ownership, `player.teamId`, duplicate, rotation, and playable-roster checks |
| Deterministic builder check | passed; active pair is structurally valid and byte-identical to a fresh in-memory build |

`node --import tsx scripts/build-league.ts --check` printed:

```text
--check OK: active league pair passes promotion invariants.
--check OK: data/teams.json byte-identical.
--check OK: data/players.json byte-identical.
```

## Production interface proof

- Selector: `nba-derived-tendency-selector-v1`
- Shot-zone table: `PLAY_TYPE_SHOT_ZONES`
- Exactly one exported `PLAY_TYPE_SHOT_ZONES*` table is reachable.
- `PLAY_TYPE_SHOT_ZONES_REAL`, `LEGACY_PLAY_TYPE_SELECTION`, and
  `CANDIDATE_PLAY_TYPE_SELECTION` are absent.
- Profile rejects both `--league-dir data` and `--shot-zones=real`; it has no
  environment, pool-path, or player-ID selector/table choice.

The focused harness repeats each full-season fixed-seed run and compares its
terminal distribution exactly before evaluating the band.

| Seed | Terminal total absolute error | Result |
| ---: | ---: | --- |
| 2026 | 5.96pp | in the 6.00pp band; repeat deterministic |
| 7 | 6.37pp | **out of band**; repeat deterministic |
| 42 | 5.99pp | in the 6.00pp band; repeat deterministic |

The harness also separates FT round trips over representable, unclamped
ratings from lower/upper endpoint clamp assertions.

## Profile provenance banner

Every `scripts/profile-engine.ts` run now emits this deterministic pre-table
banner after its context assertions pass:

```text
S2D ACTIVATION CONTEXT — VERIFIED
pool=/Users/atticusboyle/Desktop/Claude Code/OffTheCourt/data
teams.sha256=9fded301cb4930eec5f155329619ca7278edffb0c1e9e6e7ffe472aa0b20bee9 players.sha256=47364273b7622aaed1a11d2b966f2adac7d3c1f23b254bdc0345aef61ae19b24
teams=30 players=582
representative-player-ids=nba_101108,nba_1626145,nba_1626156,nba_1626157,nba_1626162,nba_1626164
selector=nba-derived-tendency-selector-v1 shot-zone-table=PLAY_TYPE_SHOT_ZONES
builder-check=byte-identical
```

The captured profile command used the documented sandbox-safe equivalent
`node --import tsx scripts/profile-engine.ts > /tmp/s2d-context-verified-profile.out`
because the `tsx` launcher cannot create its IPC pipe here. Its stdout SHA-256
is `a398bc1936a9609372e246547162d374cb13a5db2f7c197569b22c5887d0f83a`.
It reported `FAIL (16 of 32 enforced stats out of tolerance)`.

## Evidence run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `node --import tsx scripts/build-league.ts --check` | PASS |
| `node --import tsx scripts/s2d-activation-context.ts` | PASS |
| `node --import tsx scripts/test-s2c1-r.ts` | FAIL, only seed `7` selector band |
| profile capture | Context banner PASS; engine profile FAIL, 16/32 enforced rows |

No active `data/` file was written during this diagnosis.
