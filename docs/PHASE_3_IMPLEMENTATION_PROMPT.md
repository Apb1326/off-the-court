# Phase 3 — Salary Cap & Roster Financial State

## Preamble: read and verify before editing

You are implementing **Phase 3** of the Off the Court transactions roadmap. This phase is **compute and expose only**: it adds derived financial calculations but does not enforce them.

Before writing code:

1. Read `AGENTS.md` in full. Its hard rules override this prompt.
2. Read `docs/TRANSACTIONS_ROADMAP.md`, especially the architectural spine and Phases 2–4.
3. Inspect the current branch and working tree. Preserve unrelated user changes.
4. Run `find src/transactions -type f -name '*.ts'` and read the transaction-layer files.
5. Read these files completely:
   - `src/models/player.ts`
   - `src/models/transaction.ts`
   - `src/models/season.ts`
   - `src/models/save.ts`
   - `src/transactions/constants.ts`
   - `src/transactions/contracts.ts`
   - `src/transactions/world.ts`
   - `src/transactions/gate.ts`
   - `src/transactions/validators.ts`
   - `src/transactions/index.ts`
   - `src/data/saves/migrations.ts`
   - `scripts/test-transactions.ts`
6. Confirm these expected Phase 2 facts instead of assuming them:
   - `Player.contract` exists on every normalized player.
   - Current-year salary is `contract.salarySchedule[0]`, accessed through `currentSalary(contract)`.
   - `CutEntry.contractAtCut` snapshots the contract at the moment of release.
   - `SignEntry.contractSigned` snapshots a newly instantiated contract.
   - `normalizePlayersForSave()` upgrades legacy `data/players.json` records and repairs the initial free-agent pool.
   - `SeasonState` has `freeAgentPool` and `transactionLog`.
   - `SAVE_SCHEMA_VERSION === 3` before this phase.
7. Before editing, capture the existing outputs of:
   - `npm run profile`
   - `npm run calibrate`

If Node is not on `PATH`, use the repository’s configured Node installation rather than changing dependencies.

This task does not touch Next.js code. Do not modify `src/app` or any simulation file under `src/engine`.

### Stop-and-surface conditions

Stop and report the discrepancy without improvising if:

- The Phase 2 facts above do not match the live branch.
- `src/transactions/cap.ts` or an equivalent financial module already exists.
- The save schema is not version 3.
- A persisted cap-rights owner, cap-hold table, or other explicit rights mechanism already exists. Report its exact shape before deciding whether this prompt still applies.
- Correct implementation would require changing the gate, a transaction mutation path, `SeasonState`, `Team`, `Player`, the save schema, or simulation code.
- The pre-edit profile or calibration command fails.

---

## Goal

Give every team a derived financial position without changing transaction legality.

Phase 3 must answer:

- What is the team’s current standard-contract payroll?
- What temporary free-agent holds and incomplete-roster charges count against cap room?
- How much cap room does it have?
- Where does its actual payroll sit relative to the tax and apron thresholds?

Transactions continue to pass or fail on the existing roster-legality rules only. Do not modify the validate-then-mutate gate.

---

## Fixed design decisions for this phase

### 1. Rules year

Pin the financial constants to the **2025–26 NBA salary-cap year** and expose that choice:

```ts
export const CAP_RULES_YEAR = '2025-26';
```

This is a game-rules configuration, not a claim that the simulation calendar already selects year-specific cap tables. Multi-season cap growth and year-indexed cap tables are deferred. Do not modify the current season calendar.

The official 2025–26 system levels are:

```ts
export const SALARY_CAP = 154.647;
export const MINIMUM_TEAM_SALARY = 139.182;
export const LUXURY_TAX_LINE = 187.895;
export const FIRST_APRON = 195.945;
export const SECOND_APRON = 207.824;
export const ROOKIE_MINIMUM_SALARY = 1.273;
```

All amounts are millions of dollars. Comment that the first five figures come from the NBA’s June 30, 2025 announcement. `ROOKIE_MINIMUM_SALARY` is the rounded zero-years-of-service minimum used by this game model.

### 2. Incomplete-roster charge

Use:

```ts
export const INCOMPLETE_ROSTER_THRESHOLD = 12;
```

The real CBA’s incomplete-roster calculation uses 12 players included in Team Salary, not the 14-player regular-season roster minimum. In this phase, apply the charge whenever cap-room salary is requested; date-window enforcement is deferred until league-year/offseason lifecycle exists. Document that simplification explicitly.

Each missing standard-roster slot below 12 adds one `ROOKIE_MINIMUM_SALARY` charge.

### 3. Two-way contracts

`Contract.type === 'two_way'` is excluded from:

- standard-contract payroll;
- standard-roster count for incomplete-roster charges;
- tax and apron payroll.

Two-way slot limits and more detailed two-way accounting remain deferred. Do not add new roster structures.

### 4. Temporary Phase 3 cap-rights proxy

Phase 2 has no persisted rights owner. Use this deliberately limited, derived proxy:

- An initial seeded free agent with no transaction history is treated as **renounced/unowned** and creates no cap hold.
- For a player currently in `season.freeAgentPool`, inspect transaction entries involving that player in append order.
- Only the player’s **latest relevant sign/cut entry** controls the result.
- The player creates a hold only when that latest entry is a `CutEntry` with `contractAtCut` present.
- The rights-owning team for this temporary proxy is that latest cut’s `fromTeamId`.
- Calculate the amount from `currentSalary(cut.contractAtCut)`, never from the player’s current contract.
- Count each current free agent at most once.
- A pre-Phase-2 cut with no `contractAtCut` creates no hold.

This prevents stale ownership and double counting in sequences such as:

```text
Team A cuts player → Team B signs player → Team B cuts player
```

Only Team B may receive the current proxy hold.

This proxy is a game abstraction, not full Bird-rights modeling and not waived-player dead money. Phase 4 replaces it with explicit Bird/Early-Bird/Non-Bird rights. Phase 5a adds dead money. Do not implement either early.

Use the flat placeholder:

```ts
export const CAP_HOLD_PERCENTAGE = 1.5;
```

```ts
hold = Math.max(
  currentSalary(cut.contractAtCut) * CAP_HOLD_PERCENTAGE,
  ROOKIE_MINIMUM_SALARY,
);
```

Do not describe 300%/250%/120% as the generic Full/Early/Non-Bird cap-hold tiers. The real calculation depends on prior salary, contract history, and rookie-scale status; that complexity is deferred.

### 5. Separate accounting bases

Do not use one “effective payroll” number for cap room, tax, and apron classification.

- **Raw payroll:** current salary of standard contracts on the roster.
- **Cap-room salary:** raw payroll + temporary FA cap holds + incomplete-roster charges.
- **Tax payroll:** raw payroll in this phase.
- **Apron payroll:** raw payroll in this phase.

The latter two are intentionally simplified until incentives, dead money, exceptions, and other CBA adjustments exist. Importantly, temporary FA holds and incomplete-roster charges must not move a team across the tax or apron thresholds.

The salary-floor diagnostic uses raw payroll. Cap holds and empty-roster charges do not satisfy actual salary spending.

### 6. Corrupt-world behavior

Financial functions must fail loudly for an unknown team or for a roster player ID missing from `world.players`. Do not silently skip a missing player and understate payroll.

Use a small internal helper that throws an informative `Error`. Keep the public numeric signatures specified below.

---

## Implementation

### 1. Constants — `src/transactions/constants.ts`

Add the constants listed above under a clear `Phase 3 — salary-cap rules` header. Keep them separate from Phase 2’s approximate contract-generation constants.

Do not silently replace `CONTRACT_REFERENCE_CAP`; changing Phase 2 contract generation is out of scope.

### 2. New pure module — `src/transactions/cap.ts`

Add a module-level comment stating:

- Phase 3 is compute-only.
- No values in this module are persisted.
- No schema bump is required.
- Cap-room salary and tax/apron payroll are intentionally separate accounting bases.
- The cut-log rights owner is a temporary Phase 3 proxy.

All exported functions are pure: no mutation, persistence, RNG, clock access, or side effects.

Implement:

```ts
export function computeTeamPayroll(
  world: RosterWorld,
  teamId: string,
): number;
```

Sum `currentSalary(player.contract)` for standard-contract players on the team’s roster. Exclude `two_way`. Throw for unknown teams and missing roster players.

```ts
export function computeCapHolds(
  world: RosterWorld,
  teamId: string,
): number;
```

Implement the latest-event proxy exactly as described above. This function must be order-stable, deduplicated by current FA player ID, and based on `contractAtCut`.

```ts
export function computeIncompleteRosterCharge(
  world: RosterWorld,
  teamId: string,
): number;
```

Count standard-contract roster players, excluding two-way players. Charge each missing slot below 12. Throw for unknown teams or missing roster players.

```ts
export function computeCapRoomSalary(
  world: RosterWorld,
  teamId: string,
): number;

export function computeCapRoom(
  world: RosterWorld,
  teamId: string,
): number;

export function computeTaxPayroll(
  world: RosterWorld,
  teamId: string,
): number;

export function computeApronPayroll(
  world: RosterWorld,
  teamId: string,
): number;
```

Definitions:

```ts
capRoomSalary = payroll + capHolds + incompleteRosterCharge;
capRoom = SALARY_CAP - capRoomSalary;
taxPayroll = payroll;
apronPayroll = payroll;
```

Add a pure classifier so threshold logic can be tested independently of roster construction:

```ts
export type CapStatus =
  | 'under_cap'
  | 'over_cap'
  | 'over_tax'
  | 'over_first_apron'
  | 'over_second_apron';

export interface CapStatusInputs {
  capRoomSalary: number;
  taxPayroll: number;
  apronPayroll: number;
}

export function classifyCapStatus(inputs: CapStatusInputs): CapStatus;
```

Classification order:

1. `apronPayroll >= SECOND_APRON` → `over_second_apron`
2. `apronPayroll >= FIRST_APRON` → `over_first_apron`
3. `taxPayroll >= LUXURY_TAX_LINE` → `over_tax`
4. `capRoomSalary >= SALARY_CAP` → `over_cap`
5. otherwise → `under_cap`

Then implement:

```ts
export function getTeamCapStatus(
  world: RosterWorld,
  teamId: string,
): CapStatus;
```

Add summary accessors:

```ts
export interface TeamFinancialSummary {
  teamId: string;
  rulesYear: typeof CAP_RULES_YEAR;
  payroll: number;
  capHolds: number;
  incompleteRosterCharge: number;
  capRoomSalary: number;
  capRoom: number;
  taxPayroll: number;
  apronPayroll: number;
  capStatus: CapStatus;
  belowSalaryFloor: boolean;
}

export function getTeamFinancialSummary(
  world: RosterWorld,
  teamId: string,
): TeamFinancialSummary;

export function getLeagueFinancialSummary(
  world: RosterWorld,
): TeamFinancialSummary[];
```

Compute each primitive once inside `getTeamFinancialSummary`; do not call the world-scanning accessors redundantly after their values are already known.

`belowSalaryFloor` is:

```ts
payroll < MINIMUM_TEAM_SALARY
```

### 3. Barrel export

Add to `src/transactions/index.ts`:

```ts
export * from './cap';
```

### 4. Persistence

Do not add fields to `SeasonState`, `Team`, `Player`, or `SaveFile`.

Do not change `SAVE_SCHEMA_VERSION`. It must remain 3.

Do not add a migration.

---

## Standalone verification script — `scripts/test-cap-status.ts`

Follow the existing `check()` / `failures` style. The script must run with:

```sh
node_modules/.bin/tsx scripts/test-cap-status.ts
```

### Real-data setup

1. Load `data/teams.json` and `data/players.json`.
2. Run `normalizePlayersForSave(rawPlayers, [])` before constructing the world.
3. Call `createSeasonState(teams, normalizedPlayers, { seed: 1 })`.
4. Copy the normalized free-agent pool into the season state.
5. Build a valid `RosterWorld` from normalized players, teams, and season.

Do not cast legacy JSON to `Player[]` and then read `salarySchedule` without normalization.

### Required checks

#### A. Real-world arithmetic

- Manually sum one team’s standard-contract `currentSalary()` values and compare with `computeTeamPayroll`.
- Verify two-way salaries are excluded.
- Verify `capRoomSalary === payroll + capHolds + incompleteRosterCharge`.
- Verify `capRoom === SALARY_CAP - capRoomSalary`.
- Verify `taxPayroll === payroll` and `apronPayroll === payroll` in Phase 3.
- Verify all returned numbers are finite.
- Verify league summary order matches `world.teams` order.

Print a table containing team, payroll, cap-room salary, cap room, tax payroll, apron payroll, and status. Also print min/median/max payroll and the count of teams in each status.

The current generated contract economy may place every team over the cap. Treat that as a visible non-failing diagnostic, not permission to retune Phase 2 contracts in this phase.

#### B. Pure threshold classification

Test `classifyCapStatus` directly. For every threshold, test both exact equality and a small amount below it.

At minimum verify:

- cap-room salary just below cap → `under_cap`
- cap-room salary exactly at cap → `over_cap`
- tax payroll just below tax → not `over_tax`
- tax payroll exactly at tax → `over_tax`
- apron payroll just below first apron → not `over_first_apron`
- apron payroll exactly at first apron → `over_first_apron`
- apron payroll just below second apron → not `over_second_apron`
- apron payroll exactly at second apron → `over_second_apron`
- large cap holds can create `over_cap` but cannot alone create `over_tax` or an apron status

#### C. Incomplete-roster charges

Use synthetic standard-contract players:

- 10 standard players → `2 * ROOKIE_MINIMUM_SALARY`
- 11 standard players → `1 * ROOKIE_MINIMUM_SALARY`
- 12 standard players → `0`
- 14 standard players → `0`
- 11 standard + 1 two-way → still one missing standard slot

#### D. Cap-hold history

Use legal gate operations where possible and test:

1. Team A cuts a player from a 15-player roster:
   - player enters FA pool;
   - Team A receives exactly one hold;
   - hold uses `entry.contractAtCut`.
2. Team B signs that player:
   - player leaves FA pool;
   - Team A’s hold becomes zero.
3. Team B later cuts that player:
   - only Team B receives the hold;
   - Team A does not regain a stale hold.
4. Repeated sign/cut history never double-counts one current FA.
5. A seeded FA with no transaction history creates no hold.
6. A synthetic pre-Phase-2 cut without `contractAtCut` creates no hold.

#### E. Defensive invariant failures

- Unknown team ID throws an informative error.
- A roster containing a missing player ID throws instead of understating payroll.

#### F. Purity and determinism

- Snapshot the input world before calculations and verify it is byte-identical afterward.
- Run the test script twice and verify identical output.

---

## Explicit scope boundaries

### In scope

- Phase 3 constants in `src/transactions/constants.ts`
- Pure derived calculations in `src/transactions/cap.ts`
- Barrel export from `src/transactions/index.ts`
- `scripts/test-cap-status.ts`
- Before/after profile and calibration comparison

### Out of scope

- No gate or validator changes
- No cap enforcement
- No salary matching
- No hard-cap state
- No Bird/Early-Bird/Non-Bird rights model
- No renouncement transaction
- No dead money or waiver claims
- No exceptions or tax-bill computation
- No contract-generation retuning
- No two-way slot limits or new roster structures
- No season/calendar changes or cap growth table
- No UI or API work
- No schema bump or migration
- No changes under `src/engine`
- No Next.js code

---

## Final verification and report

Run:

```sh
npm run typecheck
node_modules/.bin/tsx scripts/test-cap-status.ts
npm run profile
npm run calibrate
```

Then report:

1. Files changed and the purpose of each.
2. The cap-rights proxy and its explicit limitations.
3. Confirmation that cap-room, tax, and apron bases are separate.
4. Real-data min/median/max payroll and status distribution.
5. Test results.
6. Before/after `npm run profile` deltas.
7. Before/after `npm run calibrate` deltas.
8. Confirmation that `SAVE_SCHEMA_VERSION` remained 3.
9. Confirmation that no gate, mutation path, schema, UI, Next.js, or simulation file changed.

The work is not complete if profile or calibration changed, if the test output is nondeterministic, if a stale cut can create a cap hold, or if temporary FA holds can move a team across the tax/apron thresholds.
