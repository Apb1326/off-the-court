# Off the Court

A possession-by-possession NBA simulation engine wrapped in a GM/franchise game. Off the Court plays out basketball one possession at a time — matchups, shot selection, ball-movement chains, fatigue, fouls, substitutions — and derives every box-score number from the resulting play-by-play event stream.

**Stack:** Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS v4 · JSON file persistence · `tsx` for scripts

---

## What it is

Most basketball sims either roll a final score from team ratings or play a simplified loop where every possession is a single shot. Off the Court does neither. A possession starts with an action that may or may not create an advantage; if it does, the ball can move through additional actions to exploit it before the defense recovers; and the possession resolves into an outcome that emits `PlayByPlayEvent`s. Stats are never assigned directly — they fall out of that event stream after the fact.

The design goal is that **roster construction matters**. Five high-usage scorers don't sum into a great offense, and four non-shooters around a star don't open the same driving lanes as four shooters. The engine explicitly models the things that make individual ratings non-additive: lineup spacing, defensive versatility, and the advantage-driven ball-movement chain.

## Core concepts

**Dual-layer ratings (true vs. scouted).** Every `Player` carries true `ratings`, a `potential` ceiling, and a `scoutingAccuracy`. The simulation always resolves from the true `ratings`. The scouted view is derived separately (`ratings/scouting.ts`) by adding Gaussian noise scaled by `(1 - scoutingAccuracy)`, and accuracy improves as a player logs minutes. Scouting error is a feature.

**1–80 rating scale centered at 40.** League average is 40, not 50. Shot math centers on it directly: `ratingToModifier` maps `(rating - 40) / 40` into a modest, slightly convex swing. Code that assumes a 0–100 scale or a midpoint of 50 is wrong.

**Possession loop with advantage-keyed chains.** The possession is the atomic unit (`engine/possession.ts`). After the initial action, the ball can move through up to `MAX_EXTRA_PASSES` additional actions. Shot-quality bonuses are keyed to *advantage state* — a live double-team, a drive that collapses the help — not to raw pass count. A pass that cashes a live advantage earns a bonus with diminishing returns and a hard ceiling; a no-advantage reset earns nothing but still burns clock and carries bad-pass risk. A double-team routes into the chain as a real kick-out to the open man, weighted toward shooters worth creating for (`openManWeight`). Late in the shot clock, shot quality takes a rush penalty. The chain is the **only** source of assists: the player who threw the pass into a made shot is credited; an unassisted make has no passer.

**Spacing & lineup fit.** `engine/spacing.ts` distills the four off-ball players into a single centered spacing value the offense consumes — gravity from outside shooting weighted by three-point tendency, plus a small threat-gated movement term. A separate defensive-versatility z-score models switchability off the weak-link perimeter defender and mobility/size spread. Both are pure arithmetic over the players given — no RNG — so they're fully deterministic. Better spacing opens the rim and softens contests; better versatility blunts mismatch hunting.

**Deterministic RNG.** All randomness flows through `SeededRNG` (`lib/rng.ts`, a mulberry32-style generator). The same seed produces a byte-identical game — box score and full play-by-play. This is what makes calibration and regression testing possible. `Math.random()` is never used in simulation code.

**Stats derived from events.** The possession code contains intentional no-op `addXStats` stubs; the real accounting happens in `engine/index.ts`, where `recordEventStats` walks the `PlayByPlayEvent` stream and drives the `StatsAccumulator`. The event stream is the single source of truth for the box score.

**Calibration discipline.** The engine is tuned against real NBA distributions. `npm run profile` is the acceptance test: it simulates a season and checks the per-team-per-game profile against empirically derived league targets with derived tolerance bands — the targets come from real stats.nba.com data (`data/nba/normalized/`, 2023-24..2025-26 pooled) via `npx tsx scripts/derive-league-targets.ts`, with full provenance in [docs/LEAGUE_TARGETS.md](docs/LEAGUE_TARGETS.md) — and exits non-zero on any enforced failure. `npm run calibrate` is a separate, deterministic **historical drift comparison** against six decades of games by era; its benchmark ends in 2015, so a modern-tuned engine sits above its recent-era rows by design — it informs, it doesn't pass or fail a change. Non-engine work must leave both outputs byte-identical.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

The app reads its gitignored `data/` directory from the deterministic NBA-derived
production builder. Populate `data/nba/normalized/`, then run `npm run build-league`.

## Scripts

Wired into `package.json`:

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run download-history` | Fetch historical CSVs into `data/history/` (prerequisite for `calibrate`) |
| `npm run calibrate` | Deterministic historical drift comparison vs. six decades of real games by era (benchmark ends 2015 — informational, not pass/fail) |
| `npm run profile` | The engine acceptance test: season profile vs. modern-NBA targets with derived tolerance bands; exits non-zero on enforced failure |
| `npm run validate-nba-data` | Structural validation of `data/nba/normalized/` contracts (missing files are SKIPPED) |
| `npm run build-league` | Deterministically validates and promotes the NBA-derived active `data/teams.json` + `data/players.json`, recording a promotion manifest that profile/calibrate verify; `--check` byte-compares the pair + manifest; `--out-dir` redirects output (harness isolation) |

Run directly with `tsx` (not wired to npm), each requires a populated `data/`:

| Command | Purpose |
|---------|---------|
| `tsx scripts/test-determinism.ts` | Asserts same seed → identical box score + play-by-play hash |
| `tsx scripts/test-spacing-ab.ts` | A/B: same star with four shooters vs. four non-shooters; asserts a material rim-rate and TS% gain (exits non-zero if not met) |
| `tsx scripts/test-defense-ab.ts` | Defensive-versatility A/B |
| `tsx scripts/calibrate-spacing.ts` | Derives spacing and defensive-versatility baselines/spreads from representative active-pool lineups |
| `tsx scripts/derive-league-targets.ts` | Derives the profile's league targets + tolerance bands from `data/nba/normalized/`; writes `docs/LEAGUE_TARGETS.md` (`--check` verifies byte-identical; `--seasons=` overrides the 3-season default) |
| `tsx scripts/test-sim.ts` · `test-season.ts` · `test-calendar.ts` | Single-game, full-season, and calendar smoke tests |

## Project structure

```
src/
  models/        Domain types: player, team, game (PlayByPlayEvent, ShotZone, StatLine), season, save
  ratings/       Dual-layer ratings — derivation, attributes, scouting (true → scouted noise)
  lib/           SeededRNG, seed boundary resolver (seed.ts), string hashing, UI helpers
  engine/        The simulation core
    index.ts          simulateGame: game loop, momentum, home-court edge, per-game form, stat recording
    possession.ts     Possession loop + advantage-keyed ball-movement chain
    spacing.ts        Lineup spacing + defensive versatility (pure arithmetic)
    shot.ts           Contest level, make/miss, shooting fouls, free throws
    defense.ts        Rim protection, defensive pressure, double-team decision
    turnover.ts       Live-ball turnovers and steals
    play-types.ts     Play-type / shot-zone / primary / defender selection
    tactics.ts        Game-state context: clock management, three-chasing, intentional fouls
    injury.ts · rebound.ts · clock.ts · fatigue.ts · substitution.ts · schedule.ts · season.ts · calendar.ts
    stats-accumulator.ts   Builds box scores from recorded events
    constants.ts      All tunable numbers (calibration knobs, chain costs, spacing/versatility params)
  transactions/  GM-layer state mutation: validate-then-mutate gate, composable validators,
                 contracts, cap/apron/tax, dead money, TPEs, exceptions, sign-and-trade,
                 CPU evaluation stub (evaluate.ts), contract rollover seam (rollover.ts)
  data/
    store/         JSON persistence (JsonStore) and types
    saves/         Multi-save store: per-slot folders, atomic writes, schema migrations
    nba/           Read-only loaders/types for data/nba/normalized/ contracts
  app/             Next.js App Router — pages (/, menu, league, roster, schedule,
                   player/[id], game/sim) and API routes (players, teams, sim, season, saves)
scripts/           league builder, history download, calibration, profiling, target derivation,
                   diagnostics, A/B + smoke tests, save-migration round-trips
docs/              ROADMAP, TRANSACTIONS_ROADMAP, PROJECT_STATUS (verified snapshot),
                   LEAGUE_TARGETS (target provenance), frozen S2 evidence records,
                   prompts/ (archived phase implementation prompts)
data/              Generated league + saves (gitignored): teams.json, players.json, season.json,
                   saves/<slot>/, seasons/<id>/games/*.json, history/*.csv, nba/ (pipeline output)
```

## NBA data pipeline

`pipeline/` holds a standalone, offline-only Python tool that harvests a
large dataset from stats.nba.com (via `nba_api`) into a gitignored raw cache
(`data/nba/raw/`) and normalizes it into versioned JSON contracts
(`data/nba/normalized/`). Those contracts are the only interface to the app:
TypeScript reads them through `src/data/nba/load.ts` and never calls
stats.nba.com. It is run manually from a residential IP — never in CI or at
app runtime — and changes nothing about the simulation; later stages will
consume the data to re-derive calibration targets and ratings.

```sh
pipeline/.venv/bin/python pipeline/harvest.py --manifest pipeline/manifests/default.json
pipeline/.venv/bin/python pipeline/normalize.py
npm run validate-nba-data
```

Setup, the full-harvest workflow (~2–3 hours, resumable), and the contract
docs live in [pipeline/README.md](pipeline/README.md).

## Calibration & testing

There's no traditional unit-test suite as the primary safety net — calibration is. After any change to simulation logic:

1. `npm run typecheck` — clean.
2. `npm run profile` — the acceptance test: every ENFORCED stat (the box profile plus per-zone FG%, the six-zone/three-bucket shot mix, and average margin) lands within its derived tolerance band; the script exits non-zero otherwise. Targets and bands come from `scripts/derive-league-targets.ts` (provenance: `docs/LEAGUE_TARGETS.md`). INFORMATIONAL stats (play-type distribution, assisted rates by zone, etc.) are logged with the stage that owns them, never failed on. Assists and turnovers move most when chain logic changes; watch them.
3. `npm run calibrate` — the deterministic historical drift comparison: report the deltas and explain their direction. It cannot pass or fail a change (its benchmark ends in 2015), but non-engine work must leave its output byte-identical.
4. `tsx scripts/test-determinism.ts` — same seed still produces an identical game.
5. `tsx scripts/test-spacing-ab.ts` — spacing still produces a material, correctly-signed difference.

If a stat drifts out of band, the fix is almost always a constant in `engine/constants.ts`, not a structural change.

## Conventions

- Tunable numbers live in `engine/constants.ts`, annotated — no magic numbers in engine logic.
- Stats are derived from the `PlayByPlayEvent` stream, never hand-assigned. The `addXStats` stubs in `possession.ts` are intentional no-ops; leave them.
- Spacing and versatility are pure arithmetic and must stay RNG-free so they don't perturb the seeded stream.

See `AGENTS.md` for the full engineering rules any contributor — human or AI — must follow.
