/**
 * Read layer for the normalized NBA data contracts in data/nba/normalized/.
 *
 * This is the only sanctioned way for TypeScript to consume pipeline output.
 * TypeScript never calls stats.nba.com — the Python pipeline (pipeline/)
 * harvests and normalizes offline; this module just reads files.
 *
 * No consumers yet: later stages build on this.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import {
  BoxAdvancedRow,
  CrosswalkFile,
  DefenseRow,
  GameRow,
  HustleRow,
  LineupRow,
  NBA_DATA_SCHEMA_VERSION,
  NbaDataManifest,
  NbaPlayerRow,
  PbpGameFile,
  PlayTypeRow,
  SeasonEnvelope,
  ShotEventRow,
  ShotZonesRow,
  TrackingRow,
} from './types';

export const NBA_NORMALIZED_DIR = path.join(process.cwd(), 'data', 'nba', 'normalized');

/**
 * Read and parse a normalized JSON file, transparently handling the
 * .json.gz variant the normalizer emits for files over 50 MB.
 */
function readNormalizedFile(relPath: string): unknown {
  const plain = path.join(NBA_NORMALIZED_DIR, relPath);
  const gzipped = `${plain}.gz`;
  let text: string;
  if (fs.existsSync(plain)) {
    text = fs.readFileSync(plain, 'utf-8');
  } else if (fs.existsSync(gzipped)) {
    text = zlib.gunzipSync(fs.readFileSync(gzipped)).toString('utf-8');
  } else {
    throw new Error(
      `Normalized NBA data file not found: ${plain} (nor .gz). ` +
        `Run the pipeline (pipeline/README.md) to harvest and normalize it.`
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${relPath}: ${(err as Error).message}`);
  }
}

/** True if the contract file (plain or gzipped) exists. */
export function hasNormalizedFile(relPath: string): boolean {
  const plain = path.join(NBA_NORMALIZED_DIR, relPath);
  return fs.existsSync(plain) || fs.existsSync(`${plain}.gz`);
}

function assertEnvelope(obj: unknown, relPath: string): void {
  const env = obj as { schema_version?: unknown; rows?: unknown };
  if (env === null || typeof env !== 'object') {
    throw new Error(`${relPath}: expected an object envelope`);
  }
  if (env.schema_version !== NBA_DATA_SCHEMA_VERSION) {
    throw new Error(
      `${relPath}: schema_version ${String(env.schema_version)} != expected ${NBA_DATA_SCHEMA_VERSION}`
    );
  }
  if (!Array.isArray(env.rows)) {
    throw new Error(`${relPath}: missing rows array`);
  }
}

function loadSeasonContract<Row>(contract: string, season: string): SeasonEnvelope<Row> {
  const relPath = `${contract}/${season}.json`;
  const obj = readNormalizedFile(relPath);
  assertEnvelope(obj, relPath);
  return obj as SeasonEnvelope<Row>;
}

export function loadPlayers(season: string): SeasonEnvelope<NbaPlayerRow> {
  return loadSeasonContract<NbaPlayerRow>('players', season);
}

export function loadBoxAdvanced(season: string): SeasonEnvelope<BoxAdvancedRow> {
  return loadSeasonContract<BoxAdvancedRow>('box_advanced', season);
}

export function loadShotZones(season: string): SeasonEnvelope<ShotZonesRow> {
  return loadSeasonContract<ShotZonesRow>('shot_zones', season);
}

export function loadShotEvents(season: string): SeasonEnvelope<ShotEventRow> {
  return loadSeasonContract<ShotEventRow>('shot_events', season);
}

export function loadPlayTypes(season: string): SeasonEnvelope<PlayTypeRow> {
  return loadSeasonContract<PlayTypeRow>('playtypes', season);
}

export function loadTracking(season: string): SeasonEnvelope<TrackingRow> {
  return loadSeasonContract<TrackingRow>('tracking', season);
}

export function loadDefense(season: string): SeasonEnvelope<DefenseRow> {
  return loadSeasonContract<DefenseRow>('defense', season);
}

export function loadHustle(season: string): SeasonEnvelope<HustleRow> {
  return loadSeasonContract<HustleRow>('hustle', season);
}

export function loadLineups(season: string): SeasonEnvelope<LineupRow> {
  return loadSeasonContract<LineupRow>('lineups', season);
}

export function loadGames(season: string): SeasonEnvelope<GameRow> {
  return loadSeasonContract<GameRow>('games', season);
}

export function loadPbpGame(season: string, gameId: string): PbpGameFile {
  const relPath = `pbp/${season}/${gameId}.json`;
  const obj = readNormalizedFile(relPath);
  assertEnvelope(obj, relPath);
  return obj as PbpGameFile;
}

/** Game ids with a normalized play-by-play file for the season. */
export function listPbpGameIds(season: string): string[] {
  const dir = path.join(NBA_NORMALIZED_DIR, 'pbp', season);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') || f.endsWith('.json.gz'))
    .map((f) => f.replace(/\.json(\.gz)?$/, ''))
    .sort();
}

export function loadCrosswalk(): CrosswalkFile {
  const relPath = 'crosswalk.json';
  const obj = readNormalizedFile(relPath) as CrosswalkFile;
  if (obj.schema_version !== NBA_DATA_SCHEMA_VERSION) {
    throw new Error(
      `${relPath}: schema_version ${String(obj.schema_version)} != expected ${NBA_DATA_SCHEMA_VERSION}`
    );
  }
  if (!Array.isArray(obj.rows) || !Array.isArray(obj.unmatched)) {
    throw new Error(`${relPath}: missing rows/unmatched arrays`);
  }
  return obj;
}

export function loadManifest(): NbaDataManifest {
  const obj = readNormalizedFile('manifest.json') as NbaDataManifest;
  if (obj.schema_version !== NBA_DATA_SCHEMA_VERSION) {
    throw new Error(
      `manifest.json: schema_version ${String(obj.schema_version)} != expected ${NBA_DATA_SCHEMA_VERSION}`
    );
  }
  return obj;
}

/** Seasons for which a given contract has normalized files on disk. */
export function listSeasons(contract: string): string[] {
  const dir = path.join(NBA_NORMALIZED_DIR, contract);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') || f.endsWith('.json.gz'))
    .map((f) => f.replace(/\.json(\.gz)?$/, ''))
    .sort();
}
