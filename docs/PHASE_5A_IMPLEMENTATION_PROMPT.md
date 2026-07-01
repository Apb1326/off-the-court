# Phase 5a — Dead Money, Exceptions, TPEs, and Contract Lifecycle

You are implementing Phase 5a of the Off the Court transactions roadmap on the current repository state.

Read `AGENTS.md` first and treat every rule there as a hard constraint. Then read `docs/TRANSACTIONS_ROADMAP.md`. This is transaction/GM-layer work: do not change game simulation behavior, do not read scouted ratings on a simulation path, do not add nondeterministic randomness, and do not move legality into `evaluateTradeForCpu`.

The goal is to add deterministic financial consequences while preserving the validate-then-mutate gate:

- waived-contract dead money and the stretch election;
- banked Standard Traded Player Exceptions and later TPE use;
- Non-Taxpayer MLE, Taxpayer MLE, Room MLE, and BAE signings;
- a tested transaction-layer contract-rollover seam;
- correct dead-money integration into the existing, separate cap/tax/apron accounting bases.

Phase 5a must not implement sign-and-trade, trade AI, waiver claims, UI, or future draft mechanics.

---

## 0. Mandatory preflight — verify before editing

Read these files completely:

```text
AGENTS.md
docs/TRANSACTIONS_ROADMAP.md
src/models/player.ts
src/models/team.ts
src/models/season.ts
src/models/transaction.ts
src/models/save.ts
src/transactions/constants.ts
src/transactions/contracts.ts
src/transactions/cap.ts
src/transactions/financial.ts
src/transactions/validators.ts
src/transactions/gate.ts
src/transactions/world.ts
src/transactions/index.ts
src/data/saves/migrations.ts
src/engine/season.ts
src/app/api/season/route.ts
scripts/test-transactions.ts
scripts/test-contract-migration.ts
scripts/test-cap-status.ts
scripts/test-phase4.ts
scripts/test-save-migration.ts
scripts/calibrate-history.ts
```

Before making changes, report whether the live branch still has all of these facts:

1. `SAVE_SCHEMA_VERSION === 4`.
2. `Contract` uses `salarySchedule: number[]`, with index `0` as the current season; years remaining are derived from its length.
3. `Contract.option` is `{ type: 'player' | 'team'; year: number }`, where `year` is an index into `salarySchedule`.
4. `CutEntry` already has the immutable snapshot `contractAtCut?: Contract`.
5. Hard-cap state is `Team.hardCappedAtApron?: 'first_apron' | 'second_apron'`.
6. Cap-room salary, tax payroll, and apron payroll are intentionally separate accounting bases in `cap.ts`.
7. Phase 4 signing already supports room, Bird/Early Bird/Non-Bird, and the minimum exception through `analyzeSigning`.
8. Phase 4 trade matching already distinguishes `room`, `standard`, `aggregated_standard`, and `expanded` modes.
9. Minimum-team-salary warnings and the broader-Team-Salary hard-cap design comments already exist.
10. There is no real franchise rollover route yet: offseason start is unimplemented and starting a new season snapshots the global templates rather than rolling the current save forward.
11. There is no persisted controlled-franchise team identity available to a rollover function.

If any fact differs, stop and report the exact discrepancy with file and line references. Do not adapt silently.

Also inspect `git status`. Preserve unrelated user changes and do not overwrite them.

### Approved lifecycle boundary for this phase

Because the live app has no franchise rollover route, this phase must build and test a pure transaction-layer rollover seam, but must **not** wire it into `src/app` or change season-advancement behavior in `src/engine`.

The only permitted `src/engine` edit is the mechanical initialization of new required `SeasonState` collections in `createSeasonState`. No other `src/engine/**` file or behavior may change.

Do not claim app-level rollover integration is complete. The final report must say that the pure lifecycle seam is ready for a future offseason/franchise-flow phase.

---

## 1. Hard architectural rules

### Preserve existing sources of truth

- Reuse `CutEntry.contractAtCut`. Do **not** introduce `waivedContract`, `guaranteedRemaining`, or a second contract snapshot.
- Dead money is derived from `contractAtCut`, the immutable cut entry, its stretch election, and the as-of league year.
- A TPE grant is persisted because its creation is event-set state. Its remaining balance is derived from the immutable grant minus append-only usage records.
- Signing-exception usage is derived from immutable `SignEntry` records. Do not persist a mutable aggregate `amountUsed` collection.
- The transaction log remains append-only. Never rewrite or backfill an old entry.
- Every failed transaction must leave the input world byte-identical.

### Preserve accounting bases

Do not collapse the existing financial helpers into one generic salary number.

- Cap-room salary becomes: active standard-contract payroll + cap holds + incomplete-roster charges + dead money.
- Tax payroll becomes: active standard-contract payroll + dead money.
- Apron payroll becomes: active standard-contract payroll + dead money.
- Cap holds and incomplete-roster charges do not suddenly become tax/apron payroll.
- Preserve Phase 4's documented decision to use the broader projected Team Salary for hard-cap enforcement. Add dead money to that basis; do not redesign the accounting decision in this phase.

### Determinism

- Prefer pure arithmetic and stable ordering.
- Option decisions in this phase require no RNG. Equality rules must be explicit.
- If unforeseen tie-breaking randomness is truly necessary, use `SeededRNG(fnv1a(stableStringKey))` on a dedicated stream. Never use `Math.random()`.
- Parse and compare canonical `YYYY-MM-DD` strings deterministically. Avoid local-time `Date` behavior.

---

## 2. Explicit game simplifications

These are deliberate. Do not make the phase larger in pursuit of full CBA fidelity.

1. All salary in `contractAtCut.salarySchedule`, including a modeled option year, is treated as guaranteed for dead-money purposes.
2. No buyout negotiation, set-off reduction, September 1 distinction, or 15%-of-cap stretch ceiling.
3. A stretch election applies immediately and spreads the entire remaining schedule evenly over `2 * remainingSeasons + 1` league years, beginning in the cut league year.
4. Only banked **Standard** TPEs are persisted. Existing Phase 4 `aggregated_standard` and `expanded` modes remain same-transaction matching mechanisms and do not create banked balances.
5. A banked TPE may absorb one incoming standard-contract player per trade. It cannot be combined with outgoing salary or another TPE for that player. A partially used TPE may be used again in a later trade until exhausted or expired.
6. When several outgoing players could support Phase 4's `standard` matching mode, the existing deterministic largest-outgoing-player choice is the sole source of a banked TPE. Do not bank additional outgoing-player exceptions in that trade.
7. Exception contracts remain flat salary schedules because the current `DesiredContract`/`instantiateContract` model is flat. Do not add unused raise constants or redesign contract negotiation in this phase.
8. Selecting the Non-Taxpayer MLE always triggers a first-apron hard cap; selecting the Taxpayer MLE always triggers a second-apron hard cap. Do not implement automatic NTMLE-to-TMLE reclassification in this phase.
9. Option choices are deterministic for every team because no controlled-franchise identity or UI exists yet.
10. Disabled Player Exception remains deferred. Update the Phase 5a roadmap bullet to state this approved game-scope exception so the roadmap and implementation do not contradict one another.

---

## 3. League-year and date helpers

Add a small pure date module under `src/transactions/` or extend an appropriate existing transaction helper.

Define the salary-cap year by its July 1 start:

```text
January–June date -> prior calendar year is the cap-year start
July–December date -> current calendar year is the cap-year start
```

Required helpers:

- validate a canonical `YYYY-MM-DD` date;
- `capYearForDate(date): number`;
- deterministic `addOneCalendarYear(date): string`, with an explicit February 29 rule;
- `capYearOffset(earlierDate, laterDate): number`.

For TPEs, define:

- `expiresDate = addOneCalendarYear(createdDate)`;
- the TPE is active only when `asOfDate < expiresDate`.

Use these helpers for dead-money schedules, current/prior-year exception usage, BAE eligibility, and prior-year TPE hard-cap triggers. Do not infer chronology from arbitrary `seasonId` text.

---

## 4. Dead money and stretch provision

### Data model

Extend `CutEntry` only with:

```ts
/** Phase 5a stretch election. Absence on earlier entries means false. */
stretchApplied?: boolean;
```

Do not add another contract snapshot. Existing entries with `contractAtCut` are financially consequential even if they predate schema v5. Existing entries without `contractAtCut` legitimately produce zero dead money.

### Cut operation

Extend `CutOp` with `stretch?: boolean`, defaulting to `false`.

On a successful cut:

- preserve the existing `contractAtCut` snapshot;
- write `stretchApplied: true` only when elected; canonical absence is false;
- keep existing FA-pool, desired-contract, and rights behavior;
- do not mutate any prior entry;
- reject or ignore stretch for a two-way contract consistently with the fact that two-way salary is excluded from the standard financial model. Prefer an explicit validator and reason.

### Pure computation

Add `src/transactions/deadMoney.ts` with a pure API such as:

```ts
computeDeadMoney(world: RosterWorld, teamId: string, asOfDate?: string): number
```

Default `asOfDate` to `world.season.currentDate`.

For each qualifying cut by the team:

- Ignore entries without `contractAtCut`.
- Ignore two-way contracts.
- Compute the cap-year offset from the cut date to `asOfDate`.
- If the offset is negative, contribute zero.
- Unstretched: contribute `contractAtCut.salarySchedule[offset] ?? 0`.
- Stretched:
  - `n = contractAtCut.salarySchedule.length`;
  - `total = sum(contractAtCut.salarySchedule)`;
  - `stretchYears = 2 * n + 1`;
  - contribute `total / stretchYears` while `offset < stretchYears`, otherwise zero.

Sort qualifying entries by stable keys before floating-point reduction so log ordering cannot change the result.

Integrate this result into cap-room, tax, apron, and all corresponding projected helpers without collapsing their distinct bases.

Update the existing salary-floor warning basis to payroll plus dead money. Do not add a duplicate floor validator and do not turn the warning into a transaction blocker.

---

## 5. Banked Standard Traded Player Exceptions

### Persisted grant; derived balance

Add a persisted grant type:

```ts
export interface TradeException {
  id: string;
  teamId: string;
  sourceTradeSeq: number;
  sourcePlayerId: string;
  /** Original banked amount in millions. Never mutate this field. */
  amount: number;
  createdDate: string;
  expiresDate: string;
  createdSeason: string;
}
```

Add `tradeExceptions: TradeException[]` to `SeasonState`. Document it as an append-only event-set grant ledger. Do not delete expired grants and do not add `usedAmount` or `remainingAmount` fields.

Extend `TradeEntry` additively:

```ts
export interface TradeExceptionUsage {
  tpeId: string;
  teamId: string;
  incomingPlayerId: string;
  amount: number;
}

// Optional fields on TradeEntry:
createdTradeExceptionIds?: string[];
tpeUsages?: TradeExceptionUsage[];
capRoomTeams?: string[];
```

`capRoomTeams` records teams whose successful Phase 4 matching plan used `room`; it supports the historical “operated under the cap this league year” fact. Canonical absence means none.

Add pure helpers:

- `computeTradeExceptionUsed(world, tpeId)` from append-only `TradeEntry.tpeUsages`;
- `computeTradeExceptionRemaining(world, tpeId)`;
- `getActiveTradeExceptions(world, teamId, asOfDate?)`;
- fail loudly on duplicate grant IDs, unknown usage IDs, wrong-team usage, negative amounts, or total usage exceeding the grant.

### Trade input and validation

Extend `TradeOptions` with:

```ts
tpeUsages?: Array<{
  teamId: string;
  tpeId: string;
  incomingPlayerId: string;
}>;
```

The amount is computed from the incoming player's current matching salary; callers do not supply money.

Add independent validators proving that:

- the team is one of the proposal's sides;
- the TPE exists, belongs to that team, is unexpired, and has sufficient derived remaining amount;
- the allocated player is a standard-contract player actually incoming to that team;
- a player is allocated at most once;
- one TPE absorbs at most one player in this trade;
- a TPE is not combined with normal outgoing salary or another TPE for that same player;
- a TPE created by the current trade cannot be consumed in that same trade;
- any prior-cap-year Standard TPE usage triggers a first-apron hard cap, regardless of tax status;
- projected salary satisfies the existing or newly triggered hard cap.

Remove TPE-allocated incoming players from that team's ordinary salary-matching calculation. All remaining incoming players and all ordinary Phase 4 matching rules still pass through the existing shared legality stack.

Do not put any TPE legality inside `evaluateTradeForCpu`.

### Creating a banked TPE

Extend a successful Phase 4 `standard` plan to identify its deterministic `sourcePlayerId`. Preserve the current choice: highest outgoing matching salary, stable player-id tie-break.

After all validation passes and as part of the same immutable commit:

- only a `standard` plan with a source player may bank a TPE;
- calculate `banked = plan.maximumIncomingSalary - ordinaryIncomingSalary` after excluding incoming players assigned to pre-existing TPEs;
- do not bank if `banked <= MONEY_EPSILON`;
- do not bank from `room`, `aggregated_standard`, or `expanded` plans;
- create at most one banked TPE per team per trade;
- use a deterministic ID such as `tpe_${tradeSeq}_${teamId}_${sourcePlayerId}`;
- append the immutable grant to `season.tradeExceptions`;
- record its ID on the new `TradeEntry`;
- record all consumed TPEs on the same entry.

Reuse the existing Phase 4 allowance calculation: the $0.250M allowance is already reduced to zero when the projected Team Salary is above the first apron. Do not add a second allowance constant; reuse `TRADE_ALLOWANCE`.

All grant creation and usage must be atomic with the trade. A rejected trade changes neither balances nor the log.

---

## 6. MLE, Room MLE, and BAE signings

### Constants: align with the repo's 2025–26 cap year

The live repo uses `CAP_RULES_YEAR = '2025-26'`. Do not introduce 2024–25 cap/floor values.

Add only missing 2025–26 exception constants to `src/transactions/constants.ts`:

```ts
export const NON_TAXPAYER_MLE = 14.104;
export const NON_TAXPAYER_MLE_MAX_YEARS = 4;

export const TAXPAYER_MLE = 5.685;
export const TAXPAYER_MLE_MAX_YEARS = 2;

export const ROOM_MLE = 8.781;
export const ROOM_MLE_MAX_YEARS = 3;

// 2024-25 $4.668M increased by the 2025-26 10% cap growth, rounded to $0.001M.
export const BI_ANNUAL_EXCEPTION = 5.135;
export const BAE_MAX_YEARS = 2;

export const TPE_DURATION_YEARS = 1;
```

Use the official NBA 2025–26 announcement for the three MLE amounts and the official NBA CBA 101 rule that future BAE amounts grow at the same rate as the cap. Cite both in comments:

- `https://www.nba.com/news/nba-salary-cap-set-2025-26-season`
- `https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf`

Do not redefine `MINIMUM_TEAM_SALARY`, `ROOKIE_MINIMUM_SALARY`, or `TRADE_ALLOWANCE`. Do not add a single veteran-minimum constant; the current game deliberately uses its existing simplified minimum model.

### Signing mechanism and immutable usage

Extend the signing mechanism union with:

```ts
'non_taxpayer_mle' | 'taxpayer_mle' | 'room_mle' | 'bae'
```

Extend `SignOp` with an optional explicit exception selection:

```ts
exception?: 'non_taxpayer_mle' | 'taxpayer_mle' | 'room_mle' | 'bae';
```

Extend `SignEntry` with the selected `signingMechanism`. Record the mechanism for **all** new signings, including room, Bird/Early Bird/Non-Bird, minimum exception, and the new exceptions. Pre-v5 entries may omit it.

Derive current usage by scanning `SignEntry` records for the team and cap year and summing `contractSigned.salarySchedule[0]` by mechanism. Do not add `SeasonState.exceptionUsages`.

### “Operated under the cap” event-state

Add:

```ts
export interface TeamExceptionState {
  teamId: string;
  capYear: number;
  /** Event-set fact: once true, it remains true for that cap year. */
  operatedUnderCap: true;
}
```

Add `teamExceptionStates: TeamExceptionState[]` to `SeasonState`. This is the one small persisted historical fact required because “was below the cap at any point” cannot be recovered from current payroll.

Set it atomically, without duplicate `(teamId, capYear)` entries, whenever a successful transaction:

- uses a `room` signing or room trade plan; or
- leaves the team with positive cap room.

Migration does not guess about pre-v5 historical room usage. It initializes this collection empty; document that legacy limitation.

### Availability matrix

Add a pure `getAvailableSigningExceptions(teamId, world, asOfDate?)` returning `{ type, remainingAmount, maxYears }[]` in stable order.

Rules:

1. If the team currently has positive cap room, do not offer an MLE/BAE; it must use room first.
2. If the team operated under the cap at any point in the current cap year, it may use only the Room MLE among these exceptions.
3. If it has not operated under the cap:
   - it may choose one of NTMLE or TMLE for the cap year, never both;
   - BAE may coexist with NTMLE;
   - BAE may not coexist with TMLE or Room MLE;
   - BAE is unavailable if the team used BAE in the immediately prior cap year;
   - Room MLE excludes NTMLE, TMLE, and BAE, and vice versa.
4. Return remaining first-year amount after prior same-year uses of the selected exception.
5. A team above the applicable hard-cap ceiling cannot complete the signing even if nominal exception room remains.

### Signing validation and hard-cap triggers

When an explicit exception is selected:

- do not silently fall back to another mechanism;
- validate availability, remaining amount, desired first-year salary, and maximum term;
- continue to apply the existing general maximum-salary rule;
- NTMLE usage triggers/preserves a first-apron hard cap;
- BAE usage triggers/preserves a first-apron hard cap;
- TMLE usage triggers/preserves a second-apron hard cap;
- Room MLE has no new hard-cap trigger in this simplified model;
- use `stricterHardCap`; never weaken an existing hard cap;
- validate the projected post-signing salary before mutation;
- instantiate the existing flat contract and record the selected mechanism.

When no exception is selected, preserve Phase 4's existing least-restrictive room → own-rights → minimum-exception analysis. Do not auto-select an MLE or BAE.

---

## 7. Contract expiry and option resolution seam

Add `src/transactions/rollover.ts` with a pure, immutable function such as:

```ts
processContractRollover(
  world: RosterWorld,
  nextSeasonBase: SeasonState,
): RosterWorld
```

`nextSeasonBase` is a freshly constructed next-season calendar/stat shell supplied by a future caller. Require it to have a distinct `seasonId` and empty transaction collections before processing.

The function must:

1. Leave its input objects byte-identical.
2. Preserve the old append-only transaction log and append rollover entries to it.
3. Preserve the TPE grant ledger; expiry remains derived from dates.
4. Carry the current FA pool forward and add new expirings without duplicates.
5. Preserve prior-year `teamExceptionStates` for audit/history, but start with no entry for any team in the new cap year.
6. Remove `hardCappedAtApron` from every team for the new league year.
7. Shift active contract salary schedules by one season.
8. Shift future option indexes along with the salary schedule.
9. Resolve an option that covers the upcoming season before allowing that salary year to continue.
10. Move natural expirings and declined options to the canonical FA pool.
11. Require `nextSeasonBase.playerStats` to be a fresh zeroed collection, then update each row's `teamId` from the post-rollover player ownership so released players do not retain stale team attribution.

### Exact option algorithm

For each rostered player, process their pre-rollover contract in stable player-id order:

- `remainingSchedule = salarySchedule.slice(1)`.
- No option:
  - if `remainingSchedule` is empty, expire the contract;
  - otherwise continue with `remainingSchedule`.
- `option.year > 1`:
  - continue with `remainingSchedule`;
  - decrement the option index by one.
- `option.year === 1`:
  - the option covers the upcoming season; resolve it now using `remainingSchedule[0]` as option salary;
  - player option exercises when `optionSalary >= generateDesiredContract(player).desiredSalary`;
  - team option exercises when `optionSalary <= generateDesiredContract(player).desiredSalary`;
  - equality therefore exercises either option;
  - exercised: continue with `remainingSchedule` and remove the option field;
  - declined: release the player to free agency.
- `option.year === 0`:
  - treat the current-season option as already consumed, remove it, then use normal expiration/continuation based on `remainingSchedule`;
- any other invalid option index or invalid resulting contract is a hard error before mutation.

Do not add RNG to this placeholder decision model.

### Releasing an expiring player

For a natural expiration or declined option:

- remove the player from the team roster;
- set `teamId = FREE_AGENT_TEAM_ID`;
- add the player once to `freeAgentPool`;
- preserve the just-finished contract as the player's previous contract, matching the current FA convention;
- set `desiredContract = generateDesiredContract(player)`;
- assign re-signing rights to the former team using the existing deterministic rights proxy;
- do not attempt waiver claims or roster replenishment.

The resulting world is an offseason state and may have temporarily incomplete rosters. It must not be handed to game simulation until a future offseason flow replenishes rosters.

### Rollover log entries

Add these immutable entry types:

```ts
OptionExercisedEntry
OptionDeclinedEntry
ContractExpiredEntry
```

Each carries player/team identity and option type where applicable. Stamp entries with the old season's closing date/season and append them in stable player-id order. An option decline should log `option_declined`; do not also emit a redundant `contract_expired` entry for the same event.

Do not wire this function into `src/app` in this phase. Do not change `advanceSeason`.

---

## 8. Save schema v5 migration

Bump `SAVE_SCHEMA_VERSION` from 4 to 5 and update its version-history comment.

Add an explicit `migrateV4toV5` step that initializes:

```ts
season.tradeExceptions = []
season.teamExceptionStates = []
```

Rules:

- Preserve every existing transaction-log entry byte-for-byte.
- Do not backfill `stretchApplied`, `signingMechanism`, TPE records, or option events.
- Existing `CutEntry.contractAtCut` records remain available to dead-money derivation.
- Existing cuts without a contract snapshot produce zero.
- Migration must be deterministic and idempotent.
- Loading a current v5 save twice must be a no-op.
- Fresh seasons must initialize the two new arrays. The single mechanical initialization in `src/engine/season.ts` is authorized; no other engine edit is.

---

## 9. File organization

Prefer this layout unless the live code makes a nearby home clearly better:

```text
src/transactions/date.ts          # cap-year/date helpers
src/transactions/deadMoney.ts     # dead-money derivation
src/transactions/tpe.ts           # TPE grant/balance/availability helpers
src/transactions/exceptions.ts    # MLE/BAE availability and derived use
src/transactions/rollover.ts      # pure lifecycle seam
```

Extend existing files narrowly:

```text
src/models/transaction.ts
src/models/season.ts
src/models/save.ts
src/transactions/constants.ts
src/transactions/cap.ts
src/transactions/financial.ts
src/transactions/validators.ts
src/transactions/gate.ts
src/transactions/index.ts
src/data/saves/migrations.ts
src/engine/season.ts              # only new SeasonState array initialization
docs/TRANSACTIONS_ROADMAP.md      # document DPE deferral and the pure rollover seam
```

Do not touch `src/app/**`, simulation resolution, player ratings, game events, or engine tuning constants.

---

## 10. Required executable acceptance harness

Create `scripts/test-phase5a.ts`. Do **not** substitute manual smoke-test prose for executable assertions.

The focused harness must cover at least:

### Dead money

- zero with no qualifying cuts;
- an existing pre-v5 `contractAtCut` entry creates unstretched dead money;
- an entry without `contractAtCut` creates zero;
- non-flat salary schedules hit the correct year-specific amount unstretched;
- stretch uses total schedule / `(2n + 1)` for exactly the correct number of cap years;
- multiple cuts sum deterministically;
- two-way cuts create no dead money;
- rejected cuts leave the world byte-identical;
- cap-room, tax, apron, projections, and floor warning use the correct bases.

### TPEs

- a qualifying standard trade banks the expected residual amount;
- the allowance is $0.250M below the first apron and zero above it;
- deterministic source-player selection and ID on a multi-outgoing standard plan;
- room/aggregated/expanded plans do not bank a TPE;
- active, expired, partially used, and exhausted balances;
- one incoming player can be absorbed and ordinary matching handles the remainder;
- no combining two TPEs or TPE + outgoing salary for one player;
- wrong team, unknown ID, expired grant, insufficient balance, duplicate allocation, and non-incoming player all reject atomically;
- prior-cap-year usage triggers first-apron hard cap regardless of tax status;
- same-cap-year use does not create that particular trigger;
- failed use leaves grant ledger and transaction log byte-identical.

### Signing exceptions

- usage is isolated per team and derived from sign entries;
- split use across multiple signings reduces remaining amount correctly;
- cap room is used before Room MLE;
- operated-under-cap state survives later payroll changes within the cap year;
- Room MLE excludes NTMLE/TMLE/BAE;
- NTMLE and BAE may coexist;
- TMLE excludes NTMLE and BAE;
- BAE is unavailable in consecutive cap years;
- terms and first-year amounts are enforced at exact boundaries;
- NTMLE/BAE first-apron and TMLE second-apron triggers are enforced;
- failed signings do not consume usage or set hard-cap state;
- no explicit exception preserves Phase 4 room/rights/minimum behavior.

### Rollover

- input world remains byte-identical;
- schedule shifts exactly once;
- future option index decrements;
- due player/team options exercise and decline with the documented equality rules;
- no option is resolved a season early;
- natural expiration produces a signable FA with desired contract and rights;
- declined option produces one log event, not two;
- log order is stable by player ID;
- old log and TPE grants survive;
- hard caps reset;
- expired TPEs are ignored by active queries without deleting grant history;
- a second accidental rollover of the same boundary is rejected rather than decrementing twice.

### Migration

- v4 loads to v5 with empty grant/state arrays;
- old cut entries remain byte-identical;
- old `contractAtCut` entries participate in dead-money computation after migration;
- migration run twice is byte-identical;
- fresh v5 save round-trips.

---

## 11. Full verification

Fix the Node path first if necessary:

```sh
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
```

Capture `npm run profile` before editing and again after all changes. For this transaction-only phase, the output must be byte-identical.

Run:

```sh
npm run typecheck
node --import tsx scripts/test-transactions.ts
node --import tsx scripts/test-contract-migration.ts
node --import tsx scripts/test-cap-status.ts
node --import tsx scripts/test-phase4.ts
node --import tsx scripts/test-save-migration.ts
node --import tsx scripts/test-phase5a.ts
node --import tsx scripts/test-determinism.ts
npm run profile
npm run calibrate
git diff --check
```

`scripts/calibrate-history.ts` currently samples teams with `Math.random()`, so its printed engine sample is not byte-stable even on an unchanged tree. Do not misreport sampling noise as transaction-layer sim drift. Report the output and the known limitation; use byte-identical `npm run profile` plus determinism as the hard no-sim-drift signal. Do not “fix” calibration randomness inside this phase.

Finally verify the scope explicitly:

```sh
git diff --name-only -- src/engine src/app
```

The only allowed result under `src/engine` is `src/engine/season.ts`, containing only initialization of the new SeasonState collections. There must be no `src/app` changes.

---

## 12. Stop-and-surface conditions

Stop and report rather than guessing if:

1. Any mandatory preflight fact is false.
2. Implementing app-level rollover would require touching `src/app`, `advanceSeason`, or simulation behavior.
3. A proposed design requires rewriting or backfilling old transaction-log entries.
4. A proposed TPE or exception balance would be stored both as mutable aggregate state and as derivable event history.
5. TPE allocation cannot remain an independent composable legality path alongside Phase 4 matching.
6. The official current-year source contradicts a constant in this prompt.
7. The broader-Team-Salary Phase 4 hard-cap decision must change to make the implementation work.
8. Correct rollover would require inventing controlled-team identity, UI decisions, roster replenishment, or CPU transaction initiative.
9. Any transaction-only change alters `npm run profile`.
10. Existing user changes overlap the required files in a way that cannot be preserved safely.

---

## 13. Final report

Report:

1. Preflight facts and any approved deviations.
2. Files changed and the source-of-truth decision for each new state field.
3. Exact CBA sources and league year used.
4. Every verification command and pass/fail result.
5. Before/after `npm run profile` output or a byte-identical comparison.
6. `npm run calibrate` result with its known sampling-noise caveat.
7. Confirmation that failed transactions are atomic, legality remains outside CPU desirability, and no old log entry is rewritten.
8. Confirmation that the rollover function is a tested pure seam only and is not yet wired into franchise UI flow.
9. Confirmation that no later-phase mechanic was built.
