/** Read-only loader and structural validator for an alternate simulation pool. */
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';

export interface LeaguePool { directory: string; teams: Team[]; players: Player[]; alternate: boolean }

function parseLeagueDir(argv: readonly string[]): string | undefined {
  let leagueDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--league-dir') {
      if (!argv[i + 1] || leagueDir) throw new Error('Usage: --league-dir <directory> (exactly once)');
      leagueDir = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return leagueDir;
}

function validatePool(teams: Team[], players: Player[], directory: string): void {
  if (!Array.isArray(teams) || teams.length !== 30) throw new Error(`Invalid league directory ${directory}: teams.json must contain exactly 30 teams`);
  if (!Array.isArray(players)) throw new Error(`Invalid league directory ${directory}: players.json must contain an array`);
  const ids = new Set(players.map((player) => player?.id).filter((id): id is string => typeof id === 'string'));
  if (ids.size !== players.length) throw new Error(`Invalid league directory ${directory}: players.json has duplicate or missing player ids`);
  const teamIds = new Set(teams.map((team) => team?.id).filter((id): id is string => typeof id === 'string'));
  if (teamIds.size !== 30) throw new Error(`Invalid league directory ${directory}: teams.json has duplicate or missing team ids`);
  for (const team of teams) {
    if (!Array.isArray(team.roster) || !team.rotation || !Array.isArray(team.rotation.starters) || !Array.isArray(team.rotation.rotationOrder)) {
      throw new Error(`Invalid league directory ${directory}: team ${team?.id ?? '<unknown>'} lacks roster/rotation`);
    }
    if (team.roster.length < 5 || team.rotation.starters.length !== 5) throw new Error(`Invalid league directory ${directory}: team ${team.id} lacks a playable rotation`);
    for (const id of [...team.roster, ...team.rotation.starters, ...team.rotation.rotationOrder]) {
      if (!ids.has(id)) throw new Error(`Invalid league directory ${directory}: team ${team.id} references missing player ${id}`);
    }
  }
}

export async function loadLeaguePool(argv: readonly string[]): Promise<LeaguePool> {
  const requested = parseLeagueDir(argv);
  const directory = requested ? path.resolve(process.cwd(), requested) : path.join(process.cwd(), 'data');
  const teamsPath = path.join(directory, 'teams.json');
  const playersPath = path.join(directory, 'players.json');
  if (!existsSync(teamsPath) || !existsSync(playersPath)) {
    throw new Error(`Invalid league directory ${directory}: expected readable teams.json and players.json`);
  }
  let teams: Team[];
  let players: Player[];
  try {
    [teams, players] = await Promise.all([
      readFile(teamsPath, 'utf-8').then((text) => JSON.parse(text) as Team[]),
      readFile(playersPath, 'utf-8').then((text) => JSON.parse(text) as Player[]),
    ]);
  } catch (error) {
    throw new Error(`Invalid league directory ${directory}: unable to parse pool JSON (${(error as Error).message})`);
  }
  if (requested) validatePool(teams, players, directory);
  return { directory, teams, players, alternate: Boolean(requested) };
}
