import { Team } from '@/models/team';
import { Player } from '@/models/player';
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

/**
 * Roster size is always computed from the roster array — never cached as a separate field.
 * (AGENTS.md: don't store a derived value as an independent source of truth.)
 */
export function rosterSize(team: Team): number {
  return team.roster.length;
}
