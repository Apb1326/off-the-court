# F2 — Playoffs (Track F, Wave 3)

You are working on Off the Court, a possession-by-possession NBA simulation and
franchise game (Next.js 16, React 19, TypeScript 5, Tailwind v4, JSON persistence).

This is a **non-sim-outcome, schema-conscious franchise phase**: it adds a real
postseason — seeding, a play-in, best-of-7 conference brackets, the Finals, a
champion — on top of the existing regular season, without changing how any
single game simulates. `npm run profile` and `npm run calibrate` output must be
**byte-identical** before and after; any diff is a bug, not a side effect.

> **Execution prerequisites:** S2d must already be landed on the branch (the
> NBA-derived pool is the sole production path; profile prints the
> `S2D ACTIVATION CONTEXT — VERIFIED` banner). F2 runs ∥ with S3 under the
> ROADMAP §3.2 sequential-merge rule: both may be ready, but each lands on main
> alone. If S3 (or any other) work is in flight on this branch, STOP and
> surface the sequencing conflict.

## Before anything else

1. Read `AGENTS.md` in full. Its rules are binding and override this prompt
   where they conflict.
2. Read `docs/ROADMAP.md` §0, §3.2, §3.3 (the F2 row: every tuned artifact is
   ○ unchanged), §5.2 (the phase contract this prompt instantiates), and §9.8.
3. Inspect the complete worktree (`git status --short`) and preserve unrelated
   staged, unstaged, and untracked changes. If existing changes overlap this
   phase and cannot be preserved safely, STOP and surface them.
4. Read the relevant Next.js 16 guides under `node_modules/next/dist/docs/`
   before editing App Router pages or route handlers. Do not rely on
   remembered Next.js conventions.
5. Confirm all of the following live facts before editing (each was verified
   when this prompt was written; re-verify, don't assume):
   - `SAVE_SCHEMA_VERSION` is exactly `7` (`src/models/save.ts`).
   - `GamePhase` is exactly `'preseason' | 'regular_season' | 'offseason'`,
     and `derivePhase` returns `'offseason'` when
     `gamesPlayed >= totalGames` (`src/models/save.ts`).
   - `SeasonState` (`src/models/season.ts`) has **no** `playoffs` or
     `playoffPlayerStats` fields, and no `src/engine/playoffs.ts` exists.
   - `advanceSeason` (`src/engine/season.ts`) clamps its target to
     `state.endDate`; derives per-game seeds as
     `deterministicSeed(state.seed, sg.id)` and the injury stream as
     `deterministicSeed(state.seed, 'inj_' + sg.id)`; treats
     `state.results` as the idempotency ledger (completed-id set); and
     `deterministicSeed` is a private, un-exported function in that file.
   - The schedule generator (`src/engine/schedule.ts`) produces **86 games
     per team = 1290 total** (not the real NBA's 1230), with sequential ids
     `g0`…`g1289`; `totalGames = schedule.length`.
   - `TeamStanding` (`src/models/season.ts`) carries conference/division
     records and points for/against but **no head-to-head** data.
   - The season API (`src/app/api/season/route.ts`): `clientState` exposes
     `seasonOver: gamesPlayed >= totalGames`; the advance action
     short-circuits `advanced: 0` on that same condition; `resolveTarget`
     supports modes `day | week | rest | date | marker`, all capped at
     `state.endDate`.
   - `src/app/schedule/page.tsx` has a view state machine
     `'standings' | 'leaders'` and consumes `seasonOver`. The menu page types
     `seasonOver` in `ActiveState` but does not branch on it; its relevant
     exhaustive surface is `PHASE_LABEL: Record<GamePhase, string>`. The nav
     tabs live in `src/app/components/TopChrome.tsx` (they will NOT change in
     F2).
   - `scripts/test-saves.ts`, `scripts/test-save-migration.ts`,
     `scripts/test-season-monotonic.ts`, `scripts/test-injuries.ts`, and
     `scripts/test-calendar.ts` exist and are green before you start.
6. Environment: node lives under nvm, not on PATH — run
   `export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"` first. If the
   `tsx` CLI fails with sandbox IPC `listen EPERM`, use the
   behavior-equivalent fallback `node --import tsx <script>`.
7. Capture baselines before editing: `npm run profile --silent > <file>` and
   `npm run calibrate --silent > <file>` **outside the repo**, plus their
   SHA-256 hashes and exit codes (the npm banner poisons hashes without
   `--silent`). Cross-check against the recorded baselines in
   `docs/PROJECT_STATUS.md` (at the time this prompt was written: profile
   `c37dfded336b446e344f592e97a8c913aea2d4894602d86b06b3d5392de5438e`,
   calibrate
   `5d097b907f7869ff9fc97c4c82778fe1b66354008bb38cc479ad262491c4b8c7`; if the
   live file records different hashes, those govern). Profile must be green
   (PASS 32/32, exit 0, activation-context banner). If the pre-flight run
   does not reproduce the recorded baselines, STOP.
8. Capture a **regular-season advancement behavior baseline** before editing;
   profile/calibrate do not call `advanceSeason` and therefore cannot prove the
   Deliverable-4 extraction preserved it. From a seed-2026 state advanced to
   `endDate`, write a stable JSON projection outside the repo containing
   `currentDate`, `gamesPlayed`, `results`, `standings`, `playerStats`,
   `injuries`, and `recoveries`. Exclude the two fields F2 intentionally adds
   (`playoffs`, `playoffPlayerStats`) and exclude `injuryHistory` entirely:
   decision 13 intentionally corrects that report's representation and the old
   in-game missed-count overstatement. Record the projection's SHA-256 and
   retain it for the post-change comparison. Separately capture the pre-F2
   injury-history summary so its intentional delta can be reported, not used as
   an equality gate. If this fixture skips a scheduled game, STOP under the
   condition below.
9. Run the pre-existing harnesses in item 5 before editing so inherited
   failures are separated from regressions introduced by this phase.

If any live fact above fails, the schema is not v7, or `docs/ROADMAP.md` §5.2
conflicts with this prompt, STOP and report the evidence instead of
reconciling it yourself.

## Goal

A real postseason completing the competitive arc: deterministic seeding from
the final regular-season standings, an optional play-in for seeds 7–10,
best-of-7 series with 2-2-1-1-1 home court through conference brackets and the
Finals, and a champion — making the T-5c championship-distribution metric mean
something. Playoff games flow through the **same monotonic/idempotent
advancement machinery** as regular-season games (one engine, not a parallel
one), stats accumulate separately, injuries continue, and the whole structure
persists on the season under schema v8.

Playoff games **play exactly like regular-season games** — no rotation
tightening, no leverage minutes, no playoff-specific engine behavior. That is
a conscious simplification (Horizon item), stated in the module docblock.

## Design decisions already made (restate in code comments where noted; do not re-litigate)

1. **`totalGames`, never a literal.** ROADMAP §5.2 says "freeze at game 1230";
   the real generator produces 1290. Every completion/freeze rule is expressed
   as `gamesPlayed >= totalGames`.
2. **GameId scheme carries the conference.** §5.2's example `PO-R1-S3-G5`
   omits it; the implemented scheme is `PO-R1-E3-G5` (see Deliverable 3). The
   id is a pure function of bracket position and is the seed key.
3. **Results ledger reuse; derive, don't store.** Playoff `GameSummary`s
   append to `state.results`. Series tallies, series winners, round
   completion, and the champion are pure derivations of
   (bracket structure, results) — there is **no stored `champion` field**.
   What persists is construction output only (seeds, matchups, materialized
   game slots with dates) — the same posture as `schedule`.
4. **The transition is the grandfather mechanism.** `initPlayoffs` fires only
   in the `advanceSeason` call that plays the final regular-season game. A
   pre-v8 save already at `gamesPlayed >= totalGames` never has that moment,
   so `playoffs` stays `null` forever and `derivePhase` reads `'offseason'` —
   §5.2's "legacy completed seasons grandfathered as finished" with no
   sentinel field.
5. **Format constants live in `src/engine/playoffs.ts`**, exported and
   annotated — following the `calendar.ts` precedent of co-located
   season-structure knobs (`DAYS_PER_SLOT` etc.), not `engine/constants.ts`,
   which holds sim-outcome tunables under calibration governance. State this
   rationale in the constants' comment block so AGENTS rule #4 isn't misread.
6. **Play-in defaults ON** (`PLAYIN_ENABLED = true`), captured into the
   persisted structure at construction so flipping the constant later cannot
   desync an in-flight bracket.
7. **Fixed date windows.** All playoff dates are pure functions of bracket
   position and `state.endDate` — independent of results. Every series
   occupies its full window; all series in a round start the same day; idle
   days when series end early. Documented simplification.
8. **No new `SeasonMarker`s.** The persisted `MarkerType` union stays
   untouched; the bracket view shows everything a marker would. A decision,
   not an oversight.
9. **`seasonOver` splits.** The API's `seasonOver` currently means "regular
   season complete"; F2 renames that meaning to `regularSeasonOver` and
   redefines `seasonOver` as "the season is over" (champion crowned, or
   legacy-finished). The schedule page updates its old-semantic reads; the menu
   adds the new exhaustive `GamePhase` label but has no live `seasonOver`
   branch to rewire. This is a deliberate response-semantic change plus
   additive fields, not a wholly additive API change.
10. **Use the existing hardship floor; fail loudly on an invalid roster.**
    `getHealthyPlayers` already adds injured hardship players until
    `INJURY_MIN_HEALTHY_ROSTER = 8`; do not add a second force-play algorithm,
    do not change its ordering, and do not perturb the regular path. A result
    below five therefore means the team's total roster is itself below five,
    which injured-player fill cannot repair. The regular path retains its
    existing null/skip behavior for byte identity; the playoff path throws a
    descriptive invariant error before simulation rather than silently
    deadlocking the bracket. The fixed-seed harness must never hit it.
11. **`deterministicSeed` becomes a named export** from `src/engine/season.ts`
    (zero behavior change; the harness and playoff code need it).
    `injury.ts`'s `hash01` near-duplicate stays untouched — it feeds a
    different purpose (fragility in [0,1)); a known non-item.
12. **The bracket UI is a third view in the schedule page**, not a new route
    or nav tab (a `/playoffs` tab would be dead ~90% of a season and would
    duplicate the advance controls).
13. **Injury history stays append-only by deriving new-entry missed counts from
    results.** The current onset-time `gamesMissed` snapshot can be finalized
    only because the complete regular schedule already exists; it cannot see
    future playoff rounds and would undercount both late-regular-season and
    postseason injuries. F2 therefore gives every **new** history entry
    immutable onset evidence (`onsetGameId`, whether the player played the
    onset game, and the maximum games this injury can actually keep them out
    under today's tick-before-roster semantics). A shared pure helper derives
    missed games from the team's completed `results`, capped by that maximum.
    Legacy entries without onset evidence continue to use their stored
    `gamesMissed`; migration never rewrites them. No history entry is mutated,
    no future bracket is guessed, and elimination naturally caps the derived
    total. This representation change is intentional; game availability, RNG,
    and every simulation outcome remain unchanged.

Decisions intentionally left open: **none** — the format is fully settled
above. The stop-and-surface list below covers live-state divergence.

## Hard constraints (restate; do not paraphrase away)

- Introduce no `Math.random`, no `Date.now`, and no ambient seeds in this
  phase. Bracket construction consumes **no RNG at all** (pure function of
  standings + results + tiebreakers). Playoff game/injury seeds descend from
  `deterministicSeed(season.seed, gameId)` exactly like regular games. The
  menu's pre-existing UI-only seed picker and relative-time display are valid
  boundary/display uses and remain untouched.
- RNG draw order and every game outcome in the existing regular-season path
  must be **unchanged**. Deliverable 4 is behavior-preserving; only the raw
  injury-history representation and its corrected derived missed counts change
  intentionally under decision 13; both are excluded from the dedicated
  game-behavior before/after oracle and reported separately.
- Stats derive from the `PlayByPlayEvent` stream via the existing
  accumulators; the `addXStats` stubs stay no-ops; no hand-assigned stats.
- Never read scouted ratings on a sim path. Never sum ratings to value a
  lineup. Nothing in this phase touches `resolveShot`, possession logic, or
  `engine/constants.ts`.
- Schema change ships with bump + deterministic idempotent migration +
  round-trip check, per the standing rule.

## Deliverables (in this order)

### 1. Types, phase value, and constructor inits

In `src/models/season.ts`, add:

```ts
export type PlayoffRound = 1 | 2 | 3 | 4; // R1, Conf Semis, Conf Finals, Finals

export interface PlayoffGame {
  id: string;         // pure function of bracket position — this string IS the seed key
  gameNo: number;     // 1..7 within a series; 1 for each play-in game
  date: string;       // 'YYYY-MM-DD', fixed-window date assigned at materialization
  homeTeamId: string; // actual host for THIS game per the 2-2-1-1-1 pattern
  awayTeamId: string;
}

export interface PlayoffSeries {
  id: string;                          // e.g. 'PO-R1-E1'; game ids are `${id}-G${n}`
  round: PlayoffRound;
  conference: 'East' | 'West' | null;  // null = Finals
  slot: number;                        // 1-based bracket slot within round+conference
  homeCourtTeamId: string;             // 2-2-1-1-1 anchor
  awayCourtTeamId: string;
  homeSeed: number;                    // final conference seed; Finals: each champ's own conference seed
  awaySeed: number;
  games: PlayoffGame[];                // all 7 materialized at construction; G5–G7 simply never play if unneeded
}

export interface PlayInBracket {
  conference: 'East' | 'West';
  seeds: [string, string, string, string]; // team ids at regular-season seeds 7, 8, 9, 10
  games: PlayoffGame[];                    // two openers at init; decider appended when both resolve
}

export interface PlayoffsState {
  /** Final regular-season conference seeding at initialization (top 10 with
   *  play-in, top 8 without). Construction output, like `schedule` — not derived state. */
  seeds: { east: string[]; west: string[] };
  /** Format captured at construction so flipping PLAYIN_ENABLED can't desync an in-flight bracket. */
  playInEnabled: boolean;
  playIn: { east: PlayInBracket; west: PlayInBracket } | null;
  /** Append-only: later rounds are appended as prior rounds resolve. Never rewritten. */
  series: PlayoffSeries[];
}
```

`SeasonState` gains exactly two fields:

```ts
playoffs: PlayoffsState | null;          // null = no postseason exists (in-progress regular season, or legacy-finished save)
playoffPlayerStats: PlayerSeasonStats[]; // separate postseason accumulation; empty until playoffs run
```

Also refactor `InjuryHistoryEntry` into a shared base plus these two append-only
representations (this changes the entry shape, **not** the number of
`SeasonState` fields):

```ts
export type InjuryHistoryEntry = InjuryHistoryBase & (
  | {
      // Pre-v8 entry. Absence of onsetGameId is the legacy discriminator.
      gamesMissed: number;
      onsetGameId?: never;
      playedOnset?: never;
      maxGamesMissed?: never;
    }
  | {
      // v8+ entry. Missed games derive from completed results; never mutate it.
      gamesMissed?: never;
      onsetGameId: string;
      playedOnset: boolean;
      maxGamesMissed: number;
    }
);
```

`InjuryHistoryBase` carries the existing `id`, `season`, `playerId`, `teamId`,
`injuryType`, `region`, `severity`, and `startDate` fields unchanged. Add in
`src/engine/injury.ts`:

```ts
export function injuryGamesMissed(
  entry: InjuryHistoryEntry,
  results: GameSummary[],
): number
```

For a legacy entry (`onsetGameId` absent), return its stored `gamesMissed`. For
a v8+ entry, take that team's completed results in persisted order, find
`onsetGameId`, count from the onset game for a pre-game injury or strictly after
it for an in-game injury, and cap at `maxGamesMissed`; return `0` if the onset
result is not recorded. New pre-game entries use
`maxGamesMissed = injury.gamesRemaining`; new in-game entries use
`maxGamesMissed = Math.max(0, injury.gamesRemaining - 1)` because the existing
tick-before-roster order clears a one-game in-game injury before the following
tip. This records today's actual availability semantics without changing them.
For an active injury this is the actual missed count **to date**; it becomes
final when the team has no more games or the cap is reached. Legacy entries
remain stored snapshots because their missing onset evidence cannot be
reconstructed safely.
All API/report/test consumers read missed counts through this helper. Do not add
a second stored total and do not mutate an entry after append.

In `src/models/save.ts`: `GamePhase` gains `'playoffs'` (between
`'regular_season'` and `'offseason'` conceptually; union order is free).
In `src/engine/season.ts`, `createSeasonState` initializes
`playoffs: null` and `playoffPlayerStats: []`.

### 2. Pure seeding and tiebreakers (`src/engine/playoffs.ts`, new)

A new module that is a sibling of `schedule.ts`/`calendar.ts`: season
*structure*, zero RNG, zero sim math. Its docblock documents (a) the
tiebreaker chain as a **simplified subset of the NBA rules**, (b) the gameId
scheme, (c) the fixed date windows, and (d) the
playoff-games-play-like-regular-games simplification.

**Constants** (exported, annotated, with the location rationale from settled
decision 5):

```ts
export const PLAYIN_ENABLED = true;               // format toggle; captured into PlayoffsState at construction
export const PLAYOFF_SERIES_LENGTH = 7;           // best-of-7
export const PLAYOFF_SERIES_WINS = 4;             // wins to take a series
export const PLAYOFF_HOME_PATTERN =               // 2-2-1-1-1, from the home-court anchor's perspective
  ['H', 'H', 'A', 'A', 'H', 'A', 'H'] as const;
export const PLAYIN_OPENERS_OFFSET_DAYS = 2;      // from regular-season endDate
export const PLAYIN_DECIDER_OFFSET_DAYS = 4;
export const PLAYOFF_R1_OFFSET_DAYS = 7;          // fixed regardless of the play-in toggle
export const PLAYOFF_GAME_INTERVAL_DAYS = 2;      // between games within a series
export const PLAYOFF_ROUND_GAP_DAYS = 3;          // between a round's scheduled G7 and the next round's G1
```

**Seeding:**

```ts
export interface SeedEntry { teamId: string; seed: number }

/** Full deterministic conference ordering (all 15 per conference). Consumes NO RNG. */
export function computeSeeds(
  standings: TeamStanding[],
  results: GameSummary[],
  teams: Team[],
): { east: SeedEntry[]; west: SeedEntry[] }
```

Algorithm — ordered by:

1. Win pct, compared by **integer cross-multiplication**
   (`a.wins * (b.wins + b.losses)` vs `b.wins * (a.wins + a.losses)`) — no
   float ties.
2. Within each tied group (≥2 teams at identical win pct), sort by
   **per-team keys computed against the group** — never a pairwise
   (potentially non-transitive) comparator:
   - (a) head-to-head win pct vs all other tied teams, derived by scanning
     `results` **filtered to regular-season ids** (exclude the `PO-` prefix;
     the filter makes the function total even though seeding only runs when
     no playoff results exist). A team with zero games vs the group keys
     at 0.5.
   - (b) division-leader flag (division leader = best raw win pct in the
     division; internal ties broken by conference win pct → point
     differential → teamId — no recursion).
   - (c) conference win pct (`confWins`/`confLosses`).
   - (d) point differential (`pointsFor − pointsAgainst`).
   - (e) `teamId` ascending (stable terminal rung).

### 3. Bracket construction and derivation helpers (`src/engine/playoffs.ts`)

```ts
/** Build seeds + the play-in openers (or straight R1 when play-in disabled).
 *  Pure; no RNG. opts.playIn defaults to PLAYIN_ENABLED — a test seam only. */
export function initPlayoffs(state: SeasonState, teams: Team[], opts?: { playIn?: boolean }): PlayoffsState

/** Materialize every stage whose inputs are now decided (play-in deciders,
 *  R1 after the play-in, later-round series as soon as BOTH feeder series are
 *  decided). Appends to playoffs.playIn[].games / playoffs.series; idempotent
 *  (only builds missing stages); returns true if anything new was materialized.
 *  Deterministic, idempotent state mutator; consumes no RNG. */
export function advanceBracket(state: SeasonState): boolean
```

**Bracket topology (fixed, documented):**

- **Play-in** (per conference): openers `7v8` (hosted by seed 7) and `9v10`
  (hosted by seed 9). Winner of 7v8 takes playoff seed 7. Loser of 7v8 hosts
  the winner of 9v10 in the decider; the decider winner takes seed 8; the
  9v10 loser is eliminated. Single games.
- **R1 slots:** E1 = 1v8, E2 = 4v5, E3 = 3v6, E4 = 2v7 (same for W).
- **R2:** slot 1 = W(R1-1) v W(R1-2); slot 2 = W(R1-3) v W(R1-4).
  **R3:** W(R2-1) v W(R2-2). **R4 (Finals):** East champ v West champ.
- **Home court:** the lower seed number within conference rounds (which is
  the better record by construction). **Finals:** the better regular-season
  record between the two champs (integer cross-mult), ties broken by the
  reduced chain — H2H from the two inter-conference meetings → point
  differential → teamId (conference record is meaningless cross-conference;
  document this Finals-specific reduction).
- All 7 games of a series are materialized at construction with dates; games
  after the series is decided are permanently retired by the series-undecided
  filter (never simulated, never in `results`).
- Play-in disabled: `playIn: null`, R1 built directly from seeds 1–8 at init.

**GameId scheme (the id IS the seed key; document beside the tiebreakers):**

| Stage | Series id | Game ids |
|---|---|---|
| Play-in openers | (bracket ids `PO-PI-E`, `PO-PI-W`) | `PO-PI-E-7v8`, `PO-PI-E-9v10` (and `W`) |
| Play-in decider | — | `PO-PI-E-DEC` (and `W`) |
| Round 1 | `PO-R1-E1`…`PO-R1-E4`, `PO-R1-W1`…`PO-R1-W4` | `PO-R1-E1-G1` … `-G7` |
| Conf Semis | `PO-R2-E1`, `PO-R2-E2`, `PO-R2-W1`, `PO-R2-W2` | `PO-R2-E1-G3` etc. |
| Conf Finals | `PO-R3-E1`, `PO-R3-W1` | `PO-R3-E1-G6` etc. |
| Finals | `PO-R4-F1` | `PO-R4-F1-G1`…`-G7` |

Pure function of bracket position — never of scheduling order or of which
teams landed there. No collision with regular ids `g0`…`g1289`.

**Dates** (with `E = state.endDate`, using the existing `addDays`):

- Play-in openers: `E + PLAYIN_OPENERS_OFFSET_DAYS`; deciders:
  `E + PLAYIN_DECIDER_OFFSET_DAYS`.
- Round *r* start: `E + PLAYOFF_R1_OFFSET_DAYS + (r−1) ·
  ((PLAYOFF_SERIES_LENGTH−1)·PLAYOFF_GAME_INTERVAL_DAYS + PLAYOFF_ROUND_GAP_DAYS)`
  → with defaults R1/R2/R3/F start at E+7 / E+22 / E+37 / E+52.
- Game *n* of a series: `roundStart + (n−1)·PLAYOFF_GAME_INTERVAL_DAYS`.
- `postseasonEndDate(E)` = the Finals G7 date (E+64 with defaults) — the
  advancement horizon.

**Derivation/read helpers** (all pure, exported): `seriesTally(series, results)`,
`seriesWinner(series, results)`, `roundComplete(playoffs, round, results)`,
`playoffChampion(season)` (the Finals winner or `null`),
`playablePlayoffGames(state)`, `nextPlayoffGameDate(state)`,
`postseasonEndDate(endDate)`, and `bracketView(state)` — the client payload
builder returning ids + derived tallies + per-game results joined from
`state.results` by id (shape in Deliverable 7).

`playablePlayoffGames` is the **single selector** for advancement and API
upcoming/next-date reads. It returns only materialized games whose participants
are known, whose id is absent from `results`, and whose play-in branch or series
is still live. It excludes permanently retired G5–G7 slots after a clinch. Sort
its result by `(date, id)`. `nextPlayoffGameDate` derives from this selector;
do not duplicate the retired/completed-game rules in the API.

Import direction: this module imports only `models/*` and
`engine/calendar.ts`. `models/save.ts` will import `playoffChampion` from it
(Deliverable 5) — no cycle; `save.ts` already imports `@/franchise/controlled`.

### 4. Advancement integration (`src/engine/season.ts`) — one engine

Extend `advanceSeason` itself; **no sibling `advancePlayoffs`**. Signature and
return type (`GameSummary[]`) unchanged.

- **(a) Behavior-preserving extraction.** Move the per-game loop body (tick
  injuries → recoveries → roll new injuries on the `inj_` stream → healthy
  rosters → `adjustRotation` → in-game exits → `simulateGame` → append
  injuries/history → record → summary → push to `results` + completed set)
  into a private helper:

  ```ts
  function playOneGame(state, game, ctx, opts: {
    standings: Map<string, TeamStanding> | null; // null in playoffs — standings frozen
    statsSink: Map<string, PlayerSeasonStats>;   // regular map, or the playoff map
    createMissingStatEntries: boolean;           // true for playoffs (create-on-first-touch)
    requirePlayableRoster: boolean;              // true in playoffs: throw if total roster <5
  }): GameSummary | null
  ```

  The regular-season loop calls it with the standings map,
  `state.playerStats`, `createMissingStatEntries: false`,
  `requirePlayableRoster: false`; the playoff loop passes `true`. Do not alter
  `getHealthyPlayers`: its existing hardship floor already supplies injured
  players when possible. Regular-season game results, availability, RNG draw
  order, standings, stats, active injuries, and recoveries stay byte-identical
  to today. The only intentional regular-path data change is that newly logged
  injury-history entries use decision 13's immutable onset evidence; its
  corrected count delta is reported separately. `test-injuries`,
  `test-saves`, and `test-season-monotonic` remain green (profile/calibrate are
  structurally untouched — they drive `simulateSeason`/`simulateGame`, not
  `advanceSeason`).
- **(b) Two-phase target** replacing the single `endDate` clamp: the regular
  loop runs against `min(targetDate, endDate)` exactly as today; after the
  transition, the playoff loop runs against
  `min(targetDate, postseasonEndDate(state.endDate))`. The final monotonic
  `currentDate` update uses the playoff-phase target when playoffs exist. One
  call can sweep from mid-season through the entire postseason.
- **(c) The transition** (grandfather mechanism — settled decision 4). After
  the regular loop:

  ```ts
  if (state.playoffs === null
      && state.gamesPlayed >= state.totalGames
      && playedRegularThisCall > 0) {
    state.playoffs = initPlayoffs(state, teams);
  }
  ```

- **(d) The playoff loop** (schedule-as-you-go), when
  `state.playoffs && playoffChampion(state) === null`:

  ```
  loop:
    changed = advanceBracket(state)           // materialize newly-decided stages
    next = first playablePlayoffGames(state) entry with date <= playoffTarget
    if next exists:
      RE-CHECK immediately before tip that next is still returned by
      playablePlayoffGames(state)       // a prior game may just have clinched
      play exactly that one game via playOneGame(..., { standings: null,
        statsSink: playoffMap, createMissingStatEntries: true,
        requirePlayableRoster: true })
      continue                          // recompute bracket + playability
    until advanceBracket() materializes nothing new AND no next game is due
          (or the champion is decided)
  ```

  Never build a batch containing all currently-due games and then play it
  without rechecking between games: on a horizon advance, G1–G7 are initially
  eligible but G4 may retire G5–G7. One-at-a-time selection is the normative
  algorithm.

  Properties to preserve:
  - **Idempotent/monotonic** via the same completed-id ledger (playoff
    summaries live in `state.results`) plus the series-undecided filter.
    Deliberately **no** `date <= currentDate` skip inside this loop — a game
    materialized mid-call at/behind the moving cursor must still play;
    idempotency rests on the ledger, not the clock.
  - **Granularity-independent:** day-by-day advancement and one-shot
    advancement produce byte-identical postseasons (the harness proves it).
  - **Standings frozen:** `recordResult` never runs for playoff games;
    `state.gamesPlayed` is **not** incremented (it remains the
    regular-season counter; `totalGames` untouched). The function's return
    value **does** include playoff summaries (the API's `advanced` count and
    recap benefit).
  - **Stats routed** to `state.playoffPlayerStats` through the same
    `accumulatePlayerStats`/`addStatLine`, with create-on-first-touch
    entries keyed to the player's current `teamId` (pre-seeding all entries
    is roster-mutation-fragile).
  - **Injuries continue** on the identical tick/roll/recovery flow with the
    `inj_` stream keyed by playoff gameId. `scheduleStressMultiplier`
    reading `state.results` now sees playoff back-to-back density — correct
    behavior, not a bug. Every new history entry records decision 13's onset
    evidence; `injuryGamesMissed` derives the count from completed regular +
    playoff results, so a future round is neither guessed nor lost.
  - **Roster solvency** follows settled decision 10: reuse the existing
    hardship floor; a playoff roster still below five throws before simulation.
- **(e)** Export `deterministicSeed` (named export, zero behavior change).

### 5. `derivePhase` and `buildSummary` (`src/models/save.ts`)

```ts
export function derivePhase(season: SeasonState): GamePhase {
  if (season.gamesPlayed >= season.totalGames) {
    if (season.playoffs && playoffChampion(season) === null) return 'playoffs';
    return 'offseason'; // champion crowned, OR legacy-finished (playoffs === null)
  }
  if (season.gamesPlayed === 0 && season.currentDate < season.startDate) return 'preseason';
  return 'regular_season';
}
```

Grandfathered saves read `'offseason'` with no special-casing. The phase is
recomputed on every save write, as today.

`buildSummary`: keep the controlled-team tag prefix and the existing
regular-season/preseason text. Add: when `playoffChampion(season)` is
non-null → `Champion <ABBREV>` (plus the existing progress text); when the
phase is `playoffs` → `<date> · Playoffs`. Legacy-finished saves keep today's
offseason text. Flows to the save list and menu through the single
`metadataFor` chokepoint untouched.

### 6. Schema v8 + migration

- Bump `SAVE_SCHEMA_VERSION` 7 → 8; extend the schema-history docblock in
  `src/models/save.ts`: *v7 → v8 (F2): `SeasonState` gains `playoffs`
  (null-init) and `playoffPlayerStats` (empty-init); a `playoffs`
  `GamePhase`; new injury-history entries carry result-derived onset evidence
  while legacy entries retain their stored finalized count. Pre-v8 seasons
  already at `gamesPlayed >= totalGames` are grandfathered as finished —
  `playoffs` stays `null` and no retroactive postseason is ever constructed
  (bracket construction only fires in the advance that completes the regular
  season).*
- Add `migrateV7toV8` in `src/data/saves/migrations.ts` at the marked
  insertion point (before the idempotent normalization block), modeled on
  `migrateV6toV7`:

  ```ts
  function migrateV7toV8(file: SaveFile): SaveFile {
    return {
      ...file,
      schemaVersion: 8,
      season: {
        ...file.season,
        playoffs: file.season.playoffs ?? null,
        playoffPlayerStats: file.season.playoffPlayerStats ?? [],
      },
    };
  }
  ```

  Deterministic, no RNG, idempotent via `??`. Mid-regular-season saves are
  untouched beyond the two empty inits (they earn a bracket naturally on
  completion — progression, not retroactivity). Existing `injuryHistory`
  entries are carried byte-for-byte; absence of `onsetGameId` selects the
  legacy read path, so migration never rewrites an append-only event.
- Extend `scripts/test-save-migration.ts` (no parallel harness): a direct
  v7→v8 mid-season fixture; a v7 **completed** fixture asserting
  `playoffs === null` and `derivePhase === 'offseason'` post-migration; the
  full old-chain→v8 run; and the second-run byte-identical no-op assertion.

### 7. Season API (`src/app/api/season/route.ts`)

- **Advance guard:** replace the `gamesPlayed >= totalGames` short-circuit
  with `derivePhase(state) === 'offseason'` → `advanced: 0` — playoff
  advancement flows; legacy-finished/post-champion saves still no-op. The
  monotonic backward-target rejection stays.
- **`clientState` additions plus one intentional semantic change:**
  `regularSeasonOver: gamesPlayed >= totalGames`;
  `seasonOver: derivePhase(state) === 'offseason'` (redefinition — settled
  decision 9); `champion: playoffChampion(state)`;
  `playoffs: state.playoffs ? bracketView(state) : null` with shape
  `{ playInEnabled, playIn, rounds: [{ round, series: [{ id, conference,
  slot, homeCourtTeamId, seeds, tally, winnerId, games: [{ id, date,
  homeTeamId, awayTeamId, result? }] }] }], champion }` — the UI maps ids to
  the teams it already fetches. Map injury-history `gamesMissed` through
  `injuryGamesMissed(entry, state.results)`; never read a v8+ entry as a stored
  total.
- **`nextGameDate`** becomes playoff-aware (`min(regular next,
  nextPlayoffGameDate(state))`); `upcoming` includes only entries returned by
  `playablePlayoffGames(state)` on that date (same
  `{id, homeTeamId, awayTeamId}` shape), so completed or retired G5–G7 slots
  never appear. `recent` picks up playoff results automatically from
  `state.results`.
- **`resolveTarget`:** `rest` → `postseasonEndDate(state.endDate)` when
  playoffs are active, else `state.endDate` ("Sim to Finale" still pauses the
  `day` → the playoff-aware `nextGameDate`; `week` unchanged; `marker` → next
  marker if any remain, else next playoff game date ?? horizon; `date`
  unchanged (the engine's two-phase clamp governs). **No new mode names.**

### 8. Minimal bracket UI

- `src/app/schedule/page.tsx`: extend the view union to
  `'standings' | 'leaders' | 'bracket'`. The Bracket toggle renders only when
  the season payload has a non-null `playoffs`; auto-select `'bracket'` on
  load when `phase === 'playoffs'`. The bracket view is text-first panels in
  the existing style: play-in strip, per-conference columns R1 → CSF → CF,
  Finals card, each series showing seeds/abbreviations/derived tally
  ("3–1"), winner bolded; champion banner when decided. No new design system,
  no new route, no `TopChrome` change.
- Header/advance controls: during playoffs show a "Playoffs — {date}" label
  and keep Next Day / Sim Week plus a rest-mode "Sim Playoffs" button; only
  the new `seasonOver` collapses controls to "Season complete — Champion
  {abbrev}". Rewire the page's previous `seasonOver` uses to
  `regularSeasonOver` where the old meaning was intended.
- `src/app/menu/page.tsx`: add `playoffs: 'Playoffs'` to the exhaustive
  `PHASE_LABEL` map. There is no live `seasonOver` branch to rewire. The
  champion tag in save summaries arrives via `buildSummary` for free.
- Optional, explicitly non-blocking: extend the standings top-8 accent to
  mark seeds 7–10 as play-in; skip if it grows the diff.

### 9. `scripts/test-playoffs.ts` (new harness)

Follow the `let failures` / `check(label, ok)` / final
`PASS — all checks green` + exit-1 convention (exemplar:
`test-season-monotonic.ts`). Load `data/teams.json` / `data/players.json`
directly. **Do not import `scripts/s2d-activation-context.ts`** — that gate
anchors engine profiling/calibration runs; this harness asserts bracket
determinism, not sim distributions. Note the ~3-minute runtime (one full
regular season + two postseasons) in the header comment.

**Section A — pure seeding/tiebreakers (synthetic fixtures, fast):**
1. Seeds order by win pct.
2. Two-team tie broken by head-to-head.
3. H2H even → division-leader rung decides.
4. → conference-record rung.
5. → point-differential rung.
6. → teamId rung (stable).
7. A three-team tie uses per-team H2H keys against the complete tied group and
   produces the declared transitive order (never a pairwise comparator).
8. Finals home court: better overall record wins; an exact record tie follows
   Finals H2H → point differential → teamId, with a fixture for each rung.
9. Same inputs twice → deep-equal output (no-RNG smoke check), and
   `deterministicSeed` is exported and stable for a known `(seed, id)` pair.

**Section B — full postseason from a fixed-seed season (e.g. seed 2026):**
10. `advanceSeason(state, state.endDate)` → `gamesPlayed === totalGames`,
   `playoffs !== null` (transition fired in the completing call),
   `derivePhase === 'playoffs'`. Snapshot standings/playerStats/gamesPlayed
   (JSON).
11. Play-in: exactly 4 openers, ids match the documented format, hosted by
    the better seed, dates = endDate+2; deciders absent until openers
    resolve; R1 absent until the play-in resolves.
12. Advancing through the play-in day-by-day: deciders materialize with the
    fixed id/date; then R1 = 8 series with correct slot matchups from
    post-play-in seeds; all 7 games per series materialized; host sequence
    matches 2-2-1-1-1.
13. Synthetic feeder-result fixtures prove the exact R2, R3, and Finals
    topology, each later round's home-court anchor, and that a stage is not
    materialized until **both** feeders are decided.
14. Deep-copy the saved step-10 completed-regular-season state → run the
    postseason twice from independent copies, once day-by-day and once via a
    single
    `advanceSeason(copy, horizon)`: final `playoffs` JSON, results set,
    `playoffPlayerStats`, and champion all byte-identical (champion stable
    across two runs AND granularity independence in one check).
15. Full postseason completes: every constructed series has a derived
    winner; `playoffChampion !== null`; unneeded games 5–7 of short series
    absent from `results`, `playablePlayoffGames`, `nextPlayoffGameDate`, and
    API-style upcoming selection. A one-shot horizon run must never play a
    post-clinch slot.
16. Freeze: post-champion standings/playerStats/gamesPlayed byte-identical to
    the step-10 snapshot; playoff summaries present in `results` with `PO-`
    ids; `playoffPlayerStats` non-empty and only for postseason
    participants.
17. Idempotency: hand-rewind `currentDate`, re-advance to the horizon → zero
    games returned, full-state snapshot unchanged.
18. `derivePhase === 'offseason'` after the champion; `buildSummary` contains
    the champion's abbreviation.
19. Play-in disabled: `initPlayoffs(state, teams, { playIn: false })` on the
    completed season → no play-in games, R1 direct from seeds 1–8,
    deterministic.
20. Grandfather at engine level: a completed state with `playoffs` forced to
    `null` and no regular games left → `advanceSeason(…, horizon)` constructs
    nothing and plays nothing; `derivePhase === 'offseason'`.

**Section C — injury and persistence contracts (deterministic):**
21. Legacy history fixture: an entry without `onsetGameId` returns its stored
    `gamesMissed` unchanged.
22. Result-derived history fixtures: pre-game onset includes the onset game;
    in-game onset excludes it; both cap at `maxGamesMissed`; a team eliminated
    before the cap reports only games it actually played; a late regular-season
    injury correctly continues counting its team's playoff results.
23. Inject an active injury and recovery on a known playoff participant, then
    advance its next playoff game: the existing tick/recovery transitions occur
    exactly once. This is a functional assertion, not merely a same-code
    determinism comparison. Keep random new-injury totals informational.
24. Mid-playoff persistence: write a save through `SaveStore`, reload it, and
    advance to the horizon; compare the full post-load continuation to an
    in-memory control, including bracket structure, results order, active
    injuries/recoveries, derived history counts, playoff stats, and champion.
25. Playoff roster solvency: the production fixed-seed run never reaches the
    below-five invariant; a synthetic below-five total roster throws the
    documented error rather than returning null and deadlocking.

### 10. Documentation (only after acceptance passes — see Verification)

- `docs/ROADMAP.md`: F2 outcome record in §5.2 (the F1 pattern), Wave-3 row
  status in §3.2, and §9.8 ledger → "v8 = current (F2 playoffs; v7 = F1 …)".
- `docs/PROJECT_STATUS.md`: verification evidence table entries and — since
  profile/calibrate are unchanged — re-affirm the existing SHA baselines (do
  not re-record unless the captured bytes differ, which would itself be a
  failure). Also record the regular-season advancement projection's identical
  before/after SHA and the intentional result-derived injury-history shape.
- `AGENTS.md`: codify the live v8 injury-history rule — entries stay
  append-only; legacy entries use their stored count; v8+ entries derive the
  actual-to-date/final count through `injuryGamesMissed` from immutable onset
  evidence plus `results`; consumers never invent a parallel count.
- `src/models/save.ts` docblock ledger (done in Deliverable 6).
- `README.md` only if its live text enumerates phases or the save shape.

## Scope guards — do not

- Do not modify `simulateGame`, possession/shot/foul/fatigue logic,
  `spacing.ts`, `defense.ts`, ratings, tendencies, or `engine/constants.ts`.
- Do not change RNG draw order, availability, or game outcomes on the
  regular-season path. The only permitted raw-state delta there is decision
  13's append-only injury-history representation and corrected derived counts;
  both are excluded from the game-behavior projection and reported separately.
- Do not add playoff-specific sim behavior (rotation tightening, leverage
  minutes, effort changes) — Horizon, stated as a simplification.
- Do not build anything from F3+ : no `advanceToNextSeason`, no offseason
  flow, no `careerStats` fold-in, no rotation-repair primitive, no
  development/aging, no stat stints.
- Do not add awards, finances, or league-leader playoff pages (playoff stat
  *views* beyond the bracket are Track-U work).
- Do not touch the transaction gate, validators, or transaction collections;
  do not rewrite or reorder transaction-log entries.
- Do not introduce `Math.random`, `Date.now` seeds, or any new RNG anywhere.
- Do not store any derived playoff value (series wins, champion) as its own
  source of truth.
- Do not add new `SeasonMarker` types or new API advance-mode names.
- Do not regenerate or modify anything under `data/` — the gitignored
  artifacts exist only on this machine.

## Stop-and-surface conditions

Stop and report evidence instead of guessing if:

- `SAVE_SCHEMA_VERSION !== 7` at pre-flight, or a `playoffs` field /
  `src/engine/playoffs.ts` already exists.
- Pre-flight profile/calibrate do not reproduce the recorded SHA baselines in
  `docs/PROJECT_STATUS.md`, or profile is not green.
- S3 (or other) work is in flight on the branch (§3.2 sequential-merge rule —
  F2 lands alone on main).
- `advanceSeason`, `derivePhase`, `clientState`, or the migration runner
  materially diverge from the shapes this prompt cites.
- Implementing any deliverable appears to require touching `simulateGame`,
  possession internals, `engine/constants.ts` tunables, or sim RNG order.
- The fixed-seed test season actually skips a regular-season game, or a
  production playoff team has a total roster below five. `getHealthyPlayers`
  already applies the hardship floor; report the roster-solvency violation and
  do not invent a second fill algorithm inside F2.
- The pre-change regular-season advancement projection cannot be reproduced
  after the extraction once the two new F2 fields and `injuryHistory` are
  excluded.
- Overlapping user changes make the scoped diff unsafe.

## Verification

Use the repository's configured Node runtime (nvm PATH export above); fall
back to `node --import tsx <script>` on sandbox `listen EPERM`.

Run and report all of the following:

1. `npm run typecheck` — clean.
2. `npm run profile --silent > <file>` — **byte-identical** to the pre-flight
   baseline (SHA-256 compare; PASS 32/32, exit 0, activation banner). Any
   diff is a bug.
3. `npm run calibrate --silent > <file>` — **byte-identical** to the
   pre-flight baseline.
4. `node --import tsx scripts/test-determinism.ts` — every seed line
   `IDENTICAL`, final `DETERMINISM PASSED`.
5. `node --import tsx scripts/test-saves.ts` — green, including
   reload-then-resume fingerprint identity.
6. `node --import tsx scripts/test-save-migration.ts` — full chain, direct
   v7→v8 fixtures (mid-season and completed/grandfathered), second-run
   byte-identical no-op.
7. `node --import tsx scripts/test-season-monotonic.ts` — green
   (regular-season advancement behavior unchanged).
8. `node --import tsx scripts/test-injuries.ts` and
   `node --import tsx scripts/test-calendar.ts` — green (both advance to
   `endDate`; they will now leave `playoffs` initialized, which their
   assertions do not read). `test-injuries` must consume
   `injuryGamesMissed`; report any output delta caused by correcting the old
   in-game-history overcount, but its acceptance bands and deterministic rerun
   must remain green.
9. `node --import tsx scripts/test-playoffs.ts` — all checks green
   (~3 min).
10. Re-run the exact pre-flight regular-season advancement projection after
    the implementation, again excluding `injuryHistory` and the two F2 fields.
    Its SHA-256 must equal the pre-change SHA. This is the extraction A/B
    oracle; profile/calibrate hashes are not a substitute. Separately report
    the old stored versus new derived injury-history summary and explain the
    expected in-game/carry-into-playoffs correction.
11. Scope audit: `git diff --stat` contains nothing under `src/engine/`
    except `season.ts`, `injury.ts`, and the new `playoffs.ts`; no
    `engine/constants.ts` change; no F3+ surface.

Manual/runtime checks — **persistence safety is mandatory.** `getSaveStore()`
is rooted at `process.cwd()/data/saves`; never run the app against the live
save directory without isolation. Use the F1 procedure: preferred, a
disposable working copy/worktree whose `data/saves` is a separate empty
directory (verify with `pwd` + `realpath data/saves`); fallback, atomically
move the original to `data/saves.__f2_backup__` (confirm no such path exists
first, record whether `data/saves` existed), test on a fresh directory, then
verify-and-restore against a pre-test listing/hash. Never use an unverified
destructive cleanup command. If neither isolation method can be completed
safely, STOP and report that manual runtime verification remains blocked.

- New game → "Sim to Finale" (rest): season pauses at the regular-season
  boundary; the bracket toggle appears; standings/leaders unchanged
  afterward.
- Advance again (rest): the postseason runs to a champion; the bracket view
  shows play-in → rounds → champion banner; controls collapse to the
  season-complete state.
- Save list / menu show the champion tag in the summary; reload mid-playoffs
  resumes correctly (day-by-day advancement continues the same bracket).
- A pre-v8 fixture save (completed season) loads as `offseason` with no
  bracket and no advance regression.

## Final report

Report:

- files changed and why;
- the exact bracket/id/date scheme as implemented (confirming the documented
  formats);
- confirmation that bracket construction consumes no RNG and that playoff
  seeds derive from `deterministicSeed(season.seed, gameId)`;
- confirmation the `playOneGame` extraction preserved regular-season
  availability, results, RNG order, standings, stats, active injuries, and
  recoveries, with the exact before/after advancement-projection SHA; separately
  report the intentional result-derived injury-history representation change;
- proof that post-clinch games are excluded by the shared playability selector
  from simulation, next-date, and upcoming reads;
- injury evidence: legacy-count fallback, result-derived late-season/playoff
  counts, active-injury ticking, and mid-playoff save/reload identity;
- v7→v8 migration behavior, grandfather evidence, and second-run no-op
  evidence;
- before/after profile and calibrate SHA-256 comparisons (must be identical);
- `test-playoffs.ts` full output;
- manual runtime verification results, including the persistence-isolation
  procedure used;
- every stop-and-surface item encountered.
