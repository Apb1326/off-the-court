# F2 review fixes — implementation prompt

> **Scope:** post-merge cleanup of the F2 playoffs implementation (PRs #32/#33,
> merged at `c8e4b46`). Seven verified review findings, none release-blocking.
> No new mechanics, no schema change, no sim-engine behavior change. This is a
> single tidy-up unit: every fix below is either a guard restoration, an error-
> surface improvement, or a behavior-identical refactor.

## Reading order

1. `AGENTS.md` — hard rules. The ones that bind here: determinism (#2), the
   verification checklist, "derive, don't store", and the transaction-layer
   calibration note (profile/calibrate must come back **byte-identical** —
   nothing in this unit touches `simulateGame`/`simulateSeason` paths).
2. `docs/PROJECT_STATUS.md` — current verified baselines (stdout SHA-256 for
   profile/calibrate). Your post-change hashes must match them exactly.
3. This file, end to end, before writing any code.

## Ground rules for this unit

- **Zero behavior change to simulation or seeding output.** Every refactor
  here must be provably identity-preserving. If a fix appears to require a
  behavior change beyond what its contract states, stop and surface.
- **`npm run profile` and `npm run calibrate` stdout must be byte-identical**
  to the recorded baselines (capture with `--silent`, compare SHA-256).
- Small, reviewable commits — one commit per finding is ideal; combining the
  two save-path findings (1 and 5) is acceptable.
- Environment: node lives under nvm (`export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"`);
  if the `tsx` CLI hits sandbox `listen EPERM`, use `node --import tsx <script>`.

---

## Finding 1 — unwrapped validation throws on the save path

**Where:** `src/data/saves/save-store.ts:135-137` and the `saves.autoSave(file)`
call sites in `src/app/api/season/route.ts` (lines ~184, ~239, ~279).

**Problem:** `writeSave` intentionally calls `derivePlayoffStatus(season)` and
`deriveChampion(season)` purely for validation-by-throw (the comment says so;
returns are discarded). Nothing on the path catches: a ledger/bracket desync
that `syncPlayoffs` missed crashes the whole request as a raw Next.js 500, and
the in-memory progress legitimately advanced in that same request is lost with
an unstructured error.

**Fix (keep the validation, structure the failure):**
- Do **not** swallow the throw or persist an invalid save — validation-by-throw
  stays; an invalid ledger must never reach disk.
- Introduce a typed error (e.g. `SaveValidationError extends Error` with a
  `code` field) thrown from the write path when derive-validation fails.
- At the API boundary (`route.ts`), wrap the advance-then-autosave sequence so
  a `SaveValidationError` returns the route's standard structured JSON
  `{ error: ... }` shape with an appropriate status, matching every other
  error path in that handler, instead of an unhandled 500.
- While there: `derivePlayoffStatus` only reaches `deriveChampion` once
  `gamesPlayed >= totalGames`, so the explicit `deriveChampion` call is **not**
  redundant mid-season — keep both calls, but add a one-line comment stating
  why both are needed so a future reader doesn't "simplify" one away.

**Acceptance:** a hand-corrupted save (append a playoff result with a
non-canonical id/date to `state.results` in a scratch fixture) fails to write,
returns structured JSON from the API, and leaves the previously persisted file
untouched. Add this as a check in `scripts/test-saves.ts`.

## Finding 2 — schema-version literal pin dropped

**Where:** `scripts/test-phase5a.ts:402`.

**Problem:** the F2 diff deleted `&& SAVE_SCHEMA_VERSION === 7` from the
round-trip check instead of updating it to `=== 8`. No test anywhere now pins
the literal value — every remaining assertion compares `schemaVersion ===
SAVE_SCHEMA_VERSION`, which is tautological and stays green if the constant is
accidentally bumped or merge-conflicted to the wrong number.

**Fix:** restore the literal pin as `SAVE_SCHEMA_VERSION === 8` in that check.
When a future phase legitimately bumps the schema, updating this literal is
part of that phase's migration work — add a brief comment saying exactly that
so the pin isn't deleted again as "stale".

**Acceptance:** `node --import tsx scripts/test-phase5a.ts` passes; temporarily
setting `SAVE_SCHEMA_VERSION = 9` makes it fail (verify locally, then revert).

## Finding 3 — "current round" label follows array order, not round order

**Where:** `src/models/save.ts` (`buildSummary`, ~line 119-121) and
`src/app/schedule/page.tsx` (`ControlBar`'s series `find()`, ~line 292).

**Problem:** both pick the **first unresolved series in array order**.
`buildBracket` pushes first-round series for both conferences together, but the
second loop advances semis → conference-finals fully **per conference** — so
East's unresolved conference-finals series can sit before West's unresolved
semifinal in the array. The label then reads "Conference Finals" while
semifinal games are still being played.

**Fix:** select by **earliest round among unresolved series**, not array
position. Define one canonical round order — `play_in < first_round <
conference_semifinals < conference_finals < finals` — as a small exported
helper next to the `PlayoffRound` type or in `src/engine/playoffs.ts` (e.g.
`playoffRoundOrder(round): number` or a `derivePlayoffRoundLabelSeries(state)`
that returns the earliest-round unresolved series). Use it in **both**
consumers; do not leave two independent selection rules.

**Acceptance:** unit check in `scripts/test-playoffs.ts`: construct a state
where East has completed its semis (unresolved CF series exists) while a West
semifinal is unresolved; assert the derived label round is
`conference_semifinals`. UI reads the same helper.

## Finding 4 — advanceSeason snapshot: unconditional JSON round-trip

**Where:** `src/engine/season.ts:184` (snapshot) and `:191` (restore).

**Problem:** `const before = JSON.stringify(state)` runs on **every** call,
including pure regular-season advances where the restore (gated on
`postseasonInScope`) can never execute — a full-state serialization bought for
nothing. And the clone idiom is wrong for this codebase: `structuredClone` is
the established deep-clone used throughout `src/transactions/` (`gate.ts`,
`rollover.ts`); a JSON round-trip silently mangles `undefined`/`Date`/`NaN`
if `SeasonState` ever gains one.

**Fix:**
- Take the snapshot **only when `postseasonInScope` is true** (compute the
  flag first, then snapshot conditionally).
- Use `structuredClone(state)` for the snapshot and restore by copying the
  clone's fields back onto the live `state` object (the restore must keep the
  same object identity for `state`, since callers hold the reference — mirror
  how the current JSON.parse restore reassigns; verify this carefully).
- No other logic change: restore still fires only on the postseason-scope
  failure path; the rethrow stays.

**Acceptance:** `scripts/test-season-monotonic.ts`, `scripts/test-playoffs.ts`,
and `scripts/test-determinism.ts` all pass unchanged. Behavior identical on
the success path by construction (snapshot is never read on success).

## Finding 5 — zeroed playoff-stats shape built in three places

**Where:** `src/data/saves/migrations.ts:287` (`zeroPlayoffStats`, the named
helper), `src/app/api/season/route.ts:~124` (inline literal), and
`src/data/saves/save-store.ts:~126` (inline literal).

**Problem:** three independent constructions of the
`{playerId, teamId, gamesPlayed, gamesStarted, minutes, totals: emptyStatLine()}`
array. (`emptyPlayoffs` is already properly shared from `@/models/season` —
this is the one remaining copy-paste.) A field added to the playoff stat-line
shape must be updated in three places; miss one and saves pass one write path
but carry stale defaults through another.

**Fix:** move `zeroPlayoffStats(players)` to the shared home next to
`emptyPlayoffs` in `src/models/season.ts`, export it, and have all three sites
import it. Delete both inline literals. Keep the function byte-for-byte
equivalent in output to the current copies (they are already identical shapes —
verify field-by-field before deleting).

**Acceptance:** `scripts/test-save-migration.ts` round-trip stays green and
migration-twice remains a no-op; grep confirms exactly one construction site of
the playoff stat-line default shape.

## Finding 6 — duplicated head-to-head tiebreak in `rankConference`

**Where:** `src/engine/playoffs.ts:56-75` (division-leader block) and
`:84-100` (conference-ranking block).

**Problem:** the h2h map construction is repeated verbatim, and the comparator
chains are identical except the second inserts one division-leader clause. A
future tiebreak edit applied to one copy silently desyncs division-leader
selection from overall seeding.

**Fix (behavior-identical refactor):**
- Extract `buildH2h(tied: TeamStanding[], results: GameSummary[])` returning
  the win/loss map.
- Extract a comparator factory that takes the h2h map and an optional
  "extra clause" comparator slotted between the h2h term and the conf-pct
  term; the division-leader boost becomes that optional clause in the second
  call site.
- The resulting sort order must be **provably identical**: same clause order,
  same `pct`/`pointDifferential`/`compareIds` fallbacks, stable inputs.

**Acceptance:** `scripts/test-playoffs.ts` passes unchanged, and — because
seeding feeds the whole bracket — re-run the full verification suite. This is
the one refactor in this unit that could silently change sim-adjacent output
if botched; treat any seeding difference as a defect in the refactor, never as
an acceptable delta.

## Finding 7 — back-to-back duplicate `syncPlayoffs` calls

**Where:** `src/engine/season.ts:387` (inside the `!isPlayoff` branch) and
`:389` (unconditional, immediately after).

**Problem:** two calls with no intervening state change; the first is dead
weight and obscures which call is load-bearing. (Verified not a performance
issue — ~0.1% of profile runtime — this is purely a clarity fix.)

**Fix:** delete the call at `:387`, keep the unconditional one at `:389`, and
keep/adjust the boundary comment above the `gamesPlayed++` so the intent
("sync once per completed game, after the ledger push and counter bump")
stays documented.

**Acceptance:** `scripts/test-playoffs.ts`, `scripts/test-season-monotonic.ts`
pass unchanged.

---

## Verification checklist (run after all fixes, report results)

- [ ] `npm run typecheck` — clean.
- [ ] `node --import tsx scripts/test-playoffs.ts`
- [ ] `node --import tsx scripts/test-save-migration.ts` (+ migration-twice no-op)
- [ ] `node --import tsx scripts/test-saves.ts` (including the new Finding-1 check)
- [ ] `node --import tsx scripts/test-season-monotonic.ts`
- [ ] `node --import tsx scripts/test-phase5a.ts` (with the restored `=== 8` pin)
- [ ] `node --import tsx scripts/test-determinism.ts` — every seed `IDENTICAL`.
- [ ] `node --import tsx scripts/test-spacing-ab.ts` — `SPACING A/B PASSED`.
- [ ] `npm run profile --silent > out` — **byte-identical** SHA-256 vs the
      baseline in `docs/PROJECT_STATUS.md`. Any diff is a bug in this unit.
- [ ] `npm run calibrate --silent > out` — byte-identical likewise.
- [ ] `npm run build`
- [ ] Scope guard: no schema bump (none is needed — no persisted shape
      changed), no later-phase mechanics, no new tunables outside
      `constants.ts` (none should be needed).

## Report

For each finding: what changed, and the proof it is behavior-identical (test
name or hash). Lead with the profile/calibrate hash comparison.
