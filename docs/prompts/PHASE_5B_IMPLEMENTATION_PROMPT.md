# Phase 5b — Sign-and-Trade (2025–26 composition stress test)

Implement Phase 5b on the current repository state using the rules and system levels for
the 2025–26 NBA salary-cap year.

This is one transaction-layer mechanic: atomically sign an eligible free agent and
immediately trade that player to another team. It must compose the existing contract,
trade-matching, apron, hard-cap, TPE, exception-history, and append-only-log systems
without changing simulation behavior.

Read AGENTS.md first and treat it as binding. Then read
docs/TRANSACTIONS_ROADMAP.md. Do not rely on identifiers or schema numbers from this
prompt without checking the live source.

## Sources of truth

There is no separate 2025–26 collective bargaining agreement. The July 2023 NBA-NBPA
CBA governs the 2025–26 salary-cap year; the NBA's June 30, 2025 release supplies the
official 2025–26 system levels and exception amounts.

Use the live repository for architecture and these primary sources:

- Governing 2023–30 NBA-NBPA CBA:
  https://www.nbpa.com/cba
- Full CBA, especially Article VII Section 2(e), Section 6(j), and Section 8(e)(1):
  https://imgix.cosmicjs.com/25da5eb0-15eb-11ee-b5b3-fbd321202bdf-Final-2023-NBA-Collective-Bargaining-Agreement-6-28-23.pdf
- Official NBA 2025–26 salary-cap release:
  https://pr.nba.com/nba-salary-cap-2025-26-season/

The 2025–26 values are:

| Item | 2025–26 amount |
|---|---:|
| Salary cap | $154.647M |
| Minimum team salary | $139.182M |
| Luxury-tax line | $187.895M |
| First apron | $195.945M |
| Second apron | $207.824M |
| Non-taxpayer MLE | $14.104M |
| Taxpayer MLE | $5.685M |
| Room MLE | $8.781M |

Do not copy 2024–25 dollar values from an older CBA summary. Do not introduce a rule from
memory or a secondary explainer. If a required structural rule cannot be verified in the
governing CBA, or a required 2025–26 amount cannot be verified in the official 2025–26
release, stop and report it.

## Scope

In scope:

- One atomic applySignAndTrade gate operation.
- A self-describing sign_and_trade transaction-log entry.
- S&T-specific eligibility and apron predicates.
- Composition with existing salary matching and TPE allocation.
- Banked Standard TPE creation using the exact shipped Phase 5a behavior.
- Correct later hard-cap treatment when a TPE created by an S&T is used.
- A focused scripts/test-phase5b.ts harness.

Out of scope:

- Trade AI, CPU initiative, counteroffers, or desirability changes.
- Restricted free agency, offer sheets, draft mechanics, waiver claims, UI, or app wiring.
- Base-year compensation.
- Post-S&T waiting-period enforcement.
- Multi-team trades.
- Changes under src/engine or src/app.
- Any schema bump or migration unless preflight proves that the additive log variant is
  unreadable without one.

Legality remains in the shared transaction gate. Do not touch evaluateTradeForCpu.

## 0. Mandatory preflight and baseline

Read these files completely before editing:

~~~
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
src/transactions/assets.ts
src/transactions/tpe.ts
src/transactions/date.ts
src/transactions/deadMoney.ts
src/transactions/exceptions.ts
src/transactions/rollover.ts
src/transactions/index.ts
src/data/saves/migrations.ts
scripts/test-transactions.ts
scripts/test-phase4.ts
scripts/test-phase5a.ts
scripts/test-save-migration.ts
~~~

Inspect staged, unstaged, and untracked changes together. Preserve unrelated user work.

Before editing, report and verify the live equivalents of these facts:

1. SAVE_SCHEMA_VERSION is currently 6. The v5 step introduced the Phase 5a ledgers;
   an unrelated v5-to-v6 ratings migration is now current.
2. CAP_RULES_YEAR is 2025-26 and the live SALARY_CAP, MINIMUM_TEAM_SALARY,
   LUXURY_TAX_LINE, FIRST_APRON, SECOND_APRON, NON_TAXPAYER_MLE, TAXPAYER_MLE,
   and ROOM_MLE constants match the official amounts above. Do not change them in this
   phase.
3. EXPANDED_TPE_CUSHION_2025_26 is the repository's 2025–26 expanded-TPE cushion.
   Reuse it indirectly through existing matching; do not recalculate or replace it here.
4. TransactionEntry currently contains trade, sign, cut, option_exercised,
   option_declined, and contract_expired.
5. TradeProposal uses TradeAsset arrays and assets.ts owns playerAsset, buildTrade, and
   buildPlayerTrade.
6. applyTrade composes roster, temporal/consent, TPE, matching, mechanism-apron, and
   hard-cap checks before immutable mutation.
7. analyzeTradeMatching is the whole-proposal wrapper over
   analyzeTradeMatchingForTeam.
8. TradeMatchingPlan exposes projectedApronPayroll and projectedTeamSalary. The current
   hard-cap gate is deliberately passed projectedTeamSalary, the broader Team Salary
   basis that includes cap holds, incomplete-roster charges, and dead money.
9. applySignFreeAgent calls analyzeSigning, validates the chosen mechanism, instantiates
   the contract, replaces the cap hold, and records signingMechanism.
10. instantiateContract(desired: DesiredContract): Contract is pure and deterministic.
11. The retained prior-salary source for a free agent is currentSalary(player.contract);
   reuse it.
12. maximumSalaryForRights(rightsType, experience, priorSalary) exists.
13. Player.birdRights is free-agent-only state with bird, early_bird, or non_bird type.
14. Team.hardCappedAtApron is event-set state and stricterHardCap is monotonic.
15. TradeEntry uses createdTradeExceptionIds, tpeUsages, and capRoomTeams.
16. analyzeTpeUsages returns allocations plus first-apron triggers, and allUsage
    currently reads only trade entries.
17. computeSigningMechanismUsed can determine same-cap-year taxpayer-MLE use from
    append-only sign entries.
18. applyTrade currently creates a banked Standard TPE as
    plan.maximumIncomingSalary minus plan.incomingSalary. Preserve this exactly:
    a $15M standard source receiving $10M below the first apron creates $5.25M, not
    $5M, because the shipped Standard TPE allowance is included.
19. No runtime consumer exhaustively rejects an unknown/additive transaction-log variant.

Report identifier substitutions. A harmless name drift is not automatically a stop; stop
only if it invalidates the architecture or would require widening scope.

Capture a clean pre-edit baseline:

~~~sh
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
git status --short
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
~~~

Save the profile output for exact post-change comparison. calibrate-history.ts uses
Math.random for sample selection, so record its output but do not pretend separate runs
are byte-comparable. Do not change that harness in this phase.

If an existing required check fails before edits, stop and report the baseline failure.

## 1. Modeled rules

### Eligibility

- The player is canonical free-agent state: present in season.freeAgentPool, has the
  free-agent teamId sentinel, and is absent from every roster.
- The signing team and receiving team both exist and are distinct.
- The signing team owns the player's birdRights.
- This game phase permits only bird or early_bird rights. Reject non_bird. This is an
  explicit game simplification, not a claim that the CBA categorically forbids every
  Non-Bird S&T.
- The desired contract is valid and covers exactly three or four years.
- The desired first-year salary does not exceed
  maximumSalaryForRights(rightsType, experience, currentSalary(player.contract)).
- The desired contract must be a standard contract. A two-way deal cannot be signed and
  traded through this path.

Add:

~~~ts
export const SIGN_AND_TRADE_MIN_YEARS = 3;
export const SIGN_AND_TRADE_MAX_YEARS = 4;
~~~

### Apron and hard-cap rules

- The receiving team's final projected Team Salary must be at or below the 2025–26
  FIRST_APRON constant ($195.945M).
- A successful S&T always sets or strengthens the receiving team's hardCappedAtApron to
  first_apron.
- Use the same projectedTeamSalary value that the current hardCapLegal calls use. Do not
  introduce a third accounting basis or silently switch existing hard-cap behavior to
  projectedApronPayroll in this phase.
- If the receiving team used the taxpayer MLE in the current cap year, it may not acquire
  a player by S&T. Derive this from computeSigningMechanismUsed and capYearForDate.
- Do not add a blanket rule forbidding a signing team whose payroll is above the 2025–26
  second apron. The governing CBA does not establish that proposed predicate. The signing team's
  ordinary matching plan, mechanism restrictions, existing hard cap, and final projection
  still apply.
- If a later transaction uses a banked TPE whose source transaction is sign_and_trade,
  that use triggers a second-apron hard cap. If the same usage also qualifies for the
  existing prior-year first-apron trigger, first_apron wins through stricterHardCap.

### Trade and roster rules

- The S&T player counts at the new contract's salary on both sides of matching.
- The signing team may also send ordinary rostered player assets.
- The receiving team may send ordinary rostered player assets back.
- Normal matching and TPE allocation run for both teams.
- NTC consent applies to ordinary players leaving whichever side is the controlled team.
  The S&T player is a free agent choosing the destination and is not NTC-blocked.
- Validate both standard-roster counts against the final state only. Never validate the
  signing team's temporary shadow roster.
- Reuse tradeWindowOpen as a documented game simplification. The real S&T cutoff is before
  the regular season, but the game has no wired offseason transaction phase yet.

### Approved simplifications

Document these near applySignAndTrade:

- Bird/Early Bird rights proxy prior-team eligibility.
- Contracts are flat and fully guaranteed, so the first-year protection and 5% raise rules
  need no separate machinery.
- Base-year compensation is deferred. Matching uses the full new salary symmetrically.
- S&T is gated by the player's existing desiredContract; there is no negotiation lever.
- Post-S&T re-trade waiting periods are deferred.
- The game uses tradeWindowOpen until an offseason transaction phase exists.

Do not describe the removed signing-team second-apron predicate as a CBA rule or approved
simplification; it should not exist.

## 2. Model changes

Add SignAndTradeEntry in src/models/transaction.ts and include it in TransactionEntry.
Keep it self-describing and keep the asset arrays non-optional on the persisted entry:

~~~ts
export type SignAndTradeRightsType =
  Extract<ReSigningRightsType, 'bird' | 'early_bird'>;

export interface SignAndTradeEntry extends TransactionEntryBase {
  type: 'sign_and_trade';
  playerId: string;
  signingTeamId: string;
  receivingTeamId: string;
  contractSigned: Contract;
  rightsType: SignAndTradeRightsType;
  additionalAssetsFromSigning: TradeAsset[];
  assetsFromReceiving: TradeAsset[];
  createdTradeExceptionIds?: string[];
  tpeUsages?: TradeExceptionUsage[];
  capRoomTeams?: string[];
}
~~~

Use the actual base/type names if live source differs.

No schema bump is expected. This is an additive future log variant; old v6 saves contain
none and remain readable. Do not edit migrations merely to restamp v6. If a runtime
reader actually requires migration, stop and report the concrete reader before changing
the schema.

## 3. TPE integration

### Ledger reads

Update tpe.ts so allUsage accepts both trade and sign_and_trade entries when deriving
tpeUsages. Keep TypeScript narrowing cast-free.

Search every createdTradeExceptionIds and tpeUsages consumer. Update only consumers that
must understand the new entry type.

### S&T-created TPE hard-cap trigger

Extend TpeUsageAnalysis in the smallest clear way so it can report a second-apron trigger
for a grant whose sourceTradeSeq resolves to a sign_and_trade entry.

One acceptable additive shape is:

~~~ts
triggeredFirstApron: Set<string>;
triggeredSecondApron: Set<string>;
~~~

Preserve existing first-apron behavior for prior-year TPEs. When composing a team's
trigger, combine:

1. The matching plan trigger.
2. The existing prior-year-TPE first-apron trigger.
3. The S&T-source-TPE second-apron trigger.

Use stricterHardCap so first_apron remains stricter.

Do not make historic grants fail merely because their source entry cannot be resolved.
Only a positively identified sign_and_trade source creates the new second-apron trigger.

This requires a narrow applyTrade update. It is permitted because pre-Phase-5b worlds
cannot contain a sign_and_trade source entry; all existing behavior must remain unchanged.

### Banked Standard TPE creation

Extract the current banked-grant construction from applyTrade into a shared pure helper
used by applyTrade and applySignAndTrade. Preserve, byte for byte where practical:

- Eligibility: plan.mode is standard, sourcePlayerId exists, and remaining capacity is
  positive.
- Amount: maximumIncomingSalary minus incomingSalary.
- ID format and sourceTradeSeq.
- Team/plan iteration order.
- Creation/expiry dates and createdSeason.

Existing Phase 5a tests must remain unchanged and green. Do not change the amount to
outgoing minus incoming.

## 4. Validators

Add independent predicates returning ValidationResult. Keep them flat and composable.
Use live types and names:

~~~ts
signAndTradeBirdRightsRequired(
  world,
  playerId,
  signingTeamId,
): ValidationResult

signAndTradeTermLegal(
  world,
  playerId,
): ValidationResult

signAndTradeSalaryLegal(
  world,
  playerId,
  signingTeamId,
): ValidationResult

signAndTradeReceivingApronLegal(
  receivingTeamId,
  projectedTeamSalary,
): ValidationResult

signAndTradeReceiverTaxpayerMleLegal(
  world,
  receivingTeamId,
): ValidationResult
~~~

The rights predicate accepts only the signing team's bird or early_bird rights.
The term predicate enforces three or four years. The salary predicate uses the retained
prior contract through currentSalary. The apron predicate uses the matching plan's
projectedTeamSalary. The TMLE predicate derives current-cap-year usage from the immutable
log.

Do not add signAndTradeSendingTeamNotAboveSecondApron.

Reuse existing generic predicates for team/player existence, canonical FA state, desired
contract validity, duplicate players, roster bounds, trade window, NTC, matching,
mechanism-apron legality, and hard-cap legality.

## 5. Gate operation and shadow world

Add:

~~~ts
export interface SignAndTradeOp {
  signingTeamId: string;
  receivingTeamId: string;
  playerId: string;
  additionalAssetsFromSigning?: TradeAsset[];
  assetsFromReceiving?: TradeAsset[];
  controlledTeamId?: string;
  tpeUsages?: RequestedTpeUsage[];
}

export function applySignAndTrade(
  world: RosterWorld,
  op: SignAndTradeOp,
): TransactionResult
~~~

Canonicalize optional asset lists to new arrays immediately. Never mutate caller-owned
arrays.

### Required flow

1. Validate on the original world:
   - Both teams exist and are distinct.
   - The S&T player exists and is canonical free-agent state.
   - The player has a valid desired contract.
   - Rights, term, salary, trade window, and receiver prior-TMLE predicates pass.
   - Additional and return player assets exist and belong to their giving teams.
   - No ID is duplicated across the S&T player and either asset list.

2. Instantiate the contract exactly once:

~~~ts
const newContract = instantiateContract(player.desiredContract);
~~~

   Do not call instantiateContract again during this attempt.

3. Build a local structuredClone shadow of the original world:
   - Attach structuredClone(newContract) to the S&T player.
   - Set that player's teamId to signingTeamId.
   - Delete birdRights and desiredContract.
   - Remove the player from the shadow FA pool.
   - Add the player to the shadow signing-team roster.

4. Build the shadow TradeProposal only through buildTrade/playerAsset:
   - signing side outgoing: S&T player followed by additionalAssetsFromSigning.
   - receiving side outgoing: assetsFromReceiving.

5. Run consent and final roster projections against the shadow proposal:
   - noControlledTeamNtc sees the S&T player's fresh no-NTC contract plus ordinary assets
     on both sides.
   - Use projectStandardRosterCount on the shadow for both final projections. This is
     important: the shadow gives the S&T player the new contract type, whereas the original
     free-agent record still carries the prior contract type.
   - Validate only those post-trade counts. Do not validate the shadow's intermediate
     signing-team roster size.

6. On the shadow, run analyzeTpeUsages and analyzeTradeMatching exactly as applyTrade does.
   Then compose tradeMatchingLegal and tradeMechanismApronLegal for both teams.
   Do not change cap.ts matching formulas or TradeProposal.

7. Compose hard-cap triggers:
   - Normal matching-plan triggers for each team.
   - TPE first/second-apron triggers for each team.
   - An unconditional first-apron trigger for the receiving team.

8. Validate:
   - signAndTradeReceivingApronLegal against the receiver plan's projectedTeamSalary.
   - hardCapLegal for both teams against each plan's projectedTeamSalary, existing cap,
     and composed trigger.

9. Only after every predicate succeeds, build the final world from the original world:
   - Move the S&T player directly from FA pool to receiving roster.
   - Attach structuredClone(newContract), set receiving teamId, clear birdRights and
     desiredContract.
   - Move ordinary assets in both directions and update teamId values.
   - Apply monotonically strengthened hard-cap state.
   - Create shared-helper banked TPE grants.
   - Record capRoomTeams from the matching plans and update teamExceptionStates through the
     existing helper.
   - Append one SignAndTradeEntry through commitSeason.
   - Store cloned asset arrays, structuredClone(newContract), TPE usages, created grant IDs,
     and cap-room teams.
   - Compute existing salary-floor warnings for both teams.

The shadow is analysis-only and must never be returned, persisted, or used as the base for
the final mutation. A rejection must leave the input world byte-identical.

## 6. Focused harness

Create scripts/test-phase5b.ts using the fixture patterns from test-phase4.ts and
test-phase5a.ts. Keep the harness deterministic. Its payroll setter must support values
above SECOND_APRON.

Cover at least these cases:

### Happy paths

1. Receiver uses cap room; player moves FA pool to receiver and is first-apron hard-capped.
2. Over-cap receiver succeeds through ordinary salary matching.
3. Multiple return assets and additional signing-team assets move correctly.
4. Early Bird three-year S&T succeeds at the exact rights maximum.
5. Signing team above SECOND_APRON may still complete an otherwise legal, non-aggregated
   S&T. This guards against reintroducing the unsupported blanket sender block.
6. Signing team at ROSTER_MAX succeeds when the shadow temporarily reaches 16 but the final
   roster remains valid.

### Eligibility and atomic rejection

7. Missing rights, wrong-team rights, and non_bird rights each reject clearly.
8. Two-year and five-year desired contracts reject.
9. Salary above the rights maximum rejects.
10. Noncanonical FA state rejects: stale pool membership, stale teamId, or still rostered.
11. Duplicate IDs across the S&T player/additional/return assets reject.
12. Closed trade window rejects.
13. Final standard-roster floor and ceiling violations reject.
14. NTC blocks an ordinary asset leaving either controlled team.
15. Every representative rejection leaves the input byte-identical.

### Apron and exception composition

16. Receiver matching is otherwise legal but projectedTeamSalary remains just above
    FIRST_APRON: reject specifically on the S&T apron predicate. Lower only the new
    contract enough to cross below the apron and prove the same structure succeeds.
17. Receiver that used taxpayer_mle in the same cap year rejects even if below
    FIRST_APRON.
18. Taxpayer-MLE use in a prior cap year does not trigger the same-year prohibition.
19. Receiver hard cap is first_apron and cannot later be weakened.
20. Existing signing-team hard cap and matching-mechanism triggers are still enforced.

### Log/state correctness

21. Entry fields, seq, asset arrays, rights type, and IDs are correct.
22. Contract is instantiated once; shadow/final/log clones are deep-equal in value and do
    not alias mutable caller data.
23. Signing-team cap hold disappears after success.
24. Player appears exactly once, only on the receiver roster.
25. Dead money is unchanged and no old log entry is rewritten.
26. Existing transaction-log entries are deeply isolated from returned entry mutation.

### TPE composition

27. A $15M S&T player sent for a $10M return player through the shipped standard plan
    creates a $5.25M banked TPE below the first apron. Assert the exact existing formula,
    not $5M.
28. Receiver can allocate a valid banked TPE to the S&T player; usage is written on the
    SignAndTradeEntry and remaining balance decreases.
29. Prior-year TPE use in the S&T preserves the existing first-apron trigger.
30. A later normal trade using a TPE created by an S&T triggers a second-apron hard cap.
31. If that S&T-created TPE is also prior-year, first_apron wins.
32. A later use that would exceed its effective hard cap rejects atomically.
33. Historic/non-S&T TPE behavior remains unchanged.

## 7. Scope guard

Expected implementation files are:

~~~
src/models/transaction.ts
src/transactions/constants.ts
src/transactions/validators.ts
src/transactions/gate.ts
src/transactions/tpe.ts
scripts/test-phase5b.ts
~~~

index.ts already wildcard-exports gate and validators; change it only if live exports prove
insufficient. cap.ts, financial.ts, contracts.ts, exceptions.ts, and world.ts should not
need behavior changes. Any extra file requires an explicit explanation in the final report.

Do not:

- Change applySignFreeAgent.
- Change existing matching formulas or modes.
- Change existing banked-TPE amounts, IDs, or ordering.
- Rewrite prior transaction-log entries.
- Add a new payroll/accounting basis.
- Call instantiateContract twice.
- Mutate the input or caller-owned asset arrays.
- Add RNG.
- Build any later-phase mechanic.

The narrow applyTrade changes permitted are:

1. Calling the extracted banked-TPE grant helper with byte-identical old behavior.
2. Composing the new S&T-source-TPE second-apron trigger, which cannot affect pre-Phase-5b
   logs.

No other applyTrade behavior change is authorized.

## 8. Verification

Run all commands with the repository's reliable Node path:

~~~sh
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run typecheck
node --import tsx scripts/test-transactions.ts
node --import tsx scripts/test-contract-migration.ts
node --import tsx scripts/test-cap-status.ts
node --import tsx scripts/test-phase4.ts
node --import tsx scripts/test-save-migration.ts
node --import tsx scripts/test-phase5a.ts
node --import tsx scripts/test-phase5b.ts
node --import tsx scripts/test-determinism.ts
npm run profile
npm run calibrate
git diff --check
git diff --name-only -- src/engine src/app
~~~

Acceptance:

- Every focused and regression harness passes.
- npm run profile is byte-identical to the captured pre-edit baseline.
- Determinism passes.
- No src/engine or src/app changes exist.
- Existing Phase 5a TPE tests pass unchanged.
- calibrate is run and reported, with its Math.random sampling limitation stated honestly.
  Investigate material drift, but do not claim two independent runs are byte-identical.
- SAVE_SCHEMA_VERSION remains 6 and migrations remain unchanged.

## 9. Stop-and-surface conditions

Stop before implementation, or at the point discovered, if:

1. Baseline checks fail.
2. instantiateContract is impure or requires a second call.
3. Free agents no longer retain a prior-salary source.
4. TradeProposal or matching formulas must change for the shadow to work.
5. Final roster projection cannot be computed with the new contract type without changing
   generic roster semantics.
6. The shared projectedTeamSalary basis cannot serve the existing hard-cap and S&T apron
   checks coherently.
7. TPE analysis cannot consume the shadow proposal without changing generic matching
   semantics.
8. Atomicity would require placing the player on the signing team's final roster.
9. A schema bump, migration, engine change, app change, or old-log rewrite appears necessary.
10. Existing applyTrade behavior changes outside the two explicitly permitted seams.
11. npm run profile changes.
12. A primary CBA source contradicts a modeled rule not explicitly labeled as a game
    simplification.

## 10. Final report

Report:

1. Preflight facts, live schema version, identifier substitutions, prior-salary source, and
   instantiateContract purity.
2. Files changed and why every file was necessary.
3. Validators added with exact signatures.
4. How the shadow was constructed, how final roster counts used the new contract type, and
   why the shadow cannot leak.
5. Proof that the contract was instantiated exactly once.
6. How hard-cap triggers were composed, including prior TMLE use and later use of an
   S&T-created TPE.
7. Confirmation that no blanket second-apron signing-team block was added.
8. The banked-TPE helper extraction and proof existing $15M/$10M behavior remains $5.25M.
9. Why no schema bump or migration was needed.
10. Every verification result, exact profile comparison, and calibrate caveat.
11. Confirmation of atomic rejection, append-only log behavior, asset-array isolation, and
    legality/desirability separation.
12. Confirmation that no engine, app, AI, RFA, draft, waiver, UI, BYC, or later-phase work
    was added.
13. The explicit game simplifications and deferred rules.
