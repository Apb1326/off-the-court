/**
 * Pure salary-cap analytics and projections (transactions Phases 3-4).
 *
 * Nothing in this module is persisted. Cap-room salary and tax/apron payroll
 * deliberately use separate accounting bases. Phase 4 cap holds are owned
 * through explicit re-signing rights on free agents.
 */

import { Player } from '@/models/player';
import { TradeProposal } from '@/models/transaction';
import {
  CAP_HOLD_PERCENTAGE,
  CAP_RULES_YEAR,
  FIRST_APRON,
  INCOMPLETE_ROSTER_THRESHOLD,
  LUXURY_TAX_LINE,
  MINIMUM_TEAM_SALARY,
  ROOKIE_MINIMUM_SALARY,
  SALARY_CAP,
  SECOND_APRON,
  TRADE_ALLOWANCE,
  EXPANDED_TPE_CUSHION_2025_26,
} from './constants';
import { currentSalary } from './contracts';
import { getPlayer, getTeam, isStandardContractPlayer, RosterWorld } from './world';
import { playerIdsOf } from './assets';

const MONEY_EPSILON = 1e-9;

function getTeamOrThrow(world: RosterWorld, teamId: string) {
  const team = getTeam(world, teamId);
  if (!team) throw new Error(`cannot compute financials: team "${teamId}" does not exist`);
  return team;
}

function getRosterPlayersOrThrow(world: RosterWorld, teamId: string): Player[] {
  const team = getTeamOrThrow(world, teamId);
  return team.roster.map((playerId) => {
    const player = getPlayer(world, playerId);
    if (!player) {
      throw new Error(
        `cannot compute financials: team "${teamId}" roster references missing player "${playerId}"`,
      );
    }
    return player;
  });
}

function standardRosterPlayers(players: Player[]): Player[] {
  return players.filter(isStandardContractPlayer);
}

function payrollFromPlayers(players: Player[]): number {
  return standardRosterPlayers(players).reduce(
    (total, player) => total + currentSalary(player.contract),
    0,
  );
}

function incompleteRosterChargeFromPlayers(players: Player[]): number {
  const missingSlots = Math.max(
    0,
    INCOMPLETE_ROSTER_THRESHOLD - standardRosterPlayers(players).length,
  );
  return missingSlots * ROOKIE_MINIMUM_SALARY;
}

/** Phase 3's deliberately simplified cap-hold amount, now with explicit ownership. */
export function computePlayerCapHold(player: Player): number {
  return Math.max(
    currentSalary(player.contract) * CAP_HOLD_PERCENTAGE,
    ROOKIE_MINIMUM_SALARY,
  );
}

function capHoldsForKnownTeam(
  world: RosterWorld,
  teamId: string,
  excludedPlayerId?: string,
): number {
  const currentFreeAgents = new Set(world.season.freeAgentPool);
  // Sorting makes the floating-point reduction independent of FA-pool ordering.
  return [...currentFreeAgents]
    .sort()
    .reduce((total, playerId) => {
      if (playerId === excludedPlayerId) return total;
      const player = getPlayer(world, playerId);
      if (!player) {
        throw new Error(`cannot compute cap holds: missing free agent "${playerId}"`);
      }
      return player.birdRights?.teamId === teamId
        ? total + computePlayerCapHold(player)
        : total;
    }, 0);
}

/** Current standard-contract payroll, excluding two-way contracts. */
export function computeTeamPayroll(world: RosterWorld, teamId: string): number {
  return payrollFromPlayers(getRosterPlayersOrThrow(world, teamId));
}

/**
 * Free-agent holds attributed by explicit re-signing rights. Seeded FAs without
 * rights create no hold.
 */
export function computeCapHolds(world: RosterWorld, teamId: string): number {
  getTeamOrThrow(world, teamId);
  return capHoldsForKnownTeam(world, teamId);
}

/** Cap holds for a team, optionally excluding one player whose hold is being replaced. */
export function computeCapHoldsExcluding(
  world: RosterWorld,
  teamId: string,
  excludedPlayerId: string,
): number {
  getTeamOrThrow(world, teamId);
  return capHoldsForKnownTeam(world, teamId, excludedPlayerId);
}

/** Empty-slot charges below 12 standard contracts; two-way deals do not fill a slot. */
export function computeIncompleteRosterCharge(
  world: RosterWorld,
  teamId: string,
): number {
  return incompleteRosterChargeFromPlayers(getRosterPlayersOrThrow(world, teamId));
}

/** Payroll basis used for cap-room calculations. */
export function computeCapRoomSalary(world: RosterWorld, teamId: string): number {
  const players = getRosterPlayersOrThrow(world, teamId);
  return (
    payrollFromPlayers(players) +
    capHoldsForKnownTeam(world, teamId) +
    incompleteRosterChargeFromPlayers(players)
  );
}

/** Positive means room is available; negative means the team is over the cap. */
export function computeCapRoom(world: RosterWorld, teamId: string): number {
  return SALARY_CAP - computeCapRoomSalary(world, teamId);
}

/** Phase 3 tax payroll is raw standard-contract payroll only. */
export function computeTaxPayroll(world: RosterWorld, teamId: string): number {
  return computeTeamPayroll(world, teamId);
}

/** Phase 3 apron payroll is raw standard-contract payroll only. */
export function computeApronPayroll(world: RosterWorld, teamId: string): number {
  return computeTeamPayroll(world, teamId);
}

function rosterPlayersAfterTrade(
  world: RosterWorld,
  teamId: string,
  outgoingPlayerIds: string[],
  incomingPlayerIds: string[],
): Player[] {
  const outgoing = new Set(outgoingPlayerIds);
  const retained = getRosterPlayersOrThrow(world, teamId).filter((player) => !outgoing.has(player.id));
  const incoming = incomingPlayerIds.map((playerId) => {
    const player = getPlayer(world, playerId);
    if (!player) throw new Error(`cannot project trade: missing player "${playerId}"`);
    return player;
  });
  return [...retained, ...incoming];
}

/** Project the cap-room Team Salary accounting basis after one side of a trade. */
export function projectPostTradeCapRoomSalary(
  world: RosterWorld,
  teamId: string,
  outgoingPlayerIds: string[],
  incomingPlayerIds: string[],
): number {
  const players = rosterPlayersAfterTrade(world, teamId, outgoingPlayerIds, incomingPlayerIds);
  return payrollFromPlayers(players) +
    capHoldsForKnownTeam(world, teamId) +
    incompleteRosterChargeFromPlayers(players);
}

/** Project the apron-payroll accounting basis after one side of a trade. */
export function projectPostTradeApronPayroll(
  world: RosterWorld,
  teamId: string,
  outgoingPlayerIds: string[],
  incomingPlayerIds: string[],
): number {
  return payrollFromPlayers(
    rosterPlayersAfterTrade(world, teamId, outgoingPlayerIds, incomingPlayerIds),
  );
}

/** Project cap-room Team Salary after signing, replacing the player's own hold. */
export function projectPostSigningCapRoomSalary(
  world: RosterWorld,
  teamId: string,
  playerId: string,
): number {
  const player = getPlayer(world, playerId);
  if (!player?.desiredContract) {
    throw new Error(`cannot project signing: player "${playerId}" has no desired contract`);
  }
  const rosterPlayers = getRosterPlayersOrThrow(world, teamId);
  const signingCounts = player.desiredContract.type !== 'two_way';
  const payroll = payrollFromPlayers(rosterPlayers) +
    (signingCounts ? player.desiredContract.desiredSalary : 0);
  const standardCount = standardRosterPlayers(rosterPlayers).length + (signingCounts ? 1 : 0);
  const incomplete = Math.max(0, INCOMPLETE_ROSTER_THRESHOLD - standardCount) * ROOKIE_MINIMUM_SALARY;
  return payroll + capHoldsForKnownTeam(world, teamId, playerId) + incomplete;
}

/** Project apron payroll after signing; two-way salary is excluded. */
export function projectPostSigningApronPayroll(
  world: RosterWorld,
  teamId: string,
  playerId: string,
): number {
  const player = getPlayer(world, playerId);
  if (!player?.desiredContract) {
    throw new Error(`cannot project signing: player "${playerId}" has no desired contract`);
  }
  return computeApronPayroll(world, teamId) +
    (player.desiredContract.type === 'two_way' ? 0 : player.desiredContract.desiredSalary);
}

export type TradeMatchingMode = 'room' | 'standard' | 'aggregated_standard' | 'expanded';

export interface TradeMatchingPlan {
  mode: TradeMatchingMode;
  outgoingSalary: number;
  incomingSalary: number;
  maximumIncomingSalary: number;
  projectedApronPayroll: number;
  projectedTeamSalary: number;
  triggeredHardCap?: 'first_apron' | 'second_apron';
}

export type TradeMatchingAnalysis =
  | { ok: true; plan: TradeMatchingPlan }
  | { ok: false; reason: string };

/** Direct CBA Expanded TPE formula. Do not replace with derived tier boundaries. */
export function expandedTpeMaximum(
  outgoingSalary: number,
  allowance = TRADE_ALLOWANCE,
): number {
  return Math.max(
    Math.min(
      outgoingSalary * 2 + allowance,
      outgoingSalary + EXPANDED_TPE_CUSHION_2025_26,
    ),
    outgoingSalary * 1.25 + allowance,
  );
}

function matchingSalary(world: RosterWorld, playerIds: string[]): number {
  return playerIds.reduce((total, playerId) => {
    const player = getPlayer(world, playerId);
    if (!player) throw new Error(`cannot analyze trade: missing player "${playerId}"`);
    return total + (isStandardContractPlayer(player) ? currentSalary(player.contract) : 0);
  }, 0);
}

function matchingPlayerCount(world: RosterWorld, playerIds: string[]): number {
  return playerIds.reduce((count, playerId) => {
    const player = getPlayer(world, playerId);
    if (!player) throw new Error(`cannot analyze trade: missing player "${playerId}"`);
    return count + (isStandardContractPlayer(player) ? 1 : 0);
  }, 0);
}

/**
 * Analyze one team's side as one simultaneous transaction. Candidate order is
 * deliberately least restrictive: room/standard, then second-apron aggregation,
 * then first-apron Expanded TPE.
 */
export function analyzeTradeMatchingForTeam(
  world: RosterWorld,
  teamId: string,
  outgoingPlayerIds: string[],
  incomingPlayerIds: string[],
): TradeMatchingAnalysis {
  const outgoingSalary = matchingSalary(world, outgoingPlayerIds);
  const incomingSalary = matchingSalary(world, incomingPlayerIds);
  const outgoingCount = matchingPlayerCount(world, outgoingPlayerIds);
  const projectedApronPayroll = projectPostTradeApronPayroll(
    world, teamId, outgoingPlayerIds, incomingPlayerIds,
  );
  const projectedTeamSalary = projectPostTradeCapRoomSalary(
    world, teamId, outgoingPlayerIds, incomingPlayerIds,
  );
  // DESIGN DECISION: This check uses Team Salary (payroll + cap holds + incomplete
  // roster charges), rather than the narrower Apron Team Salary the real CBA specifies.
  // This is intentionally more restrictive and avoids splitting the accounting basis
  // before Phase 5a's full exception system (MLE/BAE/dead money) exists. Once Phase 5a
  // ships and tax/apron payroll diverges from raw payroll, revisit whether this check
  // should switch to the narrower Apron Team Salary base.
  const allowance = projectedTeamSalary > FIRST_APRON + MONEY_EPSILON ? 0 : TRADE_ALLOWANCE;
  const currentRoom = computeCapRoom(world, teamId);

  if (outgoingSalary === 0 && incomingSalary === 0) {
    return { ok: true, plan: {
      mode: 'standard', outgoingSalary, incomingSalary, maximumIncomingSalary: 0,
      projectedApronPayroll, projectedTeamSalary,
    } };
  }

  if (currentRoom > MONEY_EPSILON) {
    // Derive room from the fully projected Team Salary so uneven deals correctly
    // add or remove incomplete-roster charges.
    const maximumIncomingSalary = incomingSalary +
      (SALARY_CAP + allowance - projectedTeamSalary);
    return projectedTeamSalary <= SALARY_CAP + allowance + MONEY_EPSILON
      ? { ok: true, plan: {
        mode: 'room', outgoingSalary, incomingSalary, maximumIncomingSalary,
        projectedApronPayroll, projectedTeamSalary,
      } }
      : { ok: false, reason: `${teamId} can acquire at most $${maximumIncomingSalary.toFixed(3)}M using cap room` };
  }

  if (outgoingCount >= 1) {
    // Multiple players may leave without their salaries being aggregated. If
    // one outgoing player's Standard TPE covers all incoming salary, use that
    // no-hard-cap mechanism and simply do not bank the other outgoing TPEs.
    const largestOutgoingSalary = outgoingPlayerIds.reduce((largest, playerId) => {
      const player = getPlayer(world, playerId)!;
      const salary = isStandardContractPlayer(player) ? currentSalary(player.contract) : 0;
      return Math.max(largest, salary);
    }, 0);
    const maximumIncomingSalary = largestOutgoingSalary + allowance;
    if (incomingSalary <= maximumIncomingSalary + MONEY_EPSILON) {
      return { ok: true, plan: {
        mode: 'standard', outgoingSalary, incomingSalary, maximumIncomingSalary,
        projectedApronPayroll, projectedTeamSalary,
      } };
    }
  }

  if (outgoingCount >= 2) {
    const maximumIncomingSalary = outgoingSalary + allowance;
    if (
      incomingSalary <= maximumIncomingSalary + MONEY_EPSILON &&
      projectedApronPayroll <= SECOND_APRON + MONEY_EPSILON
    ) {
      return { ok: true, plan: {
        mode: 'aggregated_standard', outgoingSalary, incomingSalary, maximumIncomingSalary,
        projectedApronPayroll, projectedTeamSalary, triggeredHardCap: 'second_apron',
      } };
    }
  }

  if (outgoingCount >= 1) {
    const maximumIncomingSalary = expandedTpeMaximum(outgoingSalary, allowance);
    if (
      incomingSalary <= maximumIncomingSalary + MONEY_EPSILON &&
      projectedApronPayroll <= FIRST_APRON + MONEY_EPSILON
    ) {
      return { ok: true, plan: {
        mode: 'expanded', outgoingSalary, incomingSalary, maximumIncomingSalary,
        projectedApronPayroll, projectedTeamSalary, triggeredHardCap: 'first_apron',
      } };
    }
  }

  return {
    ok: false,
    reason: `${teamId} cannot match $${incomingSalary.toFixed(3)}M incoming against $${outgoingSalary.toFixed(3)}M outgoing`,
  };
}

/** Analyze both sides of a proposal without mutating the world. */
export function analyzeTradeMatching(
  world: RosterWorld,
  proposal: TradeProposal,
): { teamA: TradeMatchingAnalysis; teamB: TradeMatchingAnalysis } {
  const idsFromA = playerIdsOf(proposal.assetsFromA);
  const idsFromB = playerIdsOf(proposal.assetsFromB);
  return {
    teamA: analyzeTradeMatchingForTeam(world, proposal.teamA, idsFromA, idsFromB),
    teamB: analyzeTradeMatchingForTeam(world, proposal.teamB, idsFromB, idsFromA),
  };
}

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

/** Classify independent accounting bases from the highest threshold downward. */
export function classifyCapStatus(inputs: CapStatusInputs): CapStatus {
  if (inputs.apronPayroll >= SECOND_APRON) return 'over_second_apron';
  if (inputs.apronPayroll >= FIRST_APRON) return 'over_first_apron';
  if (inputs.taxPayroll >= LUXURY_TAX_LINE) return 'over_tax';
  if (inputs.capRoomSalary >= SALARY_CAP) return 'over_cap';
  return 'under_cap';
}

export function getTeamCapStatus(world: RosterWorld, teamId: string): CapStatus {
  return classifyCapStatus({
    capRoomSalary: computeCapRoomSalary(world, teamId),
    taxPayroll: computeTaxPayroll(world, teamId),
    apronPayroll: computeApronPayroll(world, teamId),
  });
}

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

/** Compute each primitive once and return the complete Phase 3 financial view. */
export function getTeamFinancialSummary(
  world: RosterWorld,
  teamId: string,
): TeamFinancialSummary {
  const players = getRosterPlayersOrThrow(world, teamId);
  const payroll = payrollFromPlayers(players);
  const capHolds = capHoldsForKnownTeam(world, teamId);
  const incompleteRosterCharge = incompleteRosterChargeFromPlayers(players);
  const capRoomSalary = payroll + capHolds + incompleteRosterCharge;
  const capRoom = SALARY_CAP - capRoomSalary;
  const taxPayroll = payroll;
  const apronPayroll = payroll;
  const capStatus = classifyCapStatus({ capRoomSalary, taxPayroll, apronPayroll });

  return {
    teamId,
    rulesYear: CAP_RULES_YEAR,
    payroll,
    capHolds,
    incompleteRosterCharge,
    capRoomSalary,
    capRoom,
    taxPayroll,
    apronPayroll,
    capStatus,
    belowSalaryFloor: payroll < MINIMUM_TEAM_SALARY,
  };
}

/** Preserve canonical team order in the league-wide view. */
export function getLeagueFinancialSummary(world: RosterWorld): TeamFinancialSummary[] {
  return world.teams.map((team) => getTeamFinancialSummary(world, team.id));
}
