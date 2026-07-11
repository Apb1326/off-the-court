/**
 * S2a — Deterministic league builder.
 *
 * Emits a *candidate* league artifact (teams + players, same shapes as the
 * active data/teams.json / data/players.json) keyed on NBA personIds, built as
 * a pure function of the normalized NBA data in data/nba/normalized/. It writes
 * a companion coverage/fallback report. NOTHING in the app or engine reads the
 * output directory in this unit — this runs alongside, never replacing, the
 * active pool.
 *
 * Invocation (mirrors scripts/derive-league-targets.ts):
 *   npm run build-league            -> write the two candidate JSONs + report, print provenance
 *   npm run build-league -- --check -> rebuild in memory, byte-compare candidate + both reports, exit non-zero on any diff
 *
 * Determinism: no Math.random, no Date.now, no timestamps in output; sorted
 * iteration everywhere; fixed float formatting; objects built with a fixed key
 * order so re-runs are byte-idempotent. One-shot per-player generation
 * (contracts) descends from SeededRNG(fnv1a(player.id)) inside the shared
 * transaction-layer helpers — this file introduces no randomness of its own.
 *
 * S2b derives ratings from normalized contracts and recomputes potential from
 * those ratings. Tendencies remain the S2a legacy placeholders until S2c.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Player, Position, PerGameStats, SeasonStats } from '../src/models/player';
import { Team, OffensiveSystem, DefensiveSystem, NBA_TEAMS } from '../src/models/team';
import { deriveRatings, deriveTendencies, derivePotential } from '../src/ratings/derivation';
import {
  deriveNbaRatings,
  NbaDerivationInput,
  NbaDerivationPlayer,
  RECENT_SEASONS,
  renderRatingsContract,
  ShotEventSeasonAggregate,
} from '../src/ratings/nba-derivation';
import { generateContractForPlayer, normalizePlayersForSave } from '../src/transactions/contracts';
import { FREE_AGENT_TEAM_ID, ROSTER_MIN, ROSTER_MAX } from '../src/transactions/constants';
import { setupRotation } from '../src/lib/rotation';
import {
  loadPlayers,
  loadBoxAdvanced,
  loadManifest,
  listSeasons,
  hasNormalizedFile,
  loadPlayTypes,
  loadTracking,
  loadDefense,
  loadHustle,
  loadShotEvents,
  loadShotZones,
} from '../src/data/nba/load';
import { BoxAdvancedRow, NbaPlayerRow, ShotEventRow } from '../src/data/nba/types';
import { deriveNbaTendencies } from '../src/ratings/nba-tendencies';

// --- Fixed build policy (annotated constants; no magic numbers) ---

/** The most-recent fully harvested season; the season this candidate models. */
const BUILD_SEASON = '2025-26';
/** Start year of BUILD_SEASON; experience = max(0, this - fromYear). */
const BUILD_SEASON_START_YEAR = 2025;
/** Candidate output dir. NOTHING in the app/engine reads this in S2a. */
const CANDIDATE_DIR = path.join(process.cwd(), 'data', 'league-candidate');
const TEAMS_PATH = path.join(CANDIDATE_DIR, 'teams.json');
const PLAYERS_PATH = path.join(CANDIDATE_DIR, 'players.json');
/** Committed coverage report (docs/ is not gitignored; data/ is). */
const COVERAGE_PATH = path.join(process.cwd(), 'docs', 'S2A_LEAGUE_COVERAGE.md');
/** S2b's generated statistical contract. */
const RATINGS_CONTRACT_PATH = path.join(process.cwd(), 'docs', 'S2B_RATINGS_CONTRACT.md');
const TENDENCIES_CONTRACT_PATH = path.join(process.cwd(), 'docs', 'S2C1_TENDENCIES_CONTRACT.md');

/** Unit conversions from normalized (cm/kg) to the Player model (inches/lbs). */
const CM_PER_INCH = 2.54;
const KG_TO_LB = 2.2046226218;

/** Fixed decimal places for mapped per-game stats (keeps the artifact clean/stable). */
const STAT_DP = 3;
/** Rotation-level slice for coverage reporting: top-N per team by gp*mpg. */
const ROTATION_LEVEL_TOP_N = 9;
/** scoutingAccuracy matches the BDL path (src/data/ingest/transforms.ts). */
const SCOUTING_ACCURACY = 0.5;
/** Documented last-resort age when both players.age and box age are null. */
const FALLBACK_AGE = 25;
/** Documented position fallback for missing/unrecognized NBA position strings. */
const FALLBACK_POSITION: Position = 'SF';

/**
 * NBA position string -> primary OTC Position. Explicit, no silent guesses.
 *   G -> PG, G-F -> SG, F-G -> SF, F -> SF, F-C -> PF, C-F -> PF, C -> C
 */
const PRIMARY_POSITION_MAP: Record<string, Position> = {
  G: 'PG',
  'G-F': 'SG',
  'F-G': 'SF',
  F: 'SF',
  'F-C': 'PF',
  'C-F': 'PF',
  C: 'C',
};
/** 2nd token of a hyphenated NBA position -> secondaryPosition. */
const SECONDARY_TOKEN_MAP: Record<string, Position> = { G: 'PG', F: 'SF', C: 'C' };

/**
 * Team offensive/defensive systems for the candidate: default placeholders that
 * mirror src/data/ingest/transforms.ts. Inlined (rather than imported) so the
 * BDL transform module stays byte-for-byte untouched in this unit.
 */
function candidateOffensiveSystem(): OffensiveSystem {
  return {
    pace: 100,
    threePointEmphasis: 0.5,
    transitionEmphasis: 0.5,
    postPlayEmphasis: 0.3,
    isolationEmphasis: 0.3,
    screeningEmphasis: 0.5,
  };
}
function candidateDefensiveSystem(): DefensiveSystem {
  return {
    scheme: 'man',
    intensity: 0.5,
    doubleTeamThreshold: 70,
    helpDefenseAggression: 0.5,
  };
}

// --- Stop-and-surface: halt before writing anything, report the conflict ---

class StopAndSurface extends Error {}
function stop(message: string): never {
  throw new StopAndSurface(message);
}

// --- Fallback logging ---

interface FallbackEntry {
  playerId: string;
  field: string;
  reason: string;
}

function roundTo(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

// --- Nullable-field policy (one table, applied everywhere; printed verbatim) ---

const NULLABLE_POLICY_TABLE = [
  '| Field kind | Policy |',
  '| --- | --- |',
  '| Counting stats (makes, attempts, reb, ast, stl, blk, tov, pf, pts) | `null` → `0` (logged per player/field) |',
  '| Percentage fields (fg%, 3p%, ft%) | recomputed from makes/attempts when both present and attempts > 0; else `0` with the underlying attempts `0` |',
  '| Minutes per game | `null` → `0` |',
].join('\n');

/**
 * Map a box_advanced perGame line onto the model's PerGameStats, applying the
 * nullable-field policy and logging every counting-stat fallback.
 */
function mapPerGameStats(
  row: BoxAdvancedRow,
  playerId: string,
  season: string,
  fallbacks: FallbackEntry[],
): PerGameStats {
  const pg = row.perGame;
  const count = (v: number | null | undefined, field: string): number => {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      fallbacks.push({ playerId, field: `careerStats[${season}].${field}`, reason: 'null counting stat → 0' });
      return 0;
    }
    return roundTo(v, STAT_DP);
  };
  // Recompute from RAW makes/attempts; the attempts fallback (if any) is logged by count().
  const pct = (made: number | null, att: number | null): number => {
    const a = att ?? 0;
    const m = made ?? 0;
    return Number.isFinite(a) && a > 0 && Number.isFinite(m) ? roundTo(m / a, STAT_DP) : 0;
  };

  return {
    points: count(pg.pts, 'points'),
    fieldGoalsMade: count(pg.fgm, 'fieldGoalsMade'),
    fieldGoalsAttempted: count(pg.fga, 'fieldGoalsAttempted'),
    fieldGoalPct: pct(pg.fgm, pg.fga),
    threePointersMade: count(pg.fg3m, 'threePointersMade'),
    threePointersAttempted: count(pg.fg3a, 'threePointersAttempted'),
    threePointPct: pct(pg.fg3m, pg.fg3a),
    freeThrowsMade: count(pg.ftm, 'freeThrowsMade'),
    freeThrowsAttempted: count(pg.fta, 'freeThrowsAttempted'),
    freeThrowPct: pct(pg.ftm, pg.fta),
    offensiveRebounds: count(pg.oreb, 'offensiveRebounds'),
    defensiveRebounds: count(pg.dreb, 'defensiveRebounds'),
    rebounds: count(pg.reb, 'rebounds'),
    assists: count(pg.ast, 'assists'),
    steals: count(pg.stl, 'steals'),
    blocks: count(pg.blk, 'blocks'),
    turnovers: count(pg.tov, 'turnovers'),
    personalFouls: count(pg.pf, 'personalFouls'),
  };
}

/** One SeasonStats row per box_advanced season. gamesStarted:0 + season-end team = documented structural fallbacks. */
function mapSeasonStats(
  row: BoxAdvancedRow,
  season: string,
  playerId: string,
  fallbacks: FallbackEntry[],
): SeasonStats {
  let teamId: string;
  if (row.teamId === null || row.teamId === undefined) {
    fallbacks.push({ playerId, field: `careerStats[${season}].teamId`, reason: 'null team → FREE_AGENT_TEAM_ID' });
    teamId = FREE_AGENT_TEAM_ID;
  } else {
    teamId = `nba_team_${row.teamId}`;
  }
  const gamesPlayed = row.gp === null || row.gp === undefined || !Number.isFinite(row.gp) ? 0 : row.gp;
  const minutesPerGame = row.mpg === null || row.mpg === undefined || !Number.isFinite(row.mpg) ? 0 : roundTo(row.mpg, STAT_DP);
  return {
    season,
    teamId,
    gamesPlayed,
    gamesStarted: 0, // structural fallback: box_advanced carries no gamesStarted
    minutesPerGame,
    stats: mapPerGameStats(row, playerId, season, fallbacks),
  };
}

// --- Biographical mappings ---

function resolveName(
  bio: NbaPlayerRow,
  boxName: string | null,
): { firstName: string; lastName: string } | null {
  if (bio.firstName && bio.lastName) return { firstName: bio.firstName, lastName: bio.lastName };
  const full = bio.name ?? boxName;
  if (full && full.trim()) {
    const t = full.trim();
    const idx = t.indexOf(' ');
    if (idx > 0) return { firstName: t.slice(0, idx), lastName: t.slice(idx + 1) };
    return { firstName: t, lastName: t };
  }
  if (bio.firstName || bio.lastName) return { firstName: bio.firstName ?? '', lastName: bio.lastName ?? '' };
  return null;
}

function mapPosition(
  raw: string | null,
  playerId: string,
  fallbacks: FallbackEntry[],
): { position: Position; secondaryPosition?: Position } {
  const key = (raw ?? '').trim().toUpperCase();
  const primary = PRIMARY_POSITION_MAP[key];
  if (!primary) {
    fallbacks.push({ playerId, field: 'position', reason: `unrecognized/missing NBA position "${raw ?? ''}" → ${FALLBACK_POSITION}` });
    return { position: FALLBACK_POSITION };
  }
  const parts = key.split('-');
  if (parts.length === 2) {
    const secondary = SECONDARY_TOKEN_MAP[parts[1]];
    if (secondary) return { position: primary, secondaryPosition: secondary };
  }
  return { position: primary };
}

function convertHeight(cm: number | null, playerId: string, fallbacks: FallbackEntry[]): number {
  if (cm === null || cm === undefined || !Number.isFinite(cm) || cm <= 0) {
    fallbacks.push({ playerId, field: 'height', reason: 'null/invalid heightCm → 0' });
    return 0;
  }
  return Math.round(cm / CM_PER_INCH); // cm -> inches
}
function convertWeight(kg: number | null, playerId: string, fallbacks: FallbackEntry[]): number {
  if (kg === null || kg === undefined || !Number.isFinite(kg) || kg <= 0) {
    fallbacks.push({ playerId, field: 'weight', reason: 'null/invalid weightKg → 0' });
    return 0;
  }
  return Math.round(kg * KG_TO_LB); // kg -> lbs
}
function resolveAge(
  bioAge: number | null,
  boxAge: number | null,
  playerId: string,
  fallbacks: FallbackEntry[],
): number {
  if (bioAge !== null && bioAge !== undefined && Number.isFinite(bioAge)) return Math.round(bioAge);
  if (boxAge !== null && boxAge !== undefined && Number.isFinite(boxAge)) {
    fallbacks.push({ playerId, field: 'age', reason: 'players.age null → box_advanced age' });
    return Math.round(boxAge);
  }
  fallbacks.push({ playerId, field: 'age', reason: `age unavailable → ${FALLBACK_AGE}` });
  return FALLBACK_AGE;
}
function resolveExperience(fromYear: number | null, playerId: string, fallbacks: FallbackEntry[]): number {
  if (fromYear === null || fromYear === undefined || !Number.isFinite(fromYear)) {
    fallbacks.push({ playerId, field: 'experience', reason: 'null fromYear → experience 0' });
    return 0;
  }
  return Math.max(0, BUILD_SEASON_START_YEAR - fromYear);
}

// --- Coverage contract membership (2025-26) ---

interface CoverageSets {
  playtypes: Set<number>;
  shotZones: Set<number>;
  shotEvents: Set<number>;
  tracking: Set<number>;
  defense: Set<number>;
  hustle: Set<number>;
}

function personIdSet(rows: { personId: number }[]): Set<number> {
  const s = new Set<number>();
  for (const r of rows) s.add(r.personId);
  return s;
}

function indexByPersonId<T extends { personId: number }>(contract: string, rows: readonly T[]): Map<number, T> {
  const out = new Map<number, T>();
  for (const row of rows) {
    if (out.has(row.personId)) stop(`duplicate personId ${row.personId} in ${contract}/${BUILD_SEASON}`);
    out.set(row.personId, row);
  }
  return out;
}

function loadCoverageSets(): CoverageSets {
  const load = <T extends { personId: number }>(
    contract: string,
    loader: (s: string) => { rows: T[] },
  ): Set<number> => {
    if (!hasNormalizedFile(`${contract}/${BUILD_SEASON}.json`)) return new Set<number>();
    return personIdSet(loader(BUILD_SEASON).rows);
  };
  return {
    playtypes: load('playtypes', loadPlayTypes),
    shotZones: load('shot_zones', loadShotZones),
    shotEvents: hasNormalizedFile(`shot_events/${BUILD_SEASON}.json`)
      ? new Set(loadShotEvents(BUILD_SEASON).rows.map((row) => row.playerId))
      : new Set<number>(),
    tracking: load('tracking', loadTracking),
    defense: load('defense', loadDefense),
    hustle: load('hustle', loadHustle),
  };
}

function emptyZoneAggregate(): ShotEventSeasonAggregate {
  const empty = () => ({ fgm: 0, fga: 0 });
  return {
    season: '', midrangeUnder14: empty(), longMidrange: empty(),
    aboveBreakThree: empty(), deepThree: empty(),
  };
}

/** Exact Stage-1 zone semantics and heave rule, candidate-only aggregation. */
function classifyShotEvent(row: ShotEventRow): keyof Omit<ShotEventSeasonAggregate, 'season'> | 'heave' | 'covered_by_shot_zones' {
  if (row.shotZoneBasic === null || row.shotDistance === null) {
    stop(`shot_events ${row.gameId}/${row.gameEventId} lacks shotZoneBasic or shotDistance`);
  }
  const seconds = row.minutesRemaining * 60 + row.secondsRemaining;
  if (row.shotZoneBasic === 'Backcourt' || (row.shotDistance >= 32 && seconds <= 3)) return 'heave';
  switch (row.shotZoneBasic) {
    case 'Restricted Area': return 'covered_by_shot_zones';
    case 'In The Paint (Non-RA)': return 'covered_by_shot_zones';
    case 'Mid-Range': return row.shotDistance < 14 ? 'midrangeUnder14' : 'longMidrange';
    case 'Left Corner 3':
    case 'Right Corner 3': return 'covered_by_shot_zones';
    case 'Above the Break 3': return row.shotDistance >= 27 ? 'deepThree' : 'aboveBreakThree';
    default: stop(`shot_events ${row.gameId}/${row.gameEventId} has unknown zone "${row.shotZoneBasic}"`);
  }
}

function loadShotEventAggregates(): Map<number, ShotEventSeasonAggregate[]> {
  const byPerson = new Map<number, Map<string, ShotEventSeasonAggregate>>();
  for (const season of RECENT_SEASONS) {
    for (const row of loadShotEvents(season).rows) {
      let seasons = byPerson.get(row.playerId);
      if (!seasons) { seasons = new Map(); byPerson.set(row.playerId, seasons); }
      let aggregate = seasons.get(season);
      if (!aggregate) { aggregate = emptyZoneAggregate(); aggregate.season = season; seasons.set(season, aggregate); }
      const zone = classifyShotEvent(row);
      if (zone === 'heave' || zone === 'covered_by_shot_zones') continue;
      aggregate[zone].fga++;
      if (row.made) aggregate[zone].fgm++;
    }
  }
  return new Map([...byPerson.entries()].map(([personId, seasons]) => [
    personId,
    [...seasons.values()].sort((a, b) => a.season.localeCompare(b.season)),
  ]));
}

function loadShotZonesByPerson(): Map<number, { season: string; row: ReturnType<typeof loadShotZones>['rows'][number] }[]> {
  const byPerson = new Map<number, { season: string; row: ReturnType<typeof loadShotZones>['rows'][number] }[]>();
  for (const season of RECENT_SEASONS) {
    for (const row of loadShotZones(season).rows) {
      const rows = byPerson.get(row.personId) ?? [];
      rows.push({ season, row });
      byPerson.set(row.personId, rows);
    }
  }
  for (const rows of byPerson.values()) rows.sort((a, b) => a.season.localeCompare(b.season));
  return byPerson;
}

// --- Core build ---

interface BuiltPlayer {
  player: Player;
  personId: number;
  bio: NbaPlayerRow;
  boxSeasons: string[];
  derivation: NbaDerivationPlayer;
  score: number; // gp * mpg (2025-26)
  gp2026: number;
}

interface BuildResult {
  teamsJson: string;
  playersJson: string;
  report: string;
  ratingsReport: string;
  tendenciesReport: string;
  summary: {
    teamCount: number;
    rostered: number;
    freeAgents: number;
    eligible: number;
    excludedNoActivity: number;
  };
}

function assertS2bCoverageGates(
  rostered: BuiltPlayer[],
  rotation: BuiltPlayer[],
  coverage: CoverageSets,
): void {
  const contracts: { name: string; covered: (player: BuiltPlayer) => boolean; existingGate: boolean }[] = [
    { name: 'box_advanced', covered: (player) => player.boxSeasons.length >= 1, existingGate: true },
    { name: 'tracking', covered: (player) => coverage.tracking.has(player.personId), existingGate: true },
    { name: 'defense', covered: (player) => coverage.defense.has(player.personId), existingGate: true },
    { name: 'hustle', covered: (player) => coverage.hustle.has(player.personId), existingGate: true },
    { name: 'shot_zones', covered: (player) => coverage.shotZones.has(player.personId), existingGate: false },
    { name: 'shot_events', covered: (player) => coverage.shotEvents.has(player.personId), existingGate: false },
  ];
  for (const contract of contracts) {
    const rotationCovered = rotation.filter(contract.covered).length;
    const rosteredCovered = rostered.filter(contract.covered).length;
    if (rotationCovered / rotation.length < 0.99) {
      stop(`${contract.name} rotation-level coverage ${rotationCovered}/${rotation.length} is below the S2b 99% gate`);
    }
    if (contract.existingGate && rotationCovered !== rotation.length) {
      stop(`${contract.name} rotation-level coverage regressed from S2a's committed 100% (${rotationCovered}/${rotation.length})`);
    }
    if (rosteredCovered === 0) stop(`${contract.name} has no rostered coverage`);
  }
}

function buildLeague(): BuildResult {
  const manifest = loadManifest();
  const boxSeasons = listSeasons('box_advanced'); // sorted asc

  // Index every box_advanced season by personId -> season -> row (for full career history).
  const boxByPerson = new Map<number, Map<string, BoxAdvancedRow>>();
  for (const s of boxSeasons) {
    for (const row of loadBoxAdvanced(s).rows) {
      let m = boxByPerson.get(row.personId);
      if (!m) {
        m = new Map<string, BoxAdvancedRow>();
        boxByPerson.set(row.personId, m);
      }
      m.set(s, row);
    }
  }

  // 2025-26 biographical index.
  const bioByPerson = new Map<number, NbaPlayerRow>();
  for (const row of loadPlayers(BUILD_SEASON).rows) {
    if (bioByPerson.has(row.personId)) stop(`duplicate personId ${row.personId} in players/${BUILD_SEASON}`);
    bioByPerson.set(row.personId, row);
  }

  // teamId <-> abbreviation crosswalk from the players contract; join to NBA_TEAMS metadata.
  const abbrevById = new Map<number, string>();
  for (const row of loadPlayers(BUILD_SEASON).rows) {
    if (row.teamId !== null && row.teamId !== undefined && row.teamAbbreviation) {
      abbrevById.set(row.teamId, row.teamAbbreviation);
    }
  }
  const nbaByAbbrev = new Map(NBA_TEAMS.map((t) => [t.abbreviation, t]));

  const coverage = loadCoverageSets();
  const trackingByPerson = indexByPersonId('tracking', loadTracking(BUILD_SEASON).rows);
  const defenseByPerson = indexByPersonId('defense', loadDefense(BUILD_SEASON).rows);
  const hustleByPerson = indexByPersonId('hustle', loadHustle(BUILD_SEASON).rows);
  const shotZonesByPerson = loadShotZonesByPerson();
  const shotEventAggregates = loadShotEventAggregates();
  const fallbacks: FallbackEntry[] = [];

  // Eligibility: a 2025-26 box_advanced row + a resolvable identity.
  const built: BuiltPlayer[] = [];
  const seen = new Set<number>();
  for (const boxRow of loadBoxAdvanced(BUILD_SEASON).rows) {
    if (seen.has(boxRow.personId)) stop(`duplicate personId ${boxRow.personId} in box_advanced/${BUILD_SEASON}`);
    seen.add(boxRow.personId);

    const bio = bioByPerson.get(boxRow.personId);
    if (!bio) stop(`eligible personId ${boxRow.personId} ("${boxRow.name ?? ''}") has no players/${BUILD_SEASON} bio row`);
    const name = resolveName(bio, boxRow.name);
    if (!name) stop(`personId ${boxRow.personId} has no resolvable name`);

    const id = `nba_${boxRow.personId}`; // canonical id; feeds fnv1a(player.id) for deterministic contract generation
    const { position, secondaryPosition } = mapPosition(bio.position, id, fallbacks);
    const height = convertHeight(bio.heightCm, id, fallbacks);
    const weight = convertWeight(bio.weightKg, id, fallbacks);
    const age = resolveAge(bio.age, boxRow.age, id, fallbacks);
    const experience = resolveExperience(bio.fromYear, id, fallbacks);

    // Full career history across every harvested box_advanced season, sorted asc.
    const careerSeasons = [...boxByPerson.get(boxRow.personId)!.keys()].sort();
    const careerStats = careerSeasons.map((s) =>
      mapSeasonStats(boxByPerson.get(boxRow.personId)!.get(s)!, s, id, fallbacks),
    );
    const current = careerStats.find((cs) => cs.season === BUILD_SEASON);
    if (!current) stop(`personId ${boxRow.personId} missing ${BUILD_SEASON} row after career assembly (invariant)`);

    const gp2026 = boxRow.gp === null || !Number.isFinite(boxRow.gp) ? 0 : boxRow.gp;
    const mpg2026 = boxRow.mpg === null || !Number.isFinite(boxRow.mpg) ? 0 : boxRow.mpg;

    // PLACEHOLDER — S2b replaces ratings, S2c replaces tendencies. Do not tune against this pool.
    const raw = { gamesPlayed: gp2026, minutesPerGame: mpg2026, stats: current.stats, position, age, experience };
    const ratings = deriveRatings(raw);
    const tendencies = deriveTendencies(raw);
    const potential = derivePotential(ratings, age, experience);

    // Build in model key order; teamId set to sentinel now, corrected by roster assignment + normalize.
    const player: Player = {
      id,
      firstName: name.firstName,
      lastName: name.lastName,
      position,
      ...(secondaryPosition ? { secondaryPosition } : {}),
      height,
      weight,
      age,
      experience,
      teamId: FREE_AGENT_TEAM_ID,
      jerseyNumber: 0, // players contract carries no jersey — universal fallback (reported as an aggregate)
      ratings,
      potential,
      scoutingAccuracy: SCOUTING_ACCURACY,
      tendencies,
      contract: { type: 'minimum', salarySchedule: [], noTradeClause: false }, // placeholder, overwritten next line
      health: { healthy: true },
      careerStats,
    };
    built.push({
      player,
      personId: boxRow.personId,
      bio,
      boxSeasons: careerSeasons,
      derivation: {
        personId: boxRow.personId,
        id,
        position,
        heightCm: bio.heightCm,
        weightKg: bio.weightKg,
        wingspanCm: bio.wingspanCm,
        boxSeasons: careerSeasons.map((season) => ({ season, row: boxByPerson.get(boxRow.personId)!.get(season)! })),
        shotZoneSeasons: shotZonesByPerson.get(boxRow.personId) ?? [],
        shotEventSeasons: shotEventAggregates.get(boxRow.personId) ?? [],
        tracking: trackingByPerson.get(boxRow.personId),
        defense: defenseByPerson.get(boxRow.personId),
        hustle: hustleByPerson.get(boxRow.personId),
      },
      score: gp2026 * mpg2026,
      gp2026,
    });
  }

  // Exclusions: players-contract entries with no 2025-26 box row.
  let excludedNoActivity = 0;
  for (const personId of bioByPerson.keys()) {
    if (!seen.has(personId)) excludedNoActivity++;
  }

  // Roster assignment by season-end teamId; null/absent teamId -> free agent.
  const assignedByTeam = new Map<number, BuiltPlayer[]>();
  const freeAgents: BuiltPlayer[] = [];
  for (const bp of built) {
    const tid = bp.bio.teamId;
    if (tid === null || tid === undefined) {
      freeAgents.push(bp);
      continue;
    }
    const abbrev = abbrevById.get(tid);
    if (!abbrev || !nbaByAbbrev.has(abbrev)) {
      stop(`player ${bp.player.id} has teamId ${tid} that does not map to a known NBA team (abbrev "${abbrev ?? ''}")`);
    }
    let arr = assignedByTeam.get(tid);
    if (!arr) {
      arr = [];
      assignedByTeam.set(tid, arr);
    }
    arr.push(bp);
  }

  const tendencyInput = built.map((bp) => {
    const season = bp.player.careerStats.find((stats) => stats.season === BUILD_SEASON)!;
    return { personId: bp.personId, id: bp.player.id, position: bp.player.position, boxSeasons: bp.derivation.boxSeasons, raw: season };
  });
  const tendencyDerivation = deriveNbaTendencies(tendencyInput, loadPlayTypes(BUILD_SEASON).rows, loadShotEvents(BUILD_SEASON).rows);
  for (const bp of built) {
    const tendencies = tendencyDerivation.tendencies.get(bp.personId);
    if (!tendencies) stop(`S2c1 tendencies missing personId ${bp.personId}`);
    bp.player.tendencies = tendencies;
  }

  // The 30 teams: distinct NBA teamIds present in the crosswalk, sorted ascending.
  const teamIds = [...abbrevById.keys()]
    .filter((tid) => nbaByAbbrev.has(abbrevById.get(tid)!))
    .sort((a, b) => a - b);
  if (teamIds.length !== 30) stop(`expected 30 NBA teams from the players crosswalk, found ${teamIds.length}`);

  // Deterministic ranking: gp*mpg desc, gp desc, id asc.
  const rankCmp = (a: BuiltPlayer, b: BuiltPlayer): number =>
    b.score - a.score || b.gp2026 - a.gp2026 || a.player.id.localeCompare(b.player.id);

  const teams: Team[] = [];
  const rosteredById = new Map<string, BuiltPlayer>();
  const rotationLevelIds = new Set<string>();
  for (const tid of teamIds) {
    const abbrev = abbrevById.get(tid)!;
    const meta = nbaByAbbrev.get(abbrev)!;
    const assigned = (assignedByTeam.get(tid) ?? []).slice().sort(rankCmp);
    const kept = assigned.slice(0, ROSTER_MAX);
    const overflow = assigned.slice(ROSTER_MAX);
    for (const bp of overflow) freeAgents.push(bp);

    if (kept.length < ROSTER_MIN) {
      stop(
        `team ${abbrev} (nba_team_${tid}) has only ${kept.length} rostered players after capping ` +
          `(< ROSTER_MIN ${ROSTER_MIN}); refusing to pad`,
      );
    }

    const rosterIds = kept.map((bp) => bp.player.id);
    for (const bp of kept) rosteredById.set(bp.player.id, bp);
    for (const bp of kept.slice(0, ROTATION_LEVEL_TOP_N)) rotationLevelIds.add(bp.player.id);

    const team: Team = {
      id: `nba_team_${tid}`,
      name: meta.name,
      city: meta.city,
      fullName: `${meta.city} ${meta.name}`,
      abbreviation: meta.abbreviation,
      conference: meta.conference,
      division: meta.division,
      roster: rosterIds,
      rotation: { starters: ['', '', '', '', ''], rotationOrder: [], minuteTargets: {} },
      offensiveSystem: candidateOffensiveSystem(),
      defensiveSystem: candidateDefensiveSystem(),
    };
    teams.push(team);
  }

  // Mark free agents (also corrected by normalize).
  for (const bp of freeAgents) bp.player.teamId = FREE_AGENT_TEAM_ID;

  // Self-gate: every rostered player has >=1 box_advanced season (true by construction).
  for (const bp of rosteredById.values()) {
    if (bp.boxSeasons.length < 1) stop(`rostered player ${bp.player.id} has zero box_advanced seasons (invariant)`);
  }

  const rosteredPlayers = [...rosteredById.values()].sort((a, b) => a.personId - b.personId);
  const rotationPlayers = rosteredPlayers.filter((bp) => rotationLevelIds.has(bp.player.id));
  assertS2bCoverageGates(rosteredPlayers, rotationPlayers, coverage);

  const activePlayers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'players.json'), 'utf-8')) as Player[];
  if (activePlayers.length === 0) stop('active data/players.json is empty; cannot establish S2b SD diagnostics');
  const derivationInput: NbaDerivationInput = {
    players: built.map((bp) => bp.derivation),
    rosteredPersonIds: new Set(rosteredPlayers.map((bp) => bp.personId)),
    activeRatings: activePlayers.map((player) => player.ratings),
  };
  let derivation;
  try {
    derivation = deriveNbaRatings(derivationInput);
  } catch (error) {
    stop(`S2b ratings derivation failed: ${(error as Error).message}`);
  }
  for (const bp of built) {
    const ratings = derivation.ratingsByPerson.get(bp.personId);
    if (!ratings) stop(`S2b ratings missing personId ${bp.personId}`);
    bp.player.ratings = ratings;
    bp.player.potential = derivePotential(ratings, bp.player.age, bp.player.experience);
  }

  // Contracts, rotations, and FA desired contracts all consume the same S2b
  // ratings. Roster membership and the rotation-level derivation population
  // were established earlier from gp*mpg and season-end teamId only.
  for (const bp of built) bp.player.contract = generateContractForPlayer(bp.player);
  for (const team of teams) {
    const rosterPlayers = team.roster.map((id) => rosteredById.get(id)?.player).filter((p): p is Player => p !== undefined);
    setupRotation(team, rosterPlayers);
  }
  const ratingsReport = renderRatingsContract(derivationInput, derivation);
  const tendenciesReport = renderTendenciesContract(tendencyDerivation, built, rosteredPlayers, rotationPlayers.length);

  // Canonicalize contracts / desired contracts / FA teamIds via the save boundary.
  const allPlayers = built.map((bp) => bp.player);
  const { players: normalizedPlayers } = normalizePlayersForSave(allPlayers, [], teams);

  const teamsJson = JSON.stringify(teams, null, 2) + '\n';
  const playersJson = JSON.stringify(normalizedPlayers, null, 2) + '\n';

  const rosteredCount = rosteredById.size;
  const faCount = built.length - rosteredCount;

  const report = renderReport({
    manifest,
    boxSeasons,
    built,
    rosteredById,
    rotationLevelIds,
    coverage,
    fallbacks,
    excludedNoActivity,
    teamCount: teams.length,
    rosteredCount,
    faCount,
  });

  return {
    teamsJson,
    playersJson,
    report,
    ratingsReport,
    tendenciesReport,
    summary: {
      teamCount: teams.length,
      rostered: rosteredCount,
      freeAgents: faCount,
      eligible: built.length,
      excludedNoActivity,
    },
  };
}

function renderTendenciesContract(result: ReturnType<typeof deriveNbaTendencies>, built: BuiltPlayer[], rosteredPlayers: BuiltPlayer[], rotation: number): string {
  const eligible = built.length;
  const rostered = rosteredPlayers.length;
  const weightedAverage = (field: keyof Player['tendencies'], weights: ReadonlyMap<number, number>) => {
    const denominator = rosteredPlayers.reduce((sum, bp) => sum + (weights.get(bp.personId) ?? 0), 0);
    return rosteredPlayers.reduce((sum, bp) => sum + bp.player.tendencies[field] * (weights.get(bp.personId) ?? 0), 0) / denominator;
  };
  const playTargets: Record<string, number> = { isolationFreq:.0819, pickAndRoll:.254, postUpFreq:.0424, spotUpFreq:.2561, transitionFreq:.1966, cutFreq:.0732, offScreenFreq:.0408, handoffFreq:.055 };
  const shotTargets: Record<string, number> = { rimRate:.2869, midrangeRate:.3043, threePointRate:.4088 };
  const out = ['# S2c1 — Candidate Tendencies Contract', '', '> Generated by `scripts/build-league.ts` (`npm run build-league`). Regenerate; never hand-edit.', '> `--check` byte-compares this file against a fresh derivation.', '', '## Provenance', '', '- Normalized schema version: **3**.', `- Build season: **${BUILD_SEASON}**; Synergy and shot-events are single-season inputs.`, '- Usage: S2b recent-window possession-weighted box_advanced samples (2025-26/2024-25/2023-24 at 0.55/0.30/0.15).', '- drawFoulRate, assistRate, and reboundRate retain legacy stat-driven formulas over build-season mapped stats; astPct/rebPct upgrades are deferred to S2d/S3.', '', '## Coverage', '', '| Population | Eligible | Rostered | Rotation-level | Synergy covered | Shot covered | Usage covered |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |', `| Candidate | ${eligible} | ${rostered} | ${rotation} | ${result.coveredSynergy} | ${result.coveredShots} | ${result.coveredUsage} |`, '', '## Frequency-scale convention', '', '- `selectPlayType`: `w *= 0.5 + tendency * 2.0`; the seven selectable play types are normalized only by weightedChoice.', '- Frequencies are mapped Synergy possession shares, Misc excluded, and sum to 1 across all nine fields. This remains compatible with legacy roughly-0.5..1.3 totals.', '- `pick_and_roll` directly reads `pickAndRollBallHandlerFreq`; the screener field is recorded but is not an initiating weight. `transitionFreq` is engine-inert because transition is selected upstream.', '- Synergy OffRebound is not harvested, so its omitted mass slightly overstates the retained categories.', '', '## Fallback log', '', '| Player id | Field | Reason |', '| --- | --- | --- |'];
  for (const row of result.fallbackLog) out.push(`| ${row.playerId} | ${row.field} | ${row.reason} |`);
  out.push('', '## League-aggregate checks', '', 'Derived-data comparison only: these are not claims about the simulated candidate, whose team systems, position weights, skill fit, and possession chain reshape selection.', '', '| Play type | Candidate share | Synergy target | Delta |', '| --- | ---: | ---: | ---: |');
  const plays: [string, keyof Player['tendencies']][] = [['isolation','isolationFreq'],['post_up','postUpFreq'],['spot_up','spotUpFreq'],['transition','transitionFreq'],['cut','cutFreq'],['off_screen','offScreenFreq'],['handoff','handoffFreq']];
  const pnr = weightedAverage('pickAndRollBallHandlerFreq', result.synergyPossessions) + weightedAverage('pickAndRollScreenerFreq', result.synergyPossessions);
  out.push(`| pick_and_roll (both fields) | ${pnr.toFixed(4)} | ${playTargets.pickAndRoll.toFixed(4)} | ${(pnr - playTargets.pickAndRoll).toFixed(4)} |`);
  for (const [label, field] of plays) { const target=playTargets[field]; const value=weightedAverage(field, result.synergyPossessions); out.push(`| ${label} | ${value.toFixed(4)} | ${target.toFixed(4)} | ${(value-target).toFixed(4)} |`); }
  out.push('', '| Shot bucket | Candidate share | Target | Delta |', '| --- | ---: | ---: | ---: |');
  for (const field of ['rimRate','midrangeRate','threePointRate'] as const) { const value=weightedAverage(field, result.shotFga); out.push(`| ${field} | ${value.toFixed(4)} | ${shotTargets[field].toFixed(4)} | ${(value-shotTargets[field]).toFixed(4)} |`); }
  out.push('', '## Standing caveats', '', '- Pooled targets cover 2023-26 while the candidate play-type and shot mix sources are 2025-26.', '- Aggregate and candidate-profile differences are informational only; S2c2/S2d own engine compensation and activation.', '');
  return out.join('\n');
}

// --- Coverage report ---

interface RenderArgs {
  manifest: { schema_version: number; nba_api_versions: string[] };
  boxSeasons: string[];
  built: BuiltPlayer[];
  rosteredById: Map<string, BuiltPlayer>;
  rotationLevelIds: Set<string>;
  coverage: CoverageSets;
  fallbacks: FallbackEntry[];
  excludedNoActivity: number;
  teamCount: number;
  rosteredCount: number;
  faCount: number;
}

function pct(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : 'n/a';
}

function coverageRow(
  label: string,
  population: BuiltPlayer[],
  has: (bp: BuiltPlayer) => boolean,
): string {
  const n = population.filter(has).length;
  return `| ${label} | ${n}/${population.length} | ${pct(n, population.length)} |`;
}

function renderCoverageTable(title: string, population: BuiltPlayer[], coverage: CoverageSets): string {
  const lines = [
    `### ${title} (n=${population.length})`,
    '',
    '| Contract | Covered | % |',
    '| --- | --- | --- |',
    coverageRow('box_advanced (≥1 season)', population, (bp) => bp.boxSeasons.length >= 1),
    coverageRow('playtypes (2025-26)', population, (bp) => coverage.playtypes.has(bp.personId)),
    coverageRow('shot_zones (2025-26)', population, (bp) => coverage.shotZones.has(bp.personId)),
    coverageRow('shot_events (2025-26)', population, (bp) => coverage.shotEvents.has(bp.personId)),
    coverageRow('tracking (2025-26)', population, (bp) => coverage.tracking.has(bp.personId)),
    coverageRow('defense (2025-26)', population, (bp) => coverage.defense.has(bp.personId)),
    coverageRow('hustle (2025-26)', population, (bp) => coverage.hustle.has(bp.personId)),
    coverageRow('wingspanCm present', population, (bp) => bp.bio.wingspanCm !== null && bp.bio.wingspanCm !== undefined),
  ];
  // Average box_advanced seasons for context.
  const totalSeasons = population.reduce((a, bp) => a + bp.boxSeasons.length, 0);
  const avg = population.length > 0 ? (totalSeasons / population.length).toFixed(2) : '0';
  lines.push('', `Average box_advanced seasons per player: ${avg}`);
  return lines.join('\n');
}

function renderReport(a: RenderArgs): string {
  const rostered = [...a.rosteredById.values()].sort((x, y) => x.player.id.localeCompare(y.player.id));
  const rotationLevel = rostered.filter((bp) => a.rotationLevelIds.has(bp.player.id));
  const seasonWindow = a.boxSeasons.length > 0 ? `${a.boxSeasons[0]} … ${a.boxSeasons[a.boxSeasons.length - 1]}` : '(none)';

  // Structural-fallback counts.
  const totalCareerRows = a.built.reduce((acc, bp) => acc + bp.boxSeasons.length, 0);
  const jerseyCount = a.built.length; // universal

  // Non-jersey fallback log, sorted deterministically.
  const logged = [...a.fallbacks].sort(
    (x, y) => x.playerId.localeCompare(y.playerId) || x.field.localeCompare(y.field) || x.reason.localeCompare(y.reason),
  );
  const fallbacksByReason = new Map<string, number>();
  for (const f of logged) fallbacksByReason.set(f.reason, (fallbacksByReason.get(f.reason) ?? 0) + 1);

  const out: string[] = [];
  out.push('# S2a — League Candidate Coverage & Fallback Report');
  out.push('');
  out.push('> Generated by `scripts/build-league.ts` (`npm run build-league`). Regenerate; never hand-edit.');
  out.push('> `--check` byte-compares this file against a fresh derivation.');
  out.push('');
  out.push('## Provenance');
  out.push('');
  out.push(`- Normalized schema version: **${a.manifest.schema_version}**`);
  out.push(`- box_advanced season window consumed: **${seasonWindow}** (${a.boxSeasons.length} seasons)`);
  out.push(`- Built season (eligibility + S2b-derived ratings): **${BUILD_SEASON}**`);
  out.push(`- nba_api version(s): **${[...a.manifest.nba_api_versions].sort().join(', ') || '(none)'}**`);
  out.push('- Builder invocation: `npm run build-league` (identity/league-construction only; S2a)');
  out.push('');
  out.push('> **Ratings are S2b-derived from normalized NBA contracts; potential is recomputed from those ratings.**');
  out.push('> Tendencies remain legacy-heuristic placeholders until S2c. Do not tune the active engine against this candidate.');
  out.push('');
  out.push('## League shape');
  out.push('');
  out.push('| Metric | Count |');
  out.push('| --- | --- |');
  out.push(`| Teams | ${a.teamCount} |`);
  out.push(`| Total eligible players (2025-26 box_advanced row) | ${a.built.length} |`);
  out.push(`| Rostered players | ${a.rosteredCount} |`);
  out.push(`| Free-agent-sentineled players | ${a.faCount} |`);
  out.push(`| Excluded — players-contract entries with no 2025-26 activity | ${a.excludedNoActivity} |`);
  out.push('');
  out.push('## Per-contract coverage');
  out.push('');
  out.push('Coverage that S2b/S2c will gate on. Two populations: **all rostered** players, and');
  out.push(`**rotation-level** (top-${ROTATION_LEVEL_TOP_N} per team by \`gp × mpg\`).`);
  out.push('');
  out.push(renderCoverageTable('All rostered', rostered, a.coverage));
  out.push('');
  out.push(renderCoverageTable('Rotation-level', rotationLevel, a.coverage));
  out.push('');
  out.push('## Structural fallbacks');
  out.push('');
  out.push('These are known, accepted structural limits of the source contracts — reported, not papered over.');
  out.push('');
  out.push('| Structural fallback | Count |');
  out.push('| --- | --- |');
  out.push(`| \`gamesStarted: 0\` (box_advanced carries no gamesStarted) — career rows | ${totalCareerRows} |`);
  out.push(`| Single row per season, season-end team attribution (no traded-player stint splits) — career rows | ${totalCareerRows} |`);
  out.push(`| \`jerseyNumber: 0\` (players contract carries no jersey) — players | ${jerseyCount} |`);
  out.push('');
  out.push('## Nullable-field policy');
  out.push('');
  out.push(NULLABLE_POLICY_TABLE);
  out.push('');
  out.push('## Per-player fallback log');
  out.push('');
  out.push('Every documented default other than the universal `jerseyNumber: 0` above (biographical, position,');
  out.push('and nullable-stat substitutions), one row per application.');
  out.push('');
  if (fallbacksByReason.size > 0) {
    out.push('| Reason | Count |');
    out.push('| --- | --- |');
    for (const reason of [...fallbacksByReason.keys()].sort()) {
      out.push(`| ${reason} | ${fallbacksByReason.get(reason)} |`);
    }
    out.push('');
    out.push('| Player id | Field | Reason |');
    out.push('| --- | --- | --- |');
    for (const f of logged) out.push(`| ${f.playerId} | ${f.field} | ${f.reason} |`);
  } else {
    out.push('_No biographical, position, or nullable-stat fallbacks were applied._');
  }
  out.push('');
  return out.join('\n');
}

// --- Entry point ---

function parseArgs(argv: string[]): { check: boolean } {
  let check = false;
  for (const arg of argv) {
    if (arg === '--check') check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { check };
}

function main(): void {
  const { check } = parseArgs(process.argv.slice(2));

  let result: BuildResult;
  try {
    result = buildLeague();
  } catch (err) {
    if (err instanceof StopAndSurface) {
      console.error(`STOP AND SURFACE: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  if (check) {
    const cmp = (label: string, filePath: string, expected: string): boolean => {
      const actual = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
      if (actual === expected) {
        console.log(`--check OK: ${label} byte-identical.`);
        return true;
      }
      console.error(`--check FAILED: ${label} differs (or is missing). Re-run without --check and review.`);
      return false;
    };
    const ok = [
      cmp('data/league-candidate/teams.json', TEAMS_PATH, result.teamsJson),
      cmp('data/league-candidate/players.json', PLAYERS_PATH, result.playersJson),
      cmp('docs/S2A_LEAGUE_COVERAGE.md', COVERAGE_PATH, result.report),
      cmp('docs/S2B_RATINGS_CONTRACT.md', RATINGS_CONTRACT_PATH, result.ratingsReport),
      cmp('docs/S2C1_TENDENCIES_CONTRACT.md', TENDENCIES_CONTRACT_PATH, result.tendenciesReport),
    ].every(Boolean);
    if (!ok) process.exitCode = 1;
    return;
  }

  fs.mkdirSync(CANDIDATE_DIR, { recursive: true });
  fs.writeFileSync(TEAMS_PATH, result.teamsJson, 'utf-8');
  fs.writeFileSync(PLAYERS_PATH, result.playersJson, 'utf-8');
  fs.mkdirSync(path.dirname(COVERAGE_PATH), { recursive: true });
  fs.writeFileSync(COVERAGE_PATH, result.report, 'utf-8');
  fs.writeFileSync(RATINGS_CONTRACT_PATH, result.ratingsReport, 'utf-8');
  fs.writeFileSync(TENDENCIES_CONTRACT_PATH, result.tendenciesReport, 'utf-8');

  const s = result.summary;
  console.log(`Wrote ${TEAMS_PATH}`);
  console.log(`Wrote ${PLAYERS_PATH}`);
  console.log(`Wrote ${COVERAGE_PATH}`);
  console.log(`Wrote ${RATINGS_CONTRACT_PATH}`);
  console.log(`Wrote ${TENDENCIES_CONTRACT_PATH}`);
  console.log(
    `League: ${s.teamCount} teams | ${s.eligible} eligible | ${s.rostered} rostered | ` +
      `${s.freeAgents} free agents | ${s.excludedNoActivity} excluded (no 2025-26 activity)`,
  );
}

main();
