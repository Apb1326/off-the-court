import { Team } from '@/models/team';
import { ContractType, Player } from '@/models/player';
import { SeasonState } from '@/models/season';

/**
 * The mutable slice of game state the transaction layer reads and rewrites: rosters live on
 * `teams`, player identity/`teamId` on `players`, and the free-agent pool + transaction log
 * on `season`. A `SaveFile` structurally satisfies this, so callers can pass one directly;
 * the layer stays decoupled from save metadata (schemaVersion, timestamps, phase).
 *
 * The gate treats this as immutable: operations never mutate a `RosterWorld` in place — they
 * return a new one on success (see gate.ts).
 */
export interface RosterWorld {
  teams: Team[];
  players: Player[];
  season: SeasonState;
}

export function getTeam(world: RosterWorld, teamId: string): Team | undefined {
  return world.teams.find((t) => t.id === teamId);
}

export function getPlayer(world: RosterWorld, playerId: string): Player | undefined {
  return world.players.find((p) => p.id === playerId);
}

/** Two-way contracts occupy a roster record but not a standard-roster slot. */
export function isStandardContractType(type: ContractType): boolean {
  return type !== 'two_way';
}

export function isStandardContractPlayer(player: Player): boolean {
  return isStandardContractType(player.contract.type);
}

function countStandardPlayerIds(world: RosterWorld, playerIds: string[]): number {
  return playerIds.reduce((count, playerId) => {
    const player = getPlayer(world, playerId);
    if (!player) {
      throw new Error(`cannot count standard roster: missing player "${playerId}"`);
    }
    return count + (isStandardContractPlayer(player) ? 1 : 0);
  }, 0);
}

/** Derived standard-contract roster count; never cached or inferred from total length. */
export function standardRosterCount(world: RosterWorld, teamId: string): number {
  const team = getTeam(world, teamId);
  if (!team) throw new Error(`cannot count standard roster: team "${teamId}" does not exist`);
  return countStandardPlayerIds(world, team.roster);
}

/** Project a standard-roster count across a proposed move. Two-way players net zero. */
export function projectStandardRosterCount(
  world: RosterWorld,
  teamId: string,
  outgoingPlayerIds: string[],
  incomingPlayerIds: string[],
): number {
  return (
    standardRosterCount(world, teamId) -
    countStandardPlayerIds(world, outgoingPlayerIds) +
    countStandardPlayerIds(world, incomingPlayerIds)
  );
}

/** Signing projects the desired deal that will be instantiated, not the prior contract. */
export function projectStandardRosterCountForSigning(
  world: RosterWorld,
  teamId: string,
  playerId: string,
): number {
  const player = getPlayer(world, playerId);
  if (!player) throw new Error(`cannot project signing: missing player "${playerId}"`);
  if (!player.desiredContract) {
    throw new Error(`cannot project signing: player "${playerId}" has no desired contract`);
  }
  return standardRosterCount(world, teamId) +
    (isStandardContractType(player.desiredContract.type) ? 1 : 0);
}
