# F1 — Team selection and controlled-franchise identity (Track F, Wave 1b)

You are working on Off the Court, a possession-by-possession NBA simulation and
franchise game (Next.js 16, React 19, TypeScript 5, Tailwind v4, JSON persistence).

This is a non-engine, schema-conscious franchise phase. Keep the implementation
small and reviewable. Do not start a later franchise or transaction phase.

> **Execution prerequisite:** R0b must already be merged into the branch before
> this prompt runs. R0b landed locally at `d185824` on 2026-07-07; verify the
> current `HEAD` contains that commit and that the live roadmap marks R0b complete.
> Do not implement F1 from pre-R0b `bfb8273` or from a concurrent side branch. If
> the prerequisite is unmet in another checkout, STOP and report it.

## Before anything else

1. Read `AGENTS.md` in full. Its rules are binding and override this prompt where
   they conflict.
2. Read `docs/ROADMAP.md` §0, the sequencing table in §3, §5.1 (F1), §9.8, and
   the relevant stop conditions in §10/Appendix A. Confirm that R0b has landed
   and F1 is allowed to begin. If the live roadmap still marks R0b pending, STOP
   and surface that sequencing conflict.
3. Inspect the complete worktree (`git status --short`) and preserve unrelated
   staged, unstaged, and untracked changes. If existing changes overlap this
   phase and cannot be preserved safely, STOP and surface them.
4. Read the relevant Next.js 16 guides under `node_modules/next/dist/docs/` before
   editing the App Router menu or route handler. Do not rely on remembered Next.js
   conventions.
5. Locate the save model, store, migrations, and tests. Confirm all of the
   following live facts before editing:
   - `SAVE_SCHEMA_VERSION` is exactly `6`.
   - `controlledTeamId` is not already a canonical persisted field on `SaveFile`.
   - no controlled-team accessor module already exists.
   - `scripts/test-save-migration.ts` and `scripts/test-saves.ts` are the existing
     migration and save-store checks.
   - the menu already has a new-game flow and the season API already constructs
     the new `SaveFile`.
6. Existing per-call `controlledTeamId?` options in the transaction gate and
   `noControlledTeamNtc` validator are expected Phase-4 seams, not a partial F1
   implementation. Do not treat those known references as staleness by themselves.
7. Before editing, capture successful baseline output for `npm run profile` and
   `npm run calibrate` into separate files outside the repo. Preserve the exact
   stdout/stderr for byte comparison after the change. If `npm run profile` is
   not green, STOP: F1 requires the accepted post-S1-R/R0b baseline.

If the schema version is not v6, R0b has not landed, the persistence machinery
differs materially, or `docs/ROADMAP.md` §5.1 conflicts with this prompt, STOP and
report the evidence instead of reconciling it yourself.

## Goal

Give every save one canonical, persistent answer to “which team does the user
control?” This identity belongs to the franchise save and outlives any individual
season. The transaction layer remains symmetric: `TradeProposal`, legality, and
the gate do not gain controlled-vs-CPU branching.

## Deliverables

### 1. Canonical identity on `SaveFile`

- Add `controlledTeamId: string | null` to top-level `SaveFile` in
  `src/models/save.ts`.
- Document `null` as spectator/commissioner mode with no controlled team.
- This field must have exactly one canonical persisted home. Do **not** add it to
  `SeasonState`.
- Do **not** change `createSeasonState` or any file under `src/engine/`. The season
  constructor creates season state; the season API boundary creates the save and
  owns controlled-team selection.
- In the new-game season API, accept `controlledTeamId` as `string | null`.
  Default an omitted value to `null` to preserve spectator behavior.
- Validate a non-null value against the exact team ids in the roster snapshot
  used to create the save. Reject malformed types or unknown ids with HTTP 400
  and a clear error. Never silently coerce an invalid id to `null`.
- Persist the validated value on the newly constructed `SaveFile`.
- Keep the existing new-game API response contract unless the live UI independently
  requires a change. Do not duplicate controlled identity into `SeasonState` or
  `clientState` merely to expose it in the response; runtime verification inspects
  the persisted autosave instead.

### 2. One accessor pair

Create `src/franchise/controlled.ts` unless a clearly established live convention
provides a better home. Export exactly:

- `getControlledTeamId(save: SaveFile): string | null`
- `isControlledTeam(save: SaveFile, teamId: string): boolean`

Both functions are pure and contain no RNG or mutation. Do not add
`getCpuTeamIds` or any CPU-agency helper in F1.

All production reads of the canonical field must go through this accessor pair.
Direct field access is allowed only where structurally necessary: the type
definition, fresh-save construction/write, schema migration, and focused tests.
Add one concise rule to the transaction-layer section of `AGENTS.md`: controlled
identity is read through these accessors, while the legality gate remains
symmetric and never branches on controlled status.

### 3. Preserve the existing NTC seam without expanding it

- Audit game-facing transaction call sites outside `src/transactions`.
- If an existing call site has a `SaveFile` in hand, pass the canonical value
  through the accessor to the gate's existing optional `controlledTeamId` option
  (`null` may be omitted or translated to `undefined` at that existing API seam).
- If no such game-facing call site exists, report that fact and make no synthetic
  call site or transaction UI merely to demonstrate wiring.
- Do not modify `TradeProposal`, the gate, validators, `evaluateTradeForCpu`, or
  legality behavior. The existing per-call option remains the entire transaction
  seam for F1.

### 4. Schema bump and deterministic migration (v6 → v7)

- Bump `SAVE_SCHEMA_VERSION` from 6 to 7.
- Extend the schema-history docblock in `src/models/save.ts` with the v6→v7 F1
  migration.
- Add the next ordered migration step in `src/data/saves/migrations.ts`.
- A v6 or older save without the field migrates to top-level
  `controlledTeamId: null`.
- Preserve all prior state and append-only logs byte-for-byte apart from required
  schema migration changes.
- The migration is deterministic and uses no RNG.
- Migrating a current v7 save a second time must report no migration and return a
  byte-identical canonical JSON representation.
- Do not create a parallel migration harness:
  - extend `scripts/test-save-migration.ts` with a direct v6→v7 fixture, the full
    old-version→current chain, and the second-run byte-identical no-op assertion;
  - extend `scripts/test-saves.ts` for controlled-team and spectator persistence
    through the real `SaveStore` save/load/copy flow.

### 5. Save-list metadata and summary

The existing metadata scheme already has the derived `summary` field and
`buildSummary`; extend that path rather than inventing a new metadata format.

- When `controlledTeamId` is non-null, include the controlled team's
  abbreviation as a concise tag in the save summary.
- Preserve the existing league-wide progress/leader information; extend it, do
  not replace it.
- Spectator saves retain the existing league-wide summary with no fabricated
  team tag.
- Use the controlled-team accessor when deriving metadata from a `SaveFile`.
- Do not add separate controlled-team name/abbreviation fields to `SaveMetadata`
  unless the live shape has independently established that exact pattern.
- Add focused checks for the controlled tag, spectator summary, and persistence
  across metadata regeneration.

### 6. Minimal new-game team picker

- Extend the existing menu new-game panel; do not build a new screen.
- Load the real team list through the existing teams API using the current App
  Router conventions.
- Add one functional selector containing every team plus an explicit
  “No team (commissioner/spectator)” choice mapped to `null`.
- Default to `null` so existing new-game behavior remains spectator mode until a
  team is chosen.
- Send the selected `controlledTeamId` in the existing season API request as
  `{ action: 'new', controlledTeamId }`. The API, not the client, is the
  authority for id validation.
- Match the existing Tailwind v4/menu styles. Add no logos, previews, depth-chart
  controls, roster-management UI, or new design system.

## Scope guards — do not

- Do not modify any file under `src/engine/`, including `createSeasonState`.
- Do not modify simulation, possession, ratings, RNG order, or tuning constants.
- Do not modify the transaction gate, validators, proposal shapes,
  `evaluateTradeForCpu`, or legality logic.
- Do not add CPU behavior keyed on controlled status.
- Do not build roster management, rotation editing, depth charts, GM pages, or
  any later Track-F/Track-T feature.
- Do not introduce `Math.random`, `Date.now` seed fallbacks, or any new RNG.
- Do not rewrite or reorder transaction-log entries.
- Do not introduce a second canonical controlled-team field or cache a derived
  controlled-team name/abbreviation as independent save state.

## Stop-and-surface conditions

Stop and report evidence instead of guessing if:

- R0b is not merged into the branch being edited, or the roadmap does not permit
  F1 to begin.
- the schema is not v6 before this phase;
- a canonical `SaveFile.controlledTeamId` field or accessor module already exists
  (the known gate/validator option alone does not count);
- the roadmap places the identity somewhere other than top-level `SaveFile`;
- the existing new-game menu, season API, `scripts/test-save-migration.ts`, or
  `scripts/test-saves.ts` is absent or materially incompatible;
- the pre-change profile is not green;
- implementing the picker appears to require changing simulation code or the
  transaction gate;
- overlapping user changes make the scoped diff unsafe.

## Verification

Use the repository's configured Node runtime. If direct `tsx` execution hits the
known sandbox `listen EPERM` issue, use `node --import tsx <script>`.

Run and report all of the following:

1. `npm run typecheck` — clean.
2. `node --import tsx scripts/test-save-migration.ts` — direct v6→v7, full chain,
   and second-run byte-identical no-op all pass.
3. `node --import tsx scripts/test-saves.ts` — controlled and spectator saves,
   metadata, and real persistence flows pass.
4. `node --import tsx scripts/test-contract-migration.ts` — prior contract and
   append-only migration invariants still pass.
5. `node --import tsx scripts/test-determinism.ts` — same seed remains identical.
6. Re-run `npm run profile`, capture exact output, and byte-compare it with the
   pre-change baseline. It must remain green and unchanged.
7. Re-run `npm run calibrate`, capture exact output, and byte-compare it with the
   pre-change baseline. It must be unchanged.
8. Audit every `controlledTeamId` reference. Confirm production reads use the
   accessor pair and every remaining direct reference is one of the explicitly
   allowed structural boundaries.

Manual/runtime checks:

**Persistence safety is mandatory.** `getSaveStore()` is rooted directly at
`process.cwd()/data/saves`; these checks must never run against the user's live
save directory without isolation. Before starting a dev server, choose and record
one of these procedures:

1. **Preferred — disposable working copy/worktree:** run the app from a disposable
   checkout whose `data/saves` is a separate empty directory. Copy or link only the
   non-save data needed to boot, and verify with `pwd` plus `realpath data/saves`
   that it cannot resolve to the primary checkout's save directory.
2. **Fallback — exact backup and restore:** stop every dev server first; confirm no
   `data/saves.__f1_backup__` path already exists; record whether `data/saves`
   originally existed; atomically move the original directory to
   `data/saves.__f1_backup__`; create/use a fresh `data/saves` for the checks; stop
   the server after testing; move the test directory aside; then atomically restore
   the original directory (or restore its original absence). Verify the restored
   save directory against a pre-test file listing/hash before removing any test
   artifacts. Never use an unverified destructive cleanup command.

If neither isolation method can be completed safely, STOP and report that manual
runtime verification remains blocked. Automated save tests must continue using
their existing temporary directories.

- Create a game controlling a real team; inspect the isolated persisted autosave
  and confirm it contains that id, the save-list summary shows its abbreviation,
  and save/load retains it. Do not require the API response to expose the id.
- Create a spectator game; confirm `controlledTeamId === null`, the summary stays
  league-wide, and save/load retains `null`.
- Send a new-game request with an unknown id and with a non-string/non-null value;
  confirm each returns HTTP 400 and leaves the isolated persisted save byte-identical.
- Confirm all teams appear once in the selector and the no-team option maps to
  `null`.

## Documentation

Update documentation only for behavior that actually ships:

- the schema ledger/docblock: v7 = F1 controlled-franchise identity;
- the one-line `AGENTS.md` accessor/symmetric-gate invariant;
- `docs/ROADMAP.md` F1 status and current schema ledger, but only after every F1
  acceptance check passes;
- `README.md` only if its live state/persistence section enumerates the affected
  save shape or user-facing new-game behavior.

Do not document future CPU agency or GM features.

## Final report

Report:

- files changed and why;
- confirmation that the canonical field is top-level on `SaveFile`, not
  `SeasonState`;
- API validation behavior and the accessor location;
- v6→v7 migration behavior and second-run no-op evidence;
- whether any existing game-facing transaction call site was available to wire;
- automated and manual verification results;
- exact before/after profile and calibrate comparison results;
- every stop-and-surface item encountered.
