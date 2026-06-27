import { RosterWorld, getTeam, getPlayer } from './world';
import { ROSTER_MIN, ROSTER_MAX } from './constants';

/**
 * Roster-legality validators for the transaction gate.
 *
 * Each validator is an independent predicate returning a unified `ValidationResult` — never
 * a nested conditional. The gate composes them with `runValidators`, which returns the first
 * failure (with its reason) or success. Phase 1 is roster-legality only; later phases add
 * cap-, apron-, and temporal-legality predicate sets composed the same way.
 */

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export const VALID: ValidationResult = { ok: true };

export function invalid(reason: string): ValidationResult {
  return { ok: false, reason };
}

/**
 * Run independent predicates in order; return the first failure or `VALID`. Predicates are
 * supplied as thunks so the gate can build the list (including per-player checks) declaratively.
 */
export function runValidators(checks: Array<() => ValidationResult>): ValidationResult {
  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }
  return VALID;
}

// --- individual predicates ---

export function teamExists(world: RosterWorld, teamId: string): ValidationResult {
  return getTeam(world, teamId) ? VALID : invalid(`team "${teamId}" does not exist`);
}

export function playerExists(world: RosterWorld, playerId: string): ValidationResult {
  return getPlayer(world, playerId) ? VALID : invalid(`player "${playerId}" does not exist`);
}

export function teamsDistinct(teamA: string, teamB: string): ValidationResult {
  return teamA !== teamB
    ? VALID
    : invalid(`a trade needs two different teams (both sides were "${teamA}")`);
}

export function playerOnRoster(
  world: RosterWorld,
  teamId: string,
  playerId: string,
): ValidationResult {
  const team = getTeam(world, teamId);
  if (!team) return invalid(`team "${teamId}" does not exist`);
  return team.roster.includes(playerId)
    ? VALID
    : invalid(`player "${playerId}" is not on ${teamId}'s roster`);
}

export function playerInFreeAgentPool(world: RosterWorld, playerId: string): ValidationResult {
  return world.season.freeAgentPool.includes(playerId)
    ? VALID
    : invalid(`player "${playerId}" is not in the free-agent pool`);
}

/** No player id may appear more than once across the assets/ids being moved. */
export function noDuplicatePlayers(playerIds: string[]): ValidationResult {
  const seen = new Set<string>();
  for (const id of playerIds) {
    if (seen.has(id)) return invalid(`player "${id}" appears more than once in the transaction`);
    seen.add(id);
  }
  return VALID;
}

/**
 * The resulting roster size must stay within the standard bounds. Checks the ceiling and the
 * floor independently so the failure reason names the right limit.
 */
export function rosterWithinBounds(teamId: string, projectedSize: number): ValidationResult {
  if (projectedSize > ROSTER_MAX) {
    return invalid(
      `${teamId} would carry ${projectedSize} players, over the ${ROSTER_MAX}-man roster limit`,
    );
  }
  if (projectedSize < ROSTER_MIN) {
    return invalid(
      `${teamId} would carry ${projectedSize} players, under the ${ROSTER_MIN}-man roster minimum`,
    );
  }
  return VALID;
}
