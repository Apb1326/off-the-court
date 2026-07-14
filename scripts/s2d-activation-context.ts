/**
 * S2d activation-context proof. Read-only: it never generates, promotes, or
 * rewrites the active pool. Profile and calibrate import this check before
 * simulating so a numerical result cannot be separated from its
 * pool/selector/table context.
 *
 * The integrity anchor is the promotion manifest (`data/.league-manifest.json`),
 * written atomically by `scripts/build-league.ts` as the last step of a
 * promotion: the active pair must hash-match it and the engine's production
 * selector/table identities must equal the promoted ones. Deep builder
 * byte-identity (rebuilding from data/nba/normalized/) intentionally stays in
 * `build-league --check` / the S2d harness — it needs the harvest artifacts
 * and a full derivation, which a profile run should not require.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as constants from '../src/engine/constants';
import * as playTypes from '../src/engine/play-types';
import { validatePool } from '../src/lib/pool-validation';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';

export interface ActivationContext {
  directory: string;
  teams: Team[];
  players: Player[];
  teamsSha256: string;
  playersSha256: string;
  representativePlayerIds: string[];
  manifestCheck: 'verified';
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

function assertProductionInterfaces(): { selectorId: string; shotZoneTableId: string } {
  // Exactly one shot-zone table may be exported, and it must be the named
  // production table. (This regex-over-exports check is deliberately narrow:
  // the deletion of the legacy/candidate symbols plus typecheck is the real
  // guarantee; this assertion just keeps a reintroduced sibling table from
  // going unnoticed by the gated runs.)
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

function verifyManifest(directory: string, teamsSha256: string, playersSha256: string, identities: { selectorId: string; shotZoneTableId: string }): void {
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
  if (manifest.teamsSha256 !== teamsSha256 || manifest.playersSha256 !== playersSha256) {
    throw new Error('S2d context failed: active pair does not hash-match the promotion manifest — data/ was modified outside the builder; re-run `npm run build-league`');
  }
  if (manifest.selectorId !== identities.selectorId || manifest.shotZoneTableId !== identities.shotZoneTableId) {
    throw new Error(`S2d context failed: engine production identities (${identities.selectorId}, ${identities.shotZoneTableId}) differ from the promoted ones (${manifest.selectorId}, ${manifest.shotZoneTableId}); re-run \`npm run build-league\``);
  }
}

export async function loadActivationContext(): Promise<ActivationContext> {
  const directory = path.join(process.cwd(), 'data');
  const teamsPath = path.join(directory, 'teams.json');
  const playersPath = path.join(directory, 'players.json');
  if (!existsSync(teamsPath) || !existsSync(playersPath)) {
    throw new Error('S2d context failed: active data/teams.json and data/players.json must both exist');
  }
  // Read each file exactly once and derive both the hash and the parsed pool
  // from the same bytes, so the banner provenance and the simulated pool
  // cannot diverge across reads.
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
  if (!teams.every((team) => /^nba_team_\d+$/.test(team.id))) {
    throw new Error('S2d context failed: active teams do not use the NBA-derived nba_team_<personId> identity scheme');
  }
  if (!players.every((player) => /^nba_\d+$/.test(player.id))) {
    throw new Error('S2d context failed: active players do not use the NBA-derived nba_<personId> identity scheme');
  }
  const identities = assertProductionInterfaces();
  const teamsSha256 = sha256(teamsBytes);
  const playersSha256 = sha256(playersBytes);
  verifyManifest(directory, teamsSha256, playersSha256, identities);
  return {
    directory,
    teams,
    players,
    teamsSha256,
    playersSha256,
    representativePlayerIds: players.map((player) => player.id).sort().slice(0, 6),
    manifestCheck: 'verified',
    ...identities,
  };
}

export function printActivationContextBanner(context: ActivationContext): void {
  console.log('S2D ACTIVATION CONTEXT — VERIFIED');
  console.log(`pool=${context.directory}`);
  console.log(`teams.sha256=${context.teamsSha256} players.sha256=${context.playersSha256}`);
  console.log(`teams=${context.teams.length} players=${context.players.length}`);
  console.log(`representative-player-ids=${context.representativePlayerIds.join(',')}`);
  console.log(`selector=${context.selectorId} shot-zone-table=${context.shotZoneTableId}`);
  console.log(`manifest=${context.manifestCheck}`);
  console.log('');
}

async function main(): Promise<void> {
  const context = await loadActivationContext();
  printActivationContextBanner(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
