/**
 * Pure, compute-only salary-cap analytics (transactions Phase 3).
 *
 * Nothing in this module is persisted, so Phase 3 needs no schema bump. Cap-room
 * salary and tax/apron payroll deliberately use separate accounting bases. The
 * latest cut in the transaction log acts as a temporary rights-owner proxy until
 * Phase 4 introduces explicit Bird/Early-Bird/Non-Bird rights.
 */

import { Player } from '@/models/player';
import { CutEntry, SignEntry } from '@/models/transaction';
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
} from './constants';
import { currentSalary } from './contracts';
import { getPlayer, getTeam, isStandardContractPlayer, RosterWorld } from './world';

type RelevantFreeAgentEntry = SignEntry | CutEntry;

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

function capHoldsForKnownTeam(world: RosterWorld, teamId: string): number {
  const currentFreeAgents = new Set(world.season.freeAgentPool);
  const latestRelevantEntry = new Map<string, RelevantFreeAgentEntry>();

  for (const entry of world.season.transactionLog) {
    if (
      (entry.type === 'sign' || entry.type === 'cut') &&
      currentFreeAgents.has(entry.playerId)
    ) {
      latestRelevantEntry.set(entry.playerId, entry);
    }
  }

  // Sorting makes the floating-point reduction independent of FA-pool ordering.
  return [...currentFreeAgents]
    .sort()
    .reduce((total, playerId) => {
      const entry = latestRelevantEntry.get(playerId);
      if (
        entry?.type !== 'cut' ||
        entry.fromTeamId !== teamId ||
        entry.contractAtCut === undefined
      ) {
        return total;
      }

      const hold = Math.max(
        currentSalary(entry.contractAtCut) * CAP_HOLD_PERCENTAGE,
        ROOKIE_MINIMUM_SALARY,
      );
      return total + hold;
    }, 0);
}

/** Current standard-contract payroll, excluding two-way contracts. */
export function computeTeamPayroll(world: RosterWorld, teamId: string): number {
  return payrollFromPlayers(getRosterPlayersOrThrow(world, teamId));
}

/**
 * Temporary free-agent holds attributed by each current FA's latest sign/cut event.
 * Seeded FAs and legacy cuts without a contract snapshot create no hold.
 */
export function computeCapHolds(world: RosterWorld, teamId: string): number {
  getTeamOrThrow(world, teamId);
  return capHoldsForKnownTeam(world, teamId);
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
