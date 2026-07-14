/**
 * Runtime proof for the promoted NBA-derived production pool.
 *
 * The builder owns the manifest write; runtime only reads the exact pair once,
 * validates its structure and NBA identity, then proves those bytes match the
 * promotion manifest and the sole production selector/table identities.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as constants from '@/engine/constants';
import * as playTypes from '@/engine/play-types';
import { Player } from '@/models/player';
import { Team } from '@/models/team';
import { validatePool } from './pool-validation';

export interface ProductionPool {
  directory: string;
  teams: Team[];
  players: Player[];
  teamsSha256: string;
  playersSha256: string;
  selectorId: string;
  shotZoneTableId: string;
}

interface LeagueManifest {
  version?: number;
  teamsSha256?: string;
  playersSha256?: string;
  selectorId?: string;
  shotZoneTableId?: string;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertProductionInterfaces(): { selectorId: string; shotZoneTableId: string } {
  const tableExports = Object.keys(constants).filter((key) => /^PLAY_TYPE_SHOT_ZONES(?:_|$)/.test(key));
  if (tableExports.length !== 1 || tableExports[0] !== constants.PRODUCTION_SHOT_ZONE_TABLE_ID) {
    throw new Error(`S2d context failed: expected one production shot-zone table (${constants.PRODUCTION_SHOT_ZONE_TABLE_ID}), found ${tableExports.join(', ') || 'none'}`);
  }
  if ('LEGACY_PLAY_TYPE_SELECTION' in playTypes || 'CANDIDATE_PLAY_TYPE_SELECTION' in playTypes) {
    throw new Error('S2d context failed: legacy or candidate selector remains reachable');
  }
  return {
    selectorId: playTypes.PRODUCTION_PLAY_TYPE_SELECTOR_ID,
    shotZoneTableId: constants.PRODUCTION_SHOT_ZONE_TABLE_ID,
  };
}

export function assertNbaDerivedPoolIdentity(teams: Team[], players: Player[], source: string): void {
  if (!teams.every((team) => /^nba_team_\d+$/.test(team.id))) {
    throw new Error(`Invalid league pool ${source}: teams must use the NBA-derived nba_team_<teamId> identity scheme`);
  }
  if (!players.every((player) => /^nba_\d+$/.test(player.id))) {
    throw new Error(`Invalid league pool ${source}: players must use the NBA-derived nba_<personId> identity scheme`);
  }
}

function verifyManifest(
  directory: string,
  teamsSha256: string,
  playersSha256: string,
  identities: { selectorId: string; shotZoneTableId: string },
): void {
  const manifestPath = path.join(directory, '.league-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`S2d context failed: promotion manifest ${manifestPath} is missing; run \`npm run build-league\` to promote and record it`);
  }
  let manifest: LeagueManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LeagueManifest;
  } catch (error) {
    throw new Error(`S2d context failed: promotion manifest is unreadable (${(error as Error).message}); re-run \`npm run build-league\``);
  }
  if (manifest.version !== 1) {
    throw new Error(`S2d context failed: promotion manifest has unsupported version ${String(manifest.version)}; re-run \`npm run build-league\``);
  }
  if (manifest.teamsSha256 !== teamsSha256 || manifest.playersSha256 !== playersSha256) {
    throw new Error('S2d context failed: active pair does not hash-match the promotion manifest — data/ was modified outside the builder; re-run `npm run build-league`');
  }
  if (manifest.selectorId !== identities.selectorId || manifest.shotZoneTableId !== identities.shotZoneTableId) {
    throw new Error(`S2d context failed: engine production identities (${identities.selectorId}, ${identities.shotZoneTableId}) differ from the promoted ones (${manifest.selectorId}, ${manifest.shotZoneTableId}); re-run \`npm run build-league\``);
  }
}

/** Read and validate the exact active bytes a new game will snapshot. */
export function loadProductionPool(directory: string): ProductionPool {
  const teamsPath = path.join(directory, 'teams.json');
  const playersPath = path.join(directory, 'players.json');
  if (!existsSync(teamsPath) || !existsSync(playersPath)) {
    throw new Error('S2d context failed: active data/teams.json and data/players.json must both exist');
  }
  const teamsBytes = readFileSync(teamsPath);
  const playersBytes = readFileSync(playersPath);
  let teams: Team[];
  let players: Player[];
  try {
    teams = JSON.parse(teamsBytes.toString('utf8')) as Team[];
    players = JSON.parse(playersBytes.toString('utf8')) as Player[];
  } catch (error) {
    throw new Error(`S2d context failed: unable to parse pool JSON (${(error as Error).message})`);
  }
  validatePool(teams, players, directory);
  assertNbaDerivedPoolIdentity(teams, players, directory);
  const identities = assertProductionInterfaces();
  const teamsSha256 = sha256(teamsBytes);
  const playersSha256 = sha256(playersBytes);
  verifyManifest(directory, teamsSha256, playersSha256, identities);
  return { directory, teams, players, teamsSha256, playersSha256, ...identities };
}
