/**
 * Structural invariants for a league pool (teams.json + players.json pair).
 *
 * This is the single validator shared by every surface that touches the pool:
 * the activation-context gate (`scripts/s2d-activation-context.ts`, consumed
 * by profile and calibrate), the builder's promotion gate
 * (`scripts/build-league.ts`, which layers roster-size bounds on top), and
 * the app's new-game snapshot path (`src/app/api/season/route.ts`).
 * Keep additions here so the promotion and load gates cannot drift apart —
 * a pair that promotes must load, and vice versa.
 */
import { Player } from '@/models/player';
import { Team } from '@/models/team';

/** Throws with a `source`-prefixed reason on the first violated invariant. */
export function validatePool(teams: Team[], players: Player[], source: string): void {
  if (!Array.isArray(teams) || teams.length !== 30) throw new Error(`Invalid league pool ${source}: teams.json must contain exactly 30 teams`);
  if (!Array.isArray(players)) throw new Error(`Invalid league pool ${source}: players.json must contain an array`);
  const byId = new Map(players.map((player) => [player?.id, player]).filter((entry): entry is [string, Player] => typeof entry[0] === 'string'));
  const ids = new Set(byId.keys());
  if (ids.size !== players.length) throw new Error(`Invalid league pool ${source}: players.json has duplicate or missing player ids`);
  const teamIds = new Set(teams.map((team) => team?.id).filter((id): id is string => typeof id === 'string'));
  if (teamIds.size !== 30) throw new Error(`Invalid league pool ${source}: teams.json has duplicate or missing team ids`);
  const rosterOwners = new Map<string, string>();
  for (const team of teams) {
    if (!Array.isArray(team.roster) || !team.rotation || typeof team.rotation !== 'object'
      || !Array.isArray(team.rotation.starters) || !Array.isArray(team.rotation.rotationOrder)
      || !team.rotation.minuteTargets || typeof team.rotation.minuteTargets !== 'object'
      || Array.isArray(team.rotation.minuteTargets)) {
      throw new Error(`Invalid league pool ${source}: team ${team?.id ?? '<unknown>'} lacks roster/rotation`);
    }
    if (team.roster.length < 5 || team.rotation.starters.length !== 5) throw new Error(`Invalid league pool ${source}: team ${team.id} lacks a playable rotation`);
    if (new Set(team.roster).size !== team.roster.length) throw new Error(`Invalid league pool ${source}: team ${team.id} has duplicate roster ids`);
    if (new Set(team.rotation.starters).size !== team.rotation.starters.length) throw new Error(`Invalid league pool ${source}: team ${team.id} has duplicate starters`);
    if (new Set(team.rotation.rotationOrder).size !== team.rotation.rotationOrder.length) throw new Error(`Invalid league pool ${source}: team ${team.id} has duplicate rotation ids`);
    if (team.rotation.rotationOrder.some((id) => team.rotation.starters.includes(id))) {
      throw new Error(`Invalid league pool ${source}: team ${team.id} has a player in both starters and rotationOrder`);
    }
    const rotationIds = new Set([...team.rotation.starters, ...team.rotation.rotationOrder]);
    if (rotationIds.size !== team.roster.length || team.roster.some((id) => !rotationIds.has(id))) {
      throw new Error(`Invalid league pool ${source}: team ${team.id} rotation must cover every roster player exactly once`);
    }
    for (const id of team.roster) {
      if (!ids.has(id)) throw new Error(`Invalid league pool ${source}: team ${team.id} references missing player ${id}`);
      if (rosterOwners.has(id)) throw new Error(`Invalid league pool ${source}: player ${id} appears on both ${rosterOwners.get(id)} and ${team.id}`);
      if (byId.get(id)!.teamId !== team.id) throw new Error(`Invalid league pool ${source}: rostered player ${id} has teamId ${byId.get(id)!.teamId}, expected ${team.id}`);
      rosterOwners.set(id, team.id);
    }
    for (const id of [...team.rotation.starters, ...team.rotation.rotationOrder]) {
      if (!team.roster.includes(id)) throw new Error(`Invalid league pool ${source}: team ${team.id} rotation references non-roster player ${id}`);
    }
    const minuteTargetIds = Object.keys(team.rotation.minuteTargets);
    if (minuteTargetIds.length !== team.roster.length || minuteTargetIds.some((id) => !rotationIds.has(id))) {
      throw new Error(`Invalid league pool ${source}: team ${team.id} minuteTargets must cover every rotation player exactly once`);
    }
    for (const id of rotationIds) {
      const minutes = team.rotation.minuteTargets[id];
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 48) {
        throw new Error(`Invalid league pool ${source}: team ${team.id} minuteTarget for ${id} must be a finite value in (0, 48]`);
      }
    }
  }
  for (const player of players) {
    if (player.teamId && !teamIds.has(player.teamId)) {
      throw new Error(`Invalid league pool ${source}: player ${player.id} has unknown teamId ${player.teamId}`);
    }
    if (player.teamId && !rosterOwners.has(player.id)) {
      throw new Error(`Invalid league pool ${source}: rostered player ${player.id} is absent from ${player.teamId}'s roster`);
    }
    if (!player.teamId && rosterOwners.has(player.id)) {
      throw new Error(`Invalid league pool ${source}: unassigned player ${player.id} appears on roster ${rosterOwners.get(player.id)}`);
    }
  }
}
