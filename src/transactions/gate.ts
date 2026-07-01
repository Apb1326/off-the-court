import { SeasonState } from '@/models/season';
import {
  TradeProposal,
  TransactionEntry,
  TradeEntry,
  SignEntry,
  CutEntry,
  SignAndTradeEntry,
  TradeAsset,
} from '@/models/transaction';
import { SigningException } from '@/models/transaction';
import { TeamExceptionState, TradeException } from '@/models/season';
import {
  RosterWorld,
  getPlayer,
  getTeam,
  projectStandardRosterCount,
  projectStandardRosterCountForSigning,
} from './world';
import { buildTrade, playerAsset, playerIdsOf } from './assets';
import { FREE_AGENT_TEAM_ID, MINIMUM_TEAM_SALARY, MONEY_EPSILON } from './constants';
import {
  deriveReSigningRightsForCut,
  generateDesiredContract,
  instantiateContract,
} from './contracts';
import {
  analyzeTradeMatching,
  computeTeamPayroll,
  computeCapRoom,
  TradeMatchingPlan,
} from './cap';
import { analyzeSigning } from './financial';
import {
  runValidators,
  teamExists,
  playerExists,
  teamsDistinct,
  playerOnRoster,
  playerInFreeAgentPool,
  playerHasTeamId,
  playerAbsentFromAllRosters,
  playerHasValidDesiredContract,
  noDuplicatePlayers,
  rosterWithinBounds,
  tradeWindowOpen,
  noControlledTeamNtc,
  tradeMatchingLegal,
  tradeMechanismApronLegal,
  hardCapLegal,
  signingCapOrExceptionLegal,
  reSigningRightsLegal,
  minimumSalaryExceptionLegal,
  stricterHardCap,
  stretchElectionLegal,
  signAndTradeBirdRightsRequired,
  signAndTradeTermLegal,
  signAndTradeSalaryLegal,
  signAndTradeReceivingApronLegal,
  signAndTradeReceiverTaxpayerMleLegal,
} from './validators';
import {
  analyzeTpeUsages,
  RequestedTpeUsage,
  TpeUsageAnalysis,
} from './tpe';
import { addOneCalendarYear, capYearForDate } from './date';
import { computeDeadMoney } from './deadMoney';

/**
 * The atomic validate-then-mutate gate — the single chokepoint every roster transaction
 * passes through (AGENTS.md). For each operation: roster-legality validators run first and
 * compose; mutation happens only if all pass; nothing is ever half-applied.
 *
 * Atomicity is structural: a `RosterWorld` is never mutated in place. On failure the gate
 * returns `{ ok: false, reason }` having touched nothing (the input is byte-identical
 * afterward). On success it returns a brand-new `RosterWorld` with new arrays for the
 * affected teams/players/season and structural sharing for everything untouched.
 *
 * This gate is desirability-agnostic: legality applies to every transaction regardless of
 * proposer. CPU willingness lives separately in `evaluateTradeForCpu` (evaluate.ts).
 */

export type TransactionResult =
  | { ok: true; world: RosterWorld; entry: TransactionEntry; warnings?: string[] }
  | { ok: false; reason: string };

export interface TradeOptions {
  controlledTeamId?: string;
  tpeUsages?: RequestedTpeUsage[];
}

export interface SignOp {
  teamId: string;
  playerId: string;
  exception?: SigningException;
}

export interface CutOp {
  teamId: string;
  playerId: string;
  stretch?: boolean;
}

export interface SignAndTradeOp {
  signingTeamId: string;
  receivingTeamId: string;
  playerId: string;
  additionalAssetsFromSigning?: TradeAsset[];
  assetsFromReceiving?: TradeAsset[];
  controlledTeamId?: string;
  tpeUsages?: RequestedTpeUsage[];
}

/** Base fields shared by every log entry, stamped at append time. */
function entryBase(season: SeasonState): { seq: number; date: string; season: string } {
  return {
    seq: season.transactionLog.length, // monotonic; the log is append-only
    date: season.currentDate,
    season: season.seasonId,
  };
}

/** Append an entry to the log (and optionally swap in a new FA pool), immutably. */
function commitSeason(
  season: SeasonState,
  entry: TransactionEntry,
  freeAgentPool?: string[],
  patch: Partial<Pick<SeasonState, 'tradeExceptions' | 'teamExceptionStates'>> = {},
): { season: SeasonState; entry: TransactionEntry } {
  const storedEntry = structuredClone(entry);
  return {
    season: {
      ...season,
      freeAgentPool: [...(freeAgentPool ?? season.freeAgentPool)],
      ...patch,
      transactionLog: [
        ...season.transactionLog.map((priorEntry) => structuredClone(priorEntry)),
        storedEntry,
      ],
    },
    // Callers may mutate their result object; never expose the append-only stored object.
    entry: structuredClone(storedEntry),
  };
}

function salaryFloorWarnings(world: RosterWorld, teamIds: string[]): string[] {
  return [...new Set(teamIds)].flatMap((teamId) => {
    const payroll = computeTeamPayroll(world, teamId) + computeDeadMoney(world, teamId);
    return payroll < MINIMUM_TEAM_SALARY
      ? [`${teamId} payroll plus dead money is $${payroll.toFixed(3)}M, below the $${MINIMUM_TEAM_SALARY.toFixed(3)}M minimum-team-salary floor; compliance remains a non-blocking warning`]
      : [];
  });
}

function exceptionStatesAfter(
  world: RosterWorld,
  teamIds: string[],
  forcedRoomTeams: string[] = [],
): TeamExceptionState[] {
  const year = capYearForDate(world.season.currentDate);
  const states = world.season.teamExceptionStates.map((state) => structuredClone(state));
  const forced = new Set(forcedRoomTeams);
  for (const teamId of [...new Set(teamIds)].sort()) {
    if (!forced.has(teamId) && computeCapRoom(world, teamId) <= MONEY_EPSILON) continue;
    if (!states.some((state) => state.teamId === teamId && state.capYear === year)) {
      states.push({ teamId, capYear: year, operatedUnderCap: true });
    }
  }
  return states;
}

/** Exact Phase 5a banked-Standard-TPE construction, shared without changing its rules. */
function bankedTradeExceptionGrants(
  season: SeasonState,
  tradeSeq: number,
  teamPlans: ReadonlyArray<{ teamId: string; plan: TradeMatchingPlan }>,
): TradeException[] {
  return teamPlans.flatMap(({ teamId, plan }) => {
    const banked = plan.maximumIncomingSalary - plan.incomingSalary;
    if (plan.mode !== 'standard' || !plan.sourcePlayerId || banked <= MONEY_EPSILON) return [];
    return [{
      id: `tpe_${tradeSeq}_${teamId}_${plan.sourcePlayerId}`,
      teamId,
      sourceTradeSeq: tradeSeq,
      sourcePlayerId: plan.sourcePlayerId,
      amount: banked,
      createdDate: season.currentDate,
      expiresDate: addOneCalendarYear(season.currentDate),
      createdSeason: season.seasonId,
    }];
  });
}

function composedTradeHardCap(
  teamId: string,
  plan: TradeMatchingPlan,
  tpe: Extract<TpeUsageAnalysis, { ok: true }>,
  unconditional?: 'first_apron' | 'second_apron',
): 'first_apron' | 'second_apron' | undefined {
  const withSignAndTradeTpe = stricterHardCap(
    plan.triggeredHardCap,
    tpe.triggeredSecondApron.has(teamId) ? 'second_apron' : undefined,
  );
  const withPriorYearTpe = stricterHardCap(
    withSignAndTradeTpe,
    tpe.triggeredFirstApron.has(teamId) ? 'first_apron' : undefined,
  );
  return stricterHardCap(withPriorYearTpe, unconditional);
}

// --- trade ---

/**
 * Execute a trade between two teams. Supports uneven counts (e.g. 2-for-1). Both rosters
 * must remain within size bounds afterward; every traded player must be on the giving team's
 * roster; no player may appear twice.
 *
 * Phase 1 allows zero-asset sides (including 0-for-0). This is intentional — roster-legality
 * is the only constraint here. Salary-matching (Phase 4) will naturally require non-trivial
 * compensation once it exists. A 0-for-0 trade is a harmless no-op that appends a log entry.
 */
export function applyTrade(
  world: RosterWorld,
  proposal: TradeProposal,
  options: TradeOptions = {},
): TransactionResult {
  const { teamA, teamB } = proposal;
  const idsFromA = playerIdsOf(proposal.assetsFromA);
  const idsFromB = playerIdsOf(proposal.assetsFromB);

  const check = runValidators([
    () => teamExists(world, teamA),
    () => teamExists(world, teamB),
    () => teamsDistinct(teamA, teamB),
    () => noDuplicatePlayers([...idsFromA, ...idsFromB]),
    ...idsFromA.map((id) => () => playerExists(world, id)),
    ...idsFromB.map((id) => () => playerExists(world, id)),
    ...idsFromA.map((id) => () => playerOnRoster(world, teamA, id)),
    ...idsFromB.map((id) => () => playerOnRoster(world, teamB, id)),
    () => rosterWithinBounds(
      teamA,
      projectStandardRosterCount(world, teamA, idsFromA, idsFromB),
    ),
    () => rosterWithinBounds(
      teamB,
      projectStandardRosterCount(world, teamB, idsFromB, idsFromA),
    ),
  ]);
  if (!check.ok) return check;

  const temporalAndConsentCheck = runValidators([
    () => tradeWindowOpen(world),
    () => noControlledTeamNtc(world, proposal, options.controlledTeamId),
  ]);
  if (!temporalAndConsentCheck.ok) return temporalAndConsentCheck;

  const tpe = analyzeTpeUsages(world, proposal, options.tpeUsages);
  if (!tpe.ok) return { ok: false, reason: `TPE validation failed: ${tpe.reason}` };
  const matching = analyzeTradeMatching(world, proposal, tpe.allocatedByTeam);
  const matchingCheck = runValidators([
    () => tradeMatchingLegal(teamA, matching.teamA),
    () => tradeMatchingLegal(teamB, matching.teamB),
  ]);
  if (!matchingCheck.ok) return matchingCheck;
  // The validator above proves both discriminated unions are successful.
  if (!matching.teamA.ok || !matching.teamB.ok) return { ok: false, reason: 'unreachable matching state' };
  const planA = matching.teamA.plan;
  const planB = matching.teamB.plan;
  const existingTeamA = getTeam(world, teamA)!;
  const existingTeamB = getTeam(world, teamB)!;
  const triggerA = composedTradeHardCap(teamA, planA, tpe);
  const triggerB = composedTradeHardCap(teamB, planB, tpe);
  const apronAndHardCapCheck = runValidators([
    () => tradeMechanismApronLegal(teamA, planA),
    () => tradeMechanismApronLegal(teamB, planB),
    // DESIGN DECISION: This check uses Team Salary (payroll + cap holds + incomplete
    // roster charges), rather than the narrower Apron Team Salary the real CBA specifies.
    // This is intentionally more restrictive and avoids splitting the accounting basis
    // before Phase 5a's full exception system (MLE/BAE/dead money) exists. Once Phase 5a
    // ships and tax/apron payroll diverges from raw payroll, revisit whether hard cap
    // enforcement should switch to the narrower Apron Team Salary base.
    () => hardCapLegal(
      teamA, planA.projectedTeamSalary,
      existingTeamA.hardCappedAtApron, triggerA,
    ),
    () => hardCapLegal(
      teamB, planB.projectedTeamSalary,
      existingTeamB.hardCappedAtApron, triggerB,
    ),
  ]);
  if (!apronAndHardCapCheck.ok) return apronAndHardCapCheck;

  // Legality proven — build the new world immutably.
  const leavingA = new Set(idsFromA);
  const leavingB = new Set(idsFromB);

  const teams = world.teams.map((t) => {
    if (t.id === teamA) {
      const hardCappedAtApron = stricterHardCap(t.hardCappedAtApron, triggerA);
      return {
        ...t,
        roster: [...t.roster.filter((id) => !leavingA.has(id)), ...idsFromB],
        ...(hardCappedAtApron ? { hardCappedAtApron } : {}),
      };
    }
    if (t.id === teamB) {
      const hardCappedAtApron = stricterHardCap(t.hardCappedAtApron, triggerB);
      return {
        ...t,
        roster: [...t.roster.filter((id) => !leavingB.has(id)), ...idsFromA],
        ...(hardCappedAtApron ? { hardCappedAtApron } : {}),
      };
    }
    return t;
  });
  // NOTE (downstream, not Phase 1 scope): a traded player remains in the old team's
  // rotation.starters / rotationOrder and is absent from the new team's. The existing
  // adjustRotation in engine/injury.ts handles this gracefully (treats a missing player
  // like an injured one), but a traded-in star won't start until someone goes down.
  // When trades become user-facing, reconcile rotation settings as part of the mutation
  // or as a post-trade caller responsibility.

  const players = world.players.map((p) => {
    if (leavingA.has(p.id)) return { ...p, teamId: teamB };
    if (leavingB.has(p.id)) return { ...p, teamId: teamA };
    return p;
  });
  // NOTE (downstream, not Phase 1 scope): PlayerSeasonStats.teamId in
  // SeasonState.playerStats is not updated here — stats continue accumulating under
  // the old team's id. The real NBA tracks split stats (separate lines per team per
  // season). Address when trades become user-facing; not this phase's concern.

  const tradeSeq = world.season.transactionLog.length;
  const grants = bankedTradeExceptionGrants(world.season, tradeSeq, [
    { teamId: teamA, plan: planA },
    { teamId: teamB, plan: planB },
  ]);
  const capRoomTeams = [
    ...(planA.mode === 'room' ? [teamA] : []),
    ...(planB.mode === 'room' ? [teamB] : []),
  ];
  const entry: TradeEntry = {
    ...entryBase(world.season),
    type: 'trade',
    teamA,
    teamB,
    assetsFromA: proposal.assetsFromA,
    assetsFromB: proposal.assetsFromB,
    ...(grants.length ? { createdTradeExceptionIds: grants.map((grant) => grant.id) } : {}),
    ...(tpe.usages.length ? { tpeUsages: tpe.usages } : {}),
    ...(capRoomTeams.length ? { capRoomTeams } : {}),
  };
  const preCommitWorld = { teams, players, season: world.season };
  const teamExceptionStates = exceptionStatesAfter(preCommitWorld, [teamA, teamB], capRoomTeams);
  const committed = commitSeason(world.season, entry, undefined, {
    tradeExceptions: [...world.season.tradeExceptions.map((grant) => structuredClone(grant)), ...grants],
    teamExceptionStates,
  });

  const nextWorld = { teams, players, season: committed.season };
  const warnings = salaryFloorWarnings(nextWorld, [teamA, teamB]);
  return {
    ok: true,
    world: nextWorld,
    entry: committed.entry,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// --- sign-and-trade ---

/**
 * Atomically sign an eligible free agent with the rights-owning team and trade the new
 * contract. Approved game simplifications: Bird/Early Bird rights proxy prior-team
 * eligibility; contracts are flat and fully guaranteed, so first-year protection and 5%
 * raises need no separate machinery; base-year compensation is deferred and matching is
 * symmetric at the full new salary; desiredContract is the only negotiation lever;
 * post-S&T re-trade waiting periods are deferred; and tradeWindowOpen stands in until an
 * offseason transaction phase exists.
 */
export function applySignAndTrade(
  world: RosterWorld,
  op: SignAndTradeOp,
): TransactionResult {
  const { signingTeamId, receivingTeamId, playerId } = op;
  const additionalAssetsFromSigning = structuredClone(op.additionalAssetsFromSigning ?? []);
  const assetsFromReceiving = structuredClone(op.assetsFromReceiving ?? []);
  const requestedTpeUsages = structuredClone(op.tpeUsages ?? []);
  const additionalPlayerIds = playerIdsOf(additionalAssetsFromSigning);
  const receivingPlayerIds = playerIdsOf(assetsFromReceiving);

  const originalCheck = runValidators([
    () => teamExists(world, signingTeamId),
    () => teamExists(world, receivingTeamId),
    () => teamsDistinct(signingTeamId, receivingTeamId),
    () => playerExists(world, playerId),
    () => playerInFreeAgentPool(world, playerId),
    () => playerHasTeamId(world, playerId, FREE_AGENT_TEAM_ID),
    () => playerAbsentFromAllRosters(world, playerId),
    () => playerHasValidDesiredContract(world, playerId),
    () => signAndTradeBirdRightsRequired(world, playerId, signingTeamId),
    () => signAndTradeTermLegal(world, playerId),
    () => signAndTradeSalaryLegal(world, playerId, signingTeamId),
    () => tradeWindowOpen(world),
    () => signAndTradeReceiverTaxpayerMleLegal(world, receivingTeamId),
    () => noDuplicatePlayers([playerId, ...additionalPlayerIds, ...receivingPlayerIds]),
    ...additionalPlayerIds.map((id) => () => playerExists(world, id)),
    ...receivingPlayerIds.map((id) => () => playerExists(world, id)),
    ...additionalPlayerIds.map((id) => () => playerOnRoster(world, signingTeamId, id)),
    ...receivingPlayerIds.map((id) => () => playerOnRoster(world, receivingTeamId, id)),
  ]);
  if (!originalCheck.ok) return originalCheck;

  const signingPlayer = getPlayer(world, playerId)!;
  const rightsType = signingPlayer.birdRights!.type;
  if (rightsType !== 'bird' && rightsType !== 'early_bird') {
    return { ok: false, reason: 'unreachable sign-and-trade rights state' };
  }
  // Exactly one instantiation per attempt. Shadow, final player, and log each receive clones.
  const newContract = instantiateContract(signingPlayer.desiredContract!);

  const shadow = structuredClone(world);
  const shadowPlayer = getPlayer(shadow, playerId)!;
  shadowPlayer.teamId = signingTeamId;
  shadowPlayer.contract = structuredClone(newContract);
  delete shadowPlayer.birdRights;
  delete shadowPlayer.desiredContract;
  shadow.season.freeAgentPool = shadow.season.freeAgentPool.filter((id) => id !== playerId);
  getTeam(shadow, signingTeamId)!.roster.push(playerId);

  const proposal = buildTrade(
    signingTeamId,
    receivingTeamId,
    [playerAsset(playerId), ...structuredClone(additionalAssetsFromSigning)],
    structuredClone(assetsFromReceiving),
  );
  const idsFromSigning = playerIdsOf(proposal.assetsFromA);
  const idsFromReceiving = playerIdsOf(proposal.assetsFromB);

  const consentAndRosterCheck = runValidators([
    () => noControlledTeamNtc(shadow, proposal, op.controlledTeamId),
    () => rosterWithinBounds(
      signingTeamId,
      projectStandardRosterCount(
        shadow,
        signingTeamId,
        idsFromSigning,
        idsFromReceiving,
      ),
    ),
    () => rosterWithinBounds(
      receivingTeamId,
      projectStandardRosterCount(
        shadow,
        receivingTeamId,
        idsFromReceiving,
        idsFromSigning,
      ),
    ),
  ]);
  if (!consentAndRosterCheck.ok) return consentAndRosterCheck;

  const tpe = analyzeTpeUsages(shadow, proposal, requestedTpeUsages);
  if (!tpe.ok) return { ok: false, reason: `TPE validation failed: ${tpe.reason}` };
  const matching = analyzeTradeMatching(shadow, proposal, tpe.allocatedByTeam);
  const matchingCheck = runValidators([
    () => tradeMatchingLegal(signingTeamId, matching.teamA),
    () => tradeMatchingLegal(receivingTeamId, matching.teamB),
  ]);
  if (!matchingCheck.ok) return matchingCheck;
  if (!matching.teamA.ok || !matching.teamB.ok) {
    return { ok: false, reason: 'unreachable matching state' };
  }

  const signingPlan = matching.teamA.plan;
  const receivingPlan = matching.teamB.plan;
  const signingTrigger = composedTradeHardCap(signingTeamId, signingPlan, tpe);
  const receivingTrigger = composedTradeHardCap(
    receivingTeamId,
    receivingPlan,
    tpe,
    'first_apron',
  );
  const existingSigningTeam = getTeam(world, signingTeamId)!;
  const existingReceivingTeam = getTeam(world, receivingTeamId)!;
  const apronAndHardCapCheck = runValidators([
    () => tradeMechanismApronLegal(signingTeamId, signingPlan),
    () => tradeMechanismApronLegal(receivingTeamId, receivingPlan),
    () => signAndTradeReceivingApronLegal(
      receivingTeamId,
      receivingPlan.projectedTeamSalary,
    ),
    () => hardCapLegal(
      signingTeamId,
      signingPlan.projectedTeamSalary,
      existingSigningTeam.hardCappedAtApron,
      signingTrigger,
    ),
    () => hardCapLegal(
      receivingTeamId,
      receivingPlan.projectedTeamSalary,
      existingReceivingTeam.hardCappedAtApron,
      receivingTrigger,
    ),
  ]);
  if (!apronAndHardCapCheck.ok) return apronAndHardCapCheck;

  // All predicates passed. Build final state from the original world, never the shadow.
  const leavingSigning = new Set(additionalPlayerIds);
  const leavingReceiving = new Set(receivingPlayerIds);
  const teams = world.teams.map((team) => {
    if (team.id === signingTeamId) {
      const hardCappedAtApron = stricterHardCap(
        team.hardCappedAtApron,
        signingTrigger,
      );
      return {
        ...team,
        roster: [
          ...team.roster.filter((id) => !leavingSigning.has(id)),
          ...receivingPlayerIds,
        ],
        ...(hardCappedAtApron ? { hardCappedAtApron } : {}),
      };
    }
    if (team.id === receivingTeamId) {
      const hardCappedAtApron = stricterHardCap(
        team.hardCappedAtApron,
        receivingTrigger,
      );
      return {
        ...team,
        roster: [
          ...team.roster.filter((id) => !leavingReceiving.has(id)),
          playerId,
          ...additionalPlayerIds,
        ],
        ...(hardCappedAtApron ? { hardCappedAtApron } : {}),
      };
    }
    return team;
  });

  const players = world.players.map((player) => {
    if (player.id === playerId) {
      const signed = structuredClone(player);
      signed.teamId = receivingTeamId;
      signed.contract = structuredClone(newContract);
      delete signed.birdRights;
      delete signed.desiredContract;
      return signed;
    }
    if (leavingSigning.has(player.id)) return { ...player, teamId: receivingTeamId };
    if (leavingReceiving.has(player.id)) return { ...player, teamId: signingTeamId };
    return player;
  });

  const tradeSeq = world.season.transactionLog.length;
  const grants = bankedTradeExceptionGrants(world.season, tradeSeq, [
    { teamId: signingTeamId, plan: signingPlan },
    { teamId: receivingTeamId, plan: receivingPlan },
  ]);
  const capRoomTeams = [
    ...(signingPlan.mode === 'room' ? [signingTeamId] : []),
    ...(receivingPlan.mode === 'room' ? [receivingTeamId] : []),
  ];
  const entry: SignAndTradeEntry = {
    ...entryBase(world.season),
    type: 'sign_and_trade',
    playerId,
    signingTeamId,
    receivingTeamId,
    contractSigned: structuredClone(newContract),
    rightsType,
    additionalAssetsFromSigning: structuredClone(additionalAssetsFromSigning),
    assetsFromReceiving: structuredClone(assetsFromReceiving),
    ...(grants.length ? { createdTradeExceptionIds: grants.map((grant) => grant.id) } : {}),
    ...(tpe.usages.length ? { tpeUsages: structuredClone(tpe.usages) } : {}),
    ...(capRoomTeams.length ? { capRoomTeams: [...capRoomTeams] } : {}),
  };
  const freeAgentPool = world.season.freeAgentPool.filter((id) => id !== playerId);
  const preCommitWorld: RosterWorld = {
    teams,
    players,
    season: { ...world.season, freeAgentPool },
  };
  const teamExceptionStates = exceptionStatesAfter(
    preCommitWorld,
    [signingTeamId, receivingTeamId],
    capRoomTeams,
  );
  const committed = commitSeason(world.season, entry, freeAgentPool, {
    tradeExceptions: [
      ...world.season.tradeExceptions.map((grant) => structuredClone(grant)),
      ...grants,
    ],
    teamExceptionStates,
  });
  const nextWorld = { teams, players, season: committed.season };
  const warnings = salaryFloorWarnings(nextWorld, [signingTeamId, receivingTeamId]);
  return {
    ok: true,
    world: nextWorld,
    entry: committed.entry,
    ...(warnings.length ? { warnings } : {}),
  };
}

// --- sign free agent ---

/**
 * Sign a free agent onto a team. Legal iff the player is actually in the FA pool and the
 * team stays within the ceiling afterward.
 */
export function applySignFreeAgent(world: RosterWorld, op: SignOp): TransactionResult {
  const { teamId, playerId } = op;
  const check = runValidators([
    () => teamExists(world, teamId),
    () => playerExists(world, playerId),
    () => playerInFreeAgentPool(world, playerId),
    () => playerHasTeamId(world, playerId, FREE_AGENT_TEAM_ID),
    () => playerAbsentFromAllRosters(world, playerId),
    () => playerHasValidDesiredContract(world, playerId),
    () => rosterWithinBounds(
      teamId,
      projectStandardRosterCountForSigning(world, teamId, playerId),
    ),
  ]);
  if (!check.ok) return check;

  const signing = analyzeSigning(world, teamId, playerId, op.exception);
  const capCheck = runValidators([
    () => signingCapOrExceptionLegal(teamId, signing),
  ]);
  if (!capCheck.ok) return capCheck;
  if (!signing.ok) return { ok: false, reason: 'unreachable signing state' };
  const signingTeam = getTeam(world, teamId)!;
  const hardCapCheck = runValidators([
    () => reSigningRightsLegal(world, teamId, playerId, signing.plan),
    () => minimumSalaryExceptionLegal(world, playerId, signing.plan),
    // DESIGN DECISION: This check uses Team Salary (payroll + cap holds + incomplete
    // roster charges), rather than the narrower Apron Team Salary the real CBA specifies.
    // This is intentionally more restrictive and avoids splitting the accounting basis
    // before Phase 5a's full exception system (MLE/BAE/dead money) exists. Once Phase 5a
    // ships and tax/apron payroll diverges from raw payroll, revisit whether hard cap
    // enforcement should switch to the narrower Apron Team Salary base.
    () => hardCapLegal(
      teamId,
      signing.plan.projectedCapRoomSalary,
      signingTeam.hardCappedAtApron,
      signing.plan.triggeredHardCap,
    ),
  ]);
  if (!hardCapCheck.ok) return hardCapCheck;

  const teams = world.teams.map((t) => {
    if (t.id !== teamId) return t;
    const hardCappedAtApron = stricterHardCap(t.hardCappedAtApron, signing.plan.triggeredHardCap);
    return { ...t, roster: [...t.roster, playerId], ...(hardCappedAtApron ? { hardCappedAtApron } : {}) };
  });

  const signingPlayer = getPlayer(world, playerId)!;
  const newContract = instantiateContract(signingPlayer.desiredContract!);

  const players = world.players.map((p) => {
    if (p.id === playerId) {
      const withoutBirdRights = { ...p };
      delete withoutBirdRights.birdRights;
      return {
        ...withoutBirdRights,
        teamId,
        contract: newContract,
        desiredContract: undefined,
      };
    }
    return p;
  });

  const entry: SignEntry = {
    ...entryBase(world.season),
    type: 'sign',
    playerId,
    toTeamId: teamId,
    contractSigned: structuredClone(newContract),
    signingMechanism: signing.plan.mechanism,
  };
  const freeAgentPool = world.season.freeAgentPool.filter((id) => id !== playerId);
  const preCommitWorld = {
    teams,
    players,
    season: {
      ...world.season,
      freeAgentPool,
      transactionLog: [...world.season.transactionLog, structuredClone(entry)],
    },
  };
  const teamExceptionStates = exceptionStatesAfter(
    preCommitWorld,
    [teamId],
    signing.plan.mechanism === 'room' ? [teamId] : [],
  );
  const committed = commitSeason(world.season, entry, freeAgentPool, { teamExceptionStates });
  const nextWorld = { teams, players, season: committed.season };
  const warnings = salaryFloorWarnings(nextWorld, [teamId]);

  return {
    ok: true,
    world: nextWorld,
    entry: committed.entry,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// --- cut / waive (collapsed in Phase 1: straight to the FA pool, for free) ---

/**
 * Cut a player. Legal iff the player is on the team's roster and the team stays at/above the
 * floor afterward — a team at the minimum must sign a replacement before it can cut. The
 * player goes straight to the FA pool (the real waiver process is deferred). Cuts remain
 * financially incomplete until Phase 5a derives dead money from the immutable cut entry.
 */
export function applyCut(world: RosterWorld, op: CutOp): TransactionResult {
  const { teamId, playerId } = op;
  const check = runValidators([
    () => teamExists(world, teamId),
    () => playerExists(world, playerId),
    () => playerOnRoster(world, teamId, playerId),
    () => rosterWithinBounds(
      teamId,
      projectStandardRosterCount(world, teamId, [playerId], []),
    ),
    () => stretchElectionLegal(world, playerId, op.stretch === true),
  ]);
  if (!check.ok) return check;

  const teams = world.teams.map((t) =>
    t.id === teamId ? { ...t, roster: t.roster.filter((id) => id !== playerId) } : t,
  );

  const cutPlayer = world.players.find(p => p.id === playerId);

  const players = world.players.map((p) => {
    if (p.id === playerId) {
      return {
        ...p,
        teamId: FREE_AGENT_TEAM_ID,
        desiredContract: generateDesiredContract(p),
        birdRights: deriveReSigningRightsForCut(p.contract, p.experience, teamId),
      };
    }
    return p;
  });

  const entry: CutEntry = {
    ...entryBase(world.season),
    type: 'cut',
    playerId,
    fromTeamId: teamId,
    contractAtCut: cutPlayer?.contract ? structuredClone(cutPlayer.contract) : undefined,
    ...(op.stretch ? { stretchApplied: true } : {}),
  };
  const freeAgentPool = [...world.season.freeAgentPool, playerId];
  const preCommitWorld = {
    teams,
    players,
    season: {
      ...world.season,
      freeAgentPool,
      transactionLog: [...world.season.transactionLog, structuredClone(entry)],
    },
  };
  const teamExceptionStates = exceptionStatesAfter(preCommitWorld, [teamId]);
  const committed = commitSeason(world.season, entry, freeAgentPool, { teamExceptionStates });
  const nextWorld = { teams, players, season: committed.season };
  const warnings = salaryFloorWarnings(nextWorld, [teamId]);

  return {
    ok: true,
    world: nextWorld,
    entry: committed.entry,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
