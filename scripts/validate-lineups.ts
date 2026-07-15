/**
 * S3.a — deterministic historical validation of the production lineup model.
 *
 * This script is a measurement harness. Historical projections are in-memory,
 * season-as-of views only; no league, save, player pool, or engine constant is
 * written. `--check` regenerates the report and compares it byte-for-byte.
 */
import * as fs from 'fs';
import * as path from 'path';

import { Player, Position } from '../src/models/player';
import { Team } from '../src/models/team';
import {
  BoxAdvancedRow,
  DefenseRow,
  HustleRow,
  LineupRow,
  NbaPlayerRow,
  PlayTypeRow,
  ShotEventRow,
  ShotZonesRow,
  TrackingRow,
} from '../src/data/nba/types';
import {
  hasNormalizedFile,
  listSeasons,
  loadBoxAdvanced,
  loadDefense,
  loadHustle,
  loadLineups,
  loadManifest,
  loadPlayers,
  loadPlayTypes,
  loadShotEvents,
  loadShotZones,
  loadTracking,
} from '../src/data/nba/load';
import {
  NbaDerivationInput,
  NbaDerivationPlayer,
  ShotEventSeasonAggregate,
  deriveNbaRatings,
  seasonRelativeNbaDerivationOptions,
} from '../src/ratings/nba-derivation';
import { deriveNbaTendencies, TendencyInput } from '../src/ratings/nba-tendencies';
import { derivePotential } from '../src/ratings/derivation';
import {
  SPACING_CLAMP,
  SPACING_SPREAD,
  VERSATILITY_CLAMP,
  VERSATILITY_SPREAD,
} from '../src/engine/constants';
import { computeSpacing, computeVersatility, rawOffBallGravity, rawVersatility } from '../src/engine/spacing';
import { productionFinisherShare, productionPlayTypeMix } from './shared-lineup-model';

const REPORT_PATH = path.join(process.cwd(), 'docs', 'S3_LINEUP_VALIDATION.md');
const BASELINE_PATH = path.join(process.cwd(), 'docs', 'S3_LINEUP_VALIDATION_BASELINE.json');
const FIRST_SEASON = '2007-08';
const LAST_SEASON = '2024-25';
const SEASONS = listSeasons('lineups').filter((season) => season >= FIRST_SEASON && season <= LAST_SEASON).sort();
const MIN_COVERAGE = 0.95;
const MIN_CUTOFFS = [100, 250, 500];
const CLAMP_EPSILON = 1e-12;
const FALLBACK_POSITION: Position = 'SF';
const CM_PER_INCH = 2.54;
const KG_TO_LB = 2.2046226218;
const FREE_AGENT_TEAM_ID = 'free_agent_pool';

const DEFAULT_OFFENSIVE_SYSTEM = {
  pace: 100,
  threePointEmphasis: 0.5,
  transitionEmphasis: 0.5,
  postPlayEmphasis: 0.3,
  isolationEmphasis: 0.3,
  screeningEmphasis: 0.5,
};

const POSITION_MAP: Record<string, Position> = { G: 'PG', 'G-F': 'SG', 'F-G': 'SF', F: 'SF', 'F-C': 'PF', 'C-F': 'PF', C: 'C' };

type ContractName = 'box_advanced' | 'shot_zones' | 'shot_events' | 'playtypes' | 'tracking' | 'defense' | 'hustle' | 'wingspan';
const CONTRACTS: ContractName[] = ['box_advanced', 'shot_zones', 'shot_events', 'playtypes', 'tracking', 'defense', 'hustle', 'wingspan'];

interface ProjectionPlayer {
  player: Player;
  input: NbaDerivationPlayer;
  coverage: Record<ContractName, boolean>;
  shotMixSource: 'shot_events' | 'shot_zones' | 'position_fallback';
}

interface Projection {
  season: string;
  players: Map<number, ProjectionPlayer>;
  fallbackLog: { playerId: string; field: string; reason: string }[];
}

interface EvaluatedLineup {
  season: string;
  teamId: string;
  ids: number[];
  possessions: number;
  offRating: number;
  defRating: number;
  netRating: number;
  rawSpacing: number;
  rawVersatility: number;
  spacingSaturated: number;
  versatilitySaturated: boolean;
}

interface SeasonSummary {
  season: string;
  totalRows: number;
  positivePossessions: number;
  usableRows: number;
  totalPossessions: number;
  usablePossessions: number;
  identityJoinRate: number;
  rowCoverage: number;
  possessionCoverage: number;
  fallbackRates: Record<ContractName, number>;
  shotMixSources: Record<'shot_events' | 'shot_zones' | 'position_fallback', number>;
  spacingClampRate: number;
  versatilityClampRate: number;
}

interface PairObservation {
  season: string;
  key: string;
  weight: number;
  spacingDelta: number;
  versatilityDelta: number;
  combinedDelta: number;
  observedOffDelta: number;
  observedDefDelta: number;
  observedNetDelta: number;
  leftPossessions: number;
  rightPossessions: number;
}

interface MetricSummary {
  pairCount: number;
  possessions: number;
  pearson: number | null;
  spearman: number | null;
  directionAccuracy: number | null;
  directionCount: number;
  modelTieCount: number;
  weightedRmse: number | null;
  weightedMae: number | null;
  losoCorrelationMean: number | null;
  losoCorrelationSd: number | null;
  losoCorrelationMin: number | null;
  losoCorrelationMax: number | null;
  losoRmseMean: number | null;
  losoRmseSd: number | null;
  losoRows: { season: string; pairCount: number; correlation: number | null; rmse: number | null }[];
}

interface ComparisonDefinition {
  name: 'spacing' | 'versatility' | 'combined';
  primaryCohort: string;
  x: (pair: PairObservation) => number;
  y: (pair: PairObservation) => number;
}

interface RegressionBaselineEntry {
  primaryCohort: string;
  acceptedPearson: number;
  acceptedLosoCorrelationSd: number;
  tolerance: number;
}

interface RegressionBaseline {
  schemaVersion: number;
  acceptedAt: string;
  metric: string;
  toleranceFormula: string;
  numericalFloor: number;
  comparisons: Record<'spacing' | 'versatility' | 'combined', RegressionBaselineEntry>;
}

const COMPARISONS: ComparisonDefinition[] = [
  { name: 'spacing', primaryCohort: 'long-run (2007-08 through 2024-25)', x: (p) => p.spacingDelta, y: (p) => p.observedOffDelta },
  { name: 'versatility', primaryCohort: 'defense/tracking (2013-14 through 2024-25)', x: (p) => p.versatilityDelta, y: (p) => p.observedDefDelta },
  { name: 'combined', primaryCohort: 'defense/tracking (2013-14 through 2024-25)', x: (p) => p.combinedDelta, y: (p) => p.observedNetDelta },
];

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function n(value: unknown): number { return finite(value) ? value : 0; }
function fixed(value: number | null, digits = 4): string { return value === null || !finite(value) ? '—' : value.toFixed(digits); }
function pct(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function seasonStart(season: string): number { return Number.parseInt(season.slice(0, 4), 10); }
function seasonFromStart(start: number): string { return `${start}-${String((start + 1) % 100).padStart(2, '0')}`; }
export function harmonicMean(a: number, b: number): number { return (2 * a * b) / (a + b); }
function mean(values: readonly number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function sd(values: readonly number[]): number | null { const m = mean(values); return m === null ? null : Math.sqrt(mean(values.map((x) => (x - m) ** 2))!); }

function mapPosition(raw: string | null): Position {
  return POSITION_MAP[(raw ?? '').trim().toUpperCase()] ?? FALLBACK_POSITION;
}

function targetRecentSeasons(target: string): string[] {
  const start = seasonStart(target);
  return [0, 1, 2].map((offset) => seasonFromStart(start - offset));
}

export function canonicalLineupKey(ids: readonly number[]): string { return [...ids].sort((a, b) => a - b).join(','); }
export function canonicalPairKey(season: string, teamId: string, left: readonly number[], right: readonly number[]): string {
  const lineups = [canonicalLineupKey(left), canonicalLineupKey(right)].sort();
  return `${season}|${teamId}|${lineups[0]}|${lineups[1]}`;
}
export function isUsableLineupRow(row: LineupRow, playerIds: ReadonlySet<number>): boolean {
  return Array.isArray(row.personIds)
    && row.personIds.length === 5
    && row.personIds.every((id) => playerIds.has(id))
    && finite(row.possessions) && row.possessions > 0
    && finite(row.offRating) && finite(row.defRating) && finite(row.netRating);
}

function classifyShotEvent(row: ShotEventRow): keyof Omit<ShotEventSeasonAggregate, 'season'> | 'heave' | 'covered_by_shot_zones' {
  if (row.shotZoneBasic === null || row.shotDistance === null) throw new Error(`shot_events ${row.gameId}/${row.gameEventId} lacks shotZoneBasic or shotDistance`);
  const seconds = row.minutesRemaining * 60 + row.secondsRemaining;
  if (row.shotZoneBasic === 'Backcourt' || (row.shotDistance >= 32 && seconds <= 3)) return 'heave';
  switch (row.shotZoneBasic) {
    case 'Restricted Area': return 'covered_by_shot_zones';
    case 'In The Paint (Non-RA)': return 'covered_by_shot_zones';
    case 'Mid-Range': return row.shotDistance < 14 ? 'midrangeUnder14' : 'longMidrange';
    case 'Left Corner 3':
    case 'Right Corner 3': return 'covered_by_shot_zones';
    case 'Above the Break 3': return row.shotDistance >= 27 ? 'deepThree' : 'aboveBreakThree';
    default: throw new Error(`shot_events ${row.gameId}/${row.gameEventId} has unknown zone ${row.shotZoneBasic}`);
  }
}

function emptyAggregate(season: string): ShotEventSeasonAggregate {
  return { season, midrangeUnder14: { fgm: 0, fga: 0 }, longMidrange: { fgm: 0, fga: 0 }, aboveBreakThree: { fgm: 0, fga: 0 }, deepThree: { fgm: 0, fga: 0 } };
}

function aggregateShotEvents(rows: readonly ShotEventRow[], season: string): Map<number, ShotEventSeasonAggregate> {
  const out = new Map<number, ShotEventSeasonAggregate>();
  for (const row of rows) {
    const kind = classifyShotEvent(row);
    if (kind === 'heave' || kind === 'covered_by_shot_zones') continue;
    const aggregate = out.get(row.playerId) ?? emptyAggregate(season);
    aggregate[kind].fga++;
    if (row.made) aggregate[kind].fgm++;
    out.set(row.playerId, aggregate);
  }
  return out;
}

function defaultTeam(teamId: string): Team {
  return {
    id: teamId,
    name: teamId,
    city: teamId,
    fullName: teamId,
    abbreviation: teamId,
    conference: 'East',
    division: 'Atlantic',
    roster: [],
    rotation: { starters: ['', '', '', '', ''], rotationOrder: [], minuteTargets: {} },
    offensiveSystem: { ...DEFAULT_OFFENSIVE_SYSTEM },
    defensiveSystem: { scheme: 'man', intensity: 0.5, doubleTeamThreshold: 70, helpDefenseAggression: 0.5 },
  };
}

function buildProjection(season: string, cache: ContractCache): Projection {
  const options = seasonRelativeNbaDerivationOptions(season);
  const boxRows = cache.box(season).rows;
  const bioByPerson = new Map(cache.players(season).rows.map((row) => [row.personId, row]));
  const recent = targetRecentSeasons(season).filter((s) => s >= '1996-97');
  const boxByPerson = new Map<number, { season: string; row: BoxAdvancedRow }[]>();
  for (const s of cache.boxSeasons.filter((candidate) => candidate <= season)) {
    for (const row of cache.box(s).rows) {
      const list = boxByPerson.get(row.personId) ?? [];
      list.push({ season: s, row });
      boxByPerson.set(row.personId, list);
    }
  }
  const shotZonesBySeason = new Map<string, ShotZonesRow[]>();
  for (const s of recent) if (cache.has('shot_zones', s)) shotZonesBySeason.set(s, cache.shotZones(s).rows);
  const shotEvents = cache.has('shot_events', season) ? cache.shotEvents(season).rows : [];
  const eventAggregatesBySeason = new Map<string, Map<number, ShotEventSeasonAggregate>>();
  for (const s of options.recentSeasons) if (cache.has('shot_events', s)) eventAggregatesBySeason.set(s, aggregateShotEvents(cache.shotEvents(s).rows, s));

  const inputs: NbaDerivationPlayer[] = [];
  const tendencyInputs: TendencyInput[] = [];
  const rawByPerson = new Map<number, BoxAdvancedRow>();
  for (const box of [...boxRows].sort((a, b) => a.personId - b.personId)) {
    const bio = bioByPerson.get(box.personId);
    if (!bio) throw new Error(`${season}: eligible box_advanced personId ${box.personId} has no same-season players row`);
    const id = `nba_${box.personId}`;
    const boxSeasons = boxByPerson.get(box.personId) ?? [];
    const shotZoneSeasons = recent.flatMap((s) => (shotZonesBySeason.get(s) ?? []).filter((row) => row.personId === box.personId).map((row) => ({ season: s, row })));
    const shotEventSeasons = options.recentSeasons.flatMap((s) => {
      const aggregate = eventAggregatesBySeason.get(s)?.get(box.personId);
      return aggregate ? [aggregate] : [];
    });
    const input: NbaDerivationPlayer = {
      personId: box.personId,
      id,
      position: mapPosition(bio.position),
      heightCm: bio.heightCm,
      weightKg: bio.weightKg,
      wingspanCm: bio.wingspanCm,
      boxSeasons,
      shotZoneSeasons,
      shotEventSeasons,
      tracking: cache.has('tracking', season) ? cache.tracking(season).rows.find((row) => row.personId === box.personId) : undefined,
      defense: cache.has('defense', season) ? cache.defense(season).rows.find((row) => row.personId === box.personId) : undefined,
      hustle: cache.has('hustle', season) ? cache.hustle(season).rows.find((row) => row.personId === box.personId) : undefined,
    };
    inputs.push(input);
    rawByPerson.set(box.personId, box);
    tendencyInputs.push({
      personId: box.personId,
      id,
      position: input.position,
      boxSeasons,
      shotZoneSeasons,
      raw: {
        gamesPlayed: n(box.gp),
        minutesPerGame: n(box.mpg),
        stats: { fieldGoalsAttempted: n(box.perGame.fga), freeThrowsAttempted: n(box.perGame.fta), assists: n(box.perGame.ast), rebounds: n(box.perGame.reb) },
      },
    });
  }
  const derivationInput: NbaDerivationInput = { players: inputs, rosteredPersonIds: new Set(inputs.map((input) => input.personId)) };
  const ratings = deriveNbaRatings(derivationInput, options);
  const tendencies = deriveNbaTendencies(
    tendencyInputs,
    cache.has('playtypes', season) ? cache.playtypes(season).rows : [],
    shotEvents,
    { ...options, targetSeason: season },
  );
  const players = new Map<number, ProjectionPlayer>();
  for (const input of inputs) {
    const bio = bioByPerson.get(input.personId)!;
    const box = rawByPerson.get(input.personId)!;
    const rating = ratings.ratingsByPerson.get(input.personId);
    const tendency = tendencies.tendencies.get(input.personId);
    if (!rating || !tendency) throw new Error(`${season}: projection missing personId ${input.personId}`);
    const age = finite(bio.age) ? Math.round(bio.age) : Math.round(n(box.age));
    const experience = finite(bio.fromYear) ? Math.max(0, seasonStart(season) - bio.fromYear) : 0;
    const player: Player = {
      id: input.id,
      firstName: bio.firstName ?? (bio.name ?? box.name ?? '').split(' ')[0] ?? '',
      lastName: bio.lastName ?? (bio.name ?? box.name ?? '').split(' ').slice(1).join(' '),
      position: input.position,
      height: finite(bio.heightCm) && bio.heightCm! > 0 ? Math.round(bio.heightCm! / CM_PER_INCH) : 0,
      weight: finite(bio.weightKg) && bio.weightKg! > 0 ? Math.round(bio.weightKg! * KG_TO_LB) : 0,
      age,
      experience,
      teamId: box.teamId === null ? FREE_AGENT_TEAM_ID : `nba_team_${box.teamId}`,
      jerseyNumber: 0,
      ratings: rating,
      potential: derivePotential(rating, age, experience),
      scoutingAccuracy: 0.5,
      tendencies: tendency,
      contract: { type: 'minimum', salarySchedule: [], noTradeClause: false },
      health: { healthy: true },
      careerStats: [],
    };
    const tracking = cache.has('tracking', season) && cache.tracking(season).rows.some((row) => row.personId === input.personId);
    const defense = cache.has('defense', season) && cache.defense(season).rows.some((row) => row.personId === input.personId);
    const hustle = cache.has('hustle', season) && cache.hustle(season).rows.some((row) => row.personId === input.personId);
    const playtypes = cache.has('playtypes', season) && cache.playtypes(season).rows.some((row) => row.personId === input.personId);
    const shotZones = input.shotZoneSeasons.some((entry) => entry.season === season);
    const shotEventsCovered = shotEvents.some((row) => row.playerId === input.personId);
    players.set(input.personId, {
      player,
      input,
      coverage: { box_advanced: true, shot_zones: shotZones, shot_events: shotEventsCovered, playtypes, tracking, defense, hustle, wingspan: finite(bio.wingspanCm) && bio.wingspanCm! > 0 },
      shotMixSource: tendencies.shotMixSource.get(input.personId) ?? 'position_fallback',
    });
  }
  return { season, players, fallbackLog: [...ratings.fallbackLog, ...tendencies.fallbackLog].sort((a, b) => a.playerId.localeCompare(b.playerId) || a.field.localeCompare(b.field) || a.reason.localeCompare(b.reason)) };
}

class ContractCache {
  readonly boxSeasons = listSeasons('box_advanced').filter((season) => season <= LAST_SEASON).sort();
  private readonly files = new Map<string, unknown>();
  private read<T>(contract: string, season: string, loader: (season: string) => { rows: T[] }): { rows: T[] } {
    const key = `${contract}/${season}`;
    const existing = this.files.get(key);
    if (existing) return existing as { rows: T[] };
    const loaded = loader(season);
    this.files.set(key, loaded);
    return loaded;
  }
  has(contract: string, season: string): boolean { return hasNormalizedFile(`${contract}/${season}.json`); }
  box(season: string) { return this.read('box_advanced', season, loadBoxAdvanced); }
  players(season: string) { return this.read('players', season, loadPlayers); }
  shotZones(season: string) { return this.read('shot_zones', season, loadShotZones); }
  shotEvents(season: string) { return this.read('shot_events', season, loadShotEvents); }
  playtypes(season: string) { return this.read('playtypes', season, loadPlayTypes); }
  tracking(season: string) { return this.read('tracking', season, loadTracking); }
  defense(season: string) { return this.read('defense', season, loadDefense); }
  hustle(season: string) { return this.read('hustle', season, loadHustle); }
  lineups(season: string) { return this.read('lineups', season, loadLineups); }
}

function evaluateSeason(season: string, projection: Projection, cache: ContractCache): { rows: EvaluatedLineup[]; summary: SeasonSummary } {
  const rawRows = cache.lineups(season).rows;
  const playerIds = new Set(projection.players.keys());
  const totalPossessions = rawRows.filter((row) => finite(row.possessions) && row.possessions! > 0).reduce((sum, row) => sum + row.possessions!, 0);
  const identityRows = rawRows.filter((row) => Array.isArray(row.personIds) && row.personIds.length === 5 && row.personIds.every((id) => projection.players.has(id)));
  const evaluated: EvaluatedLineup[] = [];
  let spacingEvaluations = 0;
  let spacingSaturated = 0;
  let versatilitySaturated = 0;
  for (const row of rawRows) {
    if (!isUsableLineupRow(row, playerIds)) continue;
    const playerRows = row.personIds.map((id) => projection.players.get(id));
    if (playerRows.some((value) => value === undefined)) continue;
    const five = playerRows.map((value) => value!.player);
    const team = defaultTeam(`historical_${row.teamId ?? 'unknown'}`);
    const mix = productionPlayTypeMix(five, team);
    let weightedSpacing = 0;
    for (const finisher of five) {
      const offBall = five.filter((player) => player.id !== finisher.id);
      const centered = computeSpacing(offBall);
      if (Math.abs(Math.abs(centered) - SPACING_CLAMP) <= CLAMP_EPSILON) spacingSaturated++;
      spacingEvaluations++;
      weightedSpacing += rawOffBallGravity(offBall) * productionFinisherShare(finisher, five, mix);
    }
    const versatility = rawVersatility(five);
    const centeredVersatility = computeVersatility(five);
    if (Math.abs(Math.abs(centeredVersatility) - VERSATILITY_CLAMP) <= CLAMP_EPSILON) versatilitySaturated++;
    evaluated.push({
      season,
      teamId: String(row.teamId ?? 'unknown'),
      ids: [...row.personIds].sort((a, b) => a - b),
      possessions: row.possessions!,
      offRating: row.offRating!,
      defRating: row.defRating!,
      netRating: row.netRating!,
      rawSpacing: weightedSpacing,
      rawVersatility: versatility,
      spacingSaturated: 0,
      versatilitySaturated: false,
    });
  }
  const positiveRows = rawRows.filter((row) => finite(row.possessions) && row.possessions! > 0);
  const usablePossessions = evaluated.reduce((sum, row) => sum + row.possessions, 0);
  const fallbackRates = Object.fromEntries(CONTRACTS.map((contract) => {
    const missing = [...projection.players.values()].filter((player) => !player.coverage[contract]).length;
    return [contract, projection.players.size ? missing / projection.players.size : 1];
  })) as Record<ContractName, number>;
  const shotMixSources = { shot_events: 0, shot_zones: 0, position_fallback: 0 };
  for (const player of projection.players.values()) shotMixSources[player.shotMixSource]++;
  const summary: SeasonSummary = {
    season,
    totalRows: rawRows.length,
    positivePossessions: positiveRows.length,
    usableRows: evaluated.length,
    totalPossessions,
    usablePossessions,
    identityJoinRate: rawRows.length ? identityRows.length / rawRows.length : 0,
    rowCoverage: rawRows.length ? evaluated.length / rawRows.length : 0,
    possessionCoverage: totalPossessions > 0 ? usablePossessions / totalPossessions : 0,
    fallbackRates,
    shotMixSources,
    spacingClampRate: spacingEvaluations ? spacingSaturated / spacingEvaluations : 0,
    versatilityClampRate: evaluated.length ? versatilitySaturated / evaluated.length : 0,
  };
  if (summary.rowCoverage < MIN_COVERAGE || summary.possessionCoverage < MIN_COVERAGE) throw new Error(`${season}: usable lineup coverage below 95% (${pct(summary.rowCoverage)} rows, ${pct(summary.possessionCoverage)} possessions)`);
  return { rows: evaluated.sort((a, b) => a.teamId.localeCompare(b.teamId) || a.ids.join(',').localeCompare(b.ids.join(','))), summary };
}

function createPairs(seasons: readonly { rows: EvaluatedLineup[] }[]): PairObservation[] {
  const pairs: PairObservation[] = [];
  for (const seasonData of seasons) {
    const byTeam = new Map<string, EvaluatedLineup[]>();
    for (const row of seasonData.rows) { const list = byTeam.get(row.teamId) ?? []; list.push(row); byTeam.set(row.teamId, list); }
    for (const [teamId, rows] of [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ordered = rows.slice().sort((a, b) => a.ids.join(',').localeCompare(b.ids.join(',')));
      for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
        const left = ordered[i]; const right = ordered[j];
        const overlap = left.ids.filter((id) => right.ids.includes(id)).length;
        if (overlap !== 4) continue;
        const key = canonicalPairKey(left.season, teamId, left.ids, right.ids);
        pairs.push({
          season: left.season,
          key,
          weight: harmonicMean(left.possessions, right.possessions),
          spacingDelta: right.rawSpacing - left.rawSpacing,
          versatilityDelta: right.rawVersatility - left.rawVersatility,
          combinedDelta: (right.rawSpacing - left.rawSpacing) / SPACING_SPREAD + (right.rawVersatility - left.rawVersatility) / VERSATILITY_SPREAD,
          observedOffDelta: right.offRating - left.offRating,
          observedDefDelta: -(right.defRating - left.defRating),
          observedNetDelta: right.netRating - left.netRating,
          leftPossessions: left.possessions,
          rightPossessions: right.possessions,
        });
      }
    }
  }
  return pairs.sort((a, b) => a.key.localeCompare(b.key));
}

function weightedPearson(xs: readonly number[], ys: readonly number[], ws: readonly number[]): number | null {
  const total = ws.reduce((a, b) => a + b, 0); if (!total || xs.length < 2) return null;
  const mx = xs.reduce((sum, x, i) => sum + x * ws[i], 0) / total; const my = ys.reduce((sum, y, i) => sum + y * ws[i], 0) / total;
  const cov = xs.reduce((sum, x, i) => sum + ws[i] * (x - mx) * (ys[i] - my), 0);
  const vx = xs.reduce((sum, x, i) => sum + ws[i] * (x - mx) ** 2, 0); const vy = ys.reduce((sum, y, i) => sum + ws[i] * (y - my) ** 2, 0);
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
}

function rank(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array<number>(values.length); let i = 0;
  while (i < order.length) { let j = i + 1; while (j < order.length && order[j].value === order[i].value) j++; const r = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) ranks[order[k].index] = r; i = j; }
  return ranks;
}

function fit(xs: readonly number[], ys: readonly number[], ws: readonly number[]): { intercept: number; slope: number } | null {
  const total = ws.reduce((a, b) => a + b, 0); if (!total || xs.length < 2) return null;
  const mx = xs.reduce((sum, x, i) => sum + x * ws[i], 0) / total; const my = ys.reduce((sum, y, i) => sum + y * ws[i], 0) / total;
  const denominator = xs.reduce((sum, x, i) => sum + ws[i] * (x - mx) ** 2, 0); if (denominator <= 0) return null;
  const slope = xs.reduce((sum, x, i) => sum + ws[i] * (x - mx) * (ys[i] - my), 0) / denominator;
  return { intercept: my - slope * mx, slope };
}

function errorStats(model: readonly number[], observed: readonly number[], weights: readonly number[]): { rmse: number | null; mae: number | null } {
  const total = weights.reduce((a, b) => a + b, 0); if (!total) return { rmse: null, mae: null };
  return { rmse: Math.sqrt(model.reduce((sum, x, i) => sum + weights[i] * (x - observed[i]) ** 2, 0) / total), mae: model.reduce((sum, x, i) => sum + weights[i] * Math.abs(x - observed[i]), 0) / total };
}

function loadRegressionBaseline(): RegressionBaseline {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as RegressionBaseline;
  if (baseline.schemaVersion !== 1 || baseline.metric !== 'primary-cohort all-row possession-weighted Pearson correlation' || !finite(baseline.numericalFloor) || baseline.numericalFloor <= 0) {
    throw new Error(`${BASELINE_PATH}: unsupported regression-baseline contract`);
  }
  for (const definition of COMPARISONS) {
    const entry = baseline.comparisons[definition.name];
    if (!entry || ![entry.acceptedPearson, entry.acceptedLosoCorrelationSd, entry.tolerance].every(finite) || entry.tolerance < 0.01) {
      throw new Error(`${BASELINE_PATH}: invalid ${definition.name} baseline entry`);
    }
  }
  return baseline;
}

export function enforceRegressionBaseline(
  name: string,
  currentPearson: number | null,
  acceptedPearson: number,
  tolerance: number,
  numericalFloor: number,
): number {
  const floor = Math.max(numericalFloor, acceptedPearson - tolerance);
  if (currentPearson === null || currentPearson < floor - CLAMP_EPSILON) {
    throw new Error(`${name}: primary Pearson ${fixed(currentPearson)} regressed below frozen floor ${fixed(floor)}`);
  }
  return floor;
}

function metricSummary(pairs: readonly PairObservation[], definition: ComparisonDefinition, cutoff?: number): MetricSummary {
  const selected = pairs.filter((pair) => cutoff === undefined || (pair.leftPossessions >= cutoff && pair.rightPossessions >= cutoff));
  const xs = selected.map(definition.x); const ys = selected.map(definition.y); const ws = selected.map((pair) => pair.weight);
  const modelTies = xs.filter((x) => x === 0).length; const directionRows = selected.filter((pair, i) => ys[i] !== 0);
  const directionCorrect = directionRows.filter((pair) => Math.sign(definition.x(pair)) === Math.sign(definition.y(pair))).length;
  const oofPredictions: number[] = [];
  const oofObserved: number[] = [];
  const oofWeights: number[] = [];
  const losoRows = SEASONS.map((season) => {
    const test = selected.filter((pair) => pair.season === season); const train = selected.filter((pair) => pair.season !== season);
    const tx = test.map(definition.x); const ty = test.map(definition.y); const tw = test.map((pair) => pair.weight);
    const correlation = weightedPearson(tx, ty, tw);
    const model = fit(train.map(definition.x), train.map(definition.y), train.map((pair) => pair.weight));
    const errors = model ? errorStats(tx.map((x) => model.intercept + model.slope * x), ty, tw) : { rmse: null, mae: null };
    if (model) {
      for (let i = 0; i < tx.length; i++) {
        oofPredictions.push(model.intercept + model.slope * tx[i]);
        oofObserved.push(ty[i]);
        oofWeights.push(tw[i]);
      }
    }
    return { season, pairCount: test.length, correlation, rmse: errors.rmse };
  }).filter((row) => row.pairCount > 0);
  const losoCorrs = losoRows.flatMap((row) => row.correlation === null ? [] : [row.correlation]);
  const losoRmse = losoRows.flatMap((row) => row.rmse === null ? [] : [row.rmse]);
  const cvErrors = errorStats(oofPredictions, oofObserved, oofWeights);
  return {
    pairCount: selected.length,
    possessions: selected.reduce((sum, pair) => sum + pair.weight, 0),
    pearson: weightedPearson(xs, ys, ws),
    spearman: weightedPearson(rank(xs), rank(ys), ws),
    directionAccuracy: directionRows.length ? directionCorrect / directionRows.length : null,
    directionCount: directionRows.length,
    modelTieCount: modelTies,
    weightedRmse: cvErrors.rmse,
    weightedMae: cvErrors.mae,
    losoCorrelationMean: mean(losoCorrs),
    losoCorrelationSd: sd(losoCorrs),
    losoCorrelationMin: losoCorrs.length ? Math.min(...losoCorrs) : null,
    losoCorrelationMax: losoCorrs.length ? Math.max(...losoCorrs) : null,
    losoRmseMean: mean(losoRmse),
    losoRmseSd: sd(losoRmse),
    losoRows,
  };
}

function cohortSeasons(name: string): string[] {
  if (name === 'long-run') return SEASONS;
  if (name === 'defense/tracking') return SEASONS.filter((season) => season >= '2013-14');
  return SEASONS.filter((season) => season >= '2015-16');
}

function comparisonMetricRows(pairs: readonly PairObservation[], definition: ComparisonDefinition): { label: string; metric: MetricSummary }[] {
  const cohorts = [
    ['long-run', 'long-run (2007-08 through 2024-25)'],
    ['defense/tracking', 'defense/tracking (2013-14 through 2024-25)'],
    ['hustle-era', 'full hustle-era (2015-16 through 2024-25)'],
  ] as const;
  return cohorts.flatMap(([cohort, label]) => {
    const seasons = new Set(cohortSeasons(cohort));
    const cohortPairs = pairs.filter((pair) => seasons.has(pair.season));
    return [['all rows', undefined], ...MIN_CUTOFFS.map((cutoff) => [`min lineup possessions ${cutoff}`, cutoff] as const)].map(([suffix, cutoff]) => ({ label: `${label} · ${suffix}`, metric: metricSummary(cohortPairs, definition, typeof cutoff === 'number' ? cutoff : undefined) }));
  });
}

function manifestWindowLines(): string[] {
  const manifest = loadManifest();
  const expected = [
    ['box_advanced', 'box_advanced', 1996], ['shot_zones', 'shot_locations', 1996], ['lineups', 'lineups', 2007], ['tracking', 'tracking', 2013], ['defense', 'pt_defend', 2013], ['playtypes', 'synergy', 2015], ['hustle', 'hustle', 2015], ['shot_events', 'shot_charts', 2023],
  ] as const;
  return expected.map(([normalized, declared, start]) => {
    const actual = (manifest.contracts[normalized] ?? []).slice().sort();
    const actualStart = actual[0]?.slice(0, 4) ?? 'absent';
    const actualEnd = actual.at(-1)?.slice(0, 4) ?? 'absent';
    const declaredRange = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'pipeline', 'manifests', 'default.json'), 'utf8')).groups[declared]?.seasons) as { from: number; to: number } | undefined;
    if (!declaredRange || Number(actualStart) !== start || Number(actualEnd) !== declaredRange.to) throw new Error(`manifest window mismatch for ${normalized}: ${actualStart}-${actualEnd}`);
    return `| ${normalized} | ${declaredRange.from}-${declaredRange.to} | ${actualStart}-${actualEnd} |`;
  });
}

function report(seasonSummaries: readonly SeasonSummary[], pairs: readonly PairObservation[], allRows: readonly EvaluatedLineup[]): string {
  const regressionBaseline = loadRegressionBaseline();
  const reportLines: string[] = [];
  reportLines.push('# S3 Lineup Validation', '', 'Deterministic measurement artifact generated by `scripts/validate-lineups.ts`. Historical projections are in-memory and season-as-of; this file contains measurements and provenance only.', '');
  reportLines.push('## Scope and provenance', '', `- Evaluation window: ${FIRST_SEASON} through ${LAST_SEASON}, inclusive; ` + '`lineups/2025-26.json` is excluded as an in-progress season.', '- Historical eligibility population: every player with a `box_advanced` row in the target season; every lineup personId must join that exact population.', '- The projection uses the shared NBA ratings/tendency derivation with recency weights re-keyed to the target season and a full-window anchor at that season.', '- The model uses raw uncentered spacing and versatility for pair deltas. Centering and clamping are measured separately.', '- Pair weights are the harmonic mean of the two lineup possession counts; inputs and canonical pair keys are sorted.', '- CV weighted RMSE/MAE aggregate each held-out season prediction from a fit trained on all other selected seasons; no row is scored by a fit trained on its own season.', '', '### Contract windows', '', '| Contract | Declared default manifest | Live normalized manifest |', '| --- | ---: | ---: |', ...manifestWindowLines(), '', '### Historical fallback policy', '', '- `box_advanced` and `shot_zones` are required throughout the evaluation window.', '- `tracking` and `defense` are absent before 2013-14; `hustle` and `playtypes` are absent before 2015-16. Their historical projections use the derivation’s existing position/global fallback policy and report the missing-input rates below.', '- `shot_events` is absent before 2023-24. In those seasons, shot mix is rescued from `shot_zones`: `rim = rim`, `mid = short_midrange + long_midrange`, `three = corner_three + above_break_three - raw nbaZones.Backcourt`, with the same 100 post-heave-FGA trust threshold and position-group fallback. Backcourt heaves are explicitly removed before the trusted-FGA count.', '- `wingspanCm` remains partial everywhere and uses the existing deterministic roster-population fallback.', '');
  reportLines.push('## Coverage and fallback strata', '', '| Season | Rows | Usable | Row coverage | Positive-possession rows | Total possessions | Usable possessions | Possession coverage | Identity join | box fallback | zones fallback | events fallback | playtypes fallback | tracking fallback | defense fallback | hustle fallback | wingspan fallback | shot mix source (events/zones/fallback) |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const summary of seasonSummaries) {
    const f = summary.fallbackRates;
    reportLines.push(`| ${summary.season} | ${summary.totalRows} | ${summary.usableRows} | ${pct(summary.rowCoverage)} | ${summary.positivePossessions} | ${summary.totalPossessions.toFixed(0)} | ${summary.usablePossessions.toFixed(0)} | ${pct(summary.possessionCoverage)} | ${pct(summary.identityJoinRate)} | ${pct(f.box_advanced)} | ${pct(f.shot_zones)} | ${pct(f.shot_events)} | ${pct(f.playtypes)} | ${pct(f.tracking)} | ${pct(f.defense)} | ${pct(f.hustle)} | ${pct(f.wingspan)} | ${summary.shotMixSources.shot_events}/${summary.shotMixSources.shot_zones}/${summary.shotMixSources.position_fallback} |`);
  }
  reportLines.push('', 'The mechanical usable-row gates are 95% row coverage and 95% positive-possession coverage in every season. The season table is the gate evidence.', '', '### Clamp saturation diagnostic', '', '| Season | finisher evaluations at ±spacing clamp | lineup evaluations at ±versatility clamp |', '| --- | ---: | ---: |');
  for (const summary of seasonSummaries) reportLines.push(`| ${summary.season} | ${pct(summary.spacingClampRate)} | ${pct(summary.versatilityClampRate)} |`);
  reportLines.push('', '## Pair observations and comparison metrics', '', `Usable lineups: ${allRows.length}; usable lineup possessions: ${allRows.reduce((sum, row) => sum + row.possessions, 0).toFixed(0)}; four-of-five pairs: ${pairs.length}.`, '');
  for (const definition of COMPARISONS) {
    reportLines.push(`### ${definition.name}`, '', `Primary cohort: **${definition.primaryCohort}**.`, '', '| Cohort / sensitivity | Pairs | Harmonic possessions | Pearson | Spearman | Direction accuracy | Direction n | Model ties | CV weighted RMSE | CV weighted MAE | LOSO corr mean ± SD | LOSO corr range | LOSO RMSE mean ± SD |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of comparisonMetricRows(pairs, definition)) {
      const m = row.metric;
      reportLines.push(`| ${row.label} | ${m.pairCount} | ${m.possessions.toFixed(2)} | ${fixed(m.pearson)} | ${fixed(m.spearman)} | ${fixed(m.directionAccuracy)} | ${m.directionCount} | ${m.modelTieCount} | ${fixed(m.weightedRmse)} | ${fixed(m.weightedMae)} | ${fixed(m.losoCorrelationMean)} ± ${fixed(m.losoCorrelationSd)} | ${fixed(m.losoCorrelationMin)} to ${fixed(m.losoCorrelationMax)} | ${fixed(m.losoRmseMean)} ± ${fixed(m.losoRmseSd)} |`);
    }
    const baseline = regressionBaseline.comparisons[definition.name];
    const primaryPairs = pairs.filter((pair) => new Set(cohortSeasons(baseline.primaryCohort)).has(pair.season));
    const primary = metricSummary(primaryPairs, definition);
    const regressionFloor = enforceRegressionBaseline(definition.name, primary.pearson, baseline.acceptedPearson, baseline.tolerance, regressionBaseline.numericalFloor);
    reportLines.push('', `Frozen future non-regression tolerance (correlation points): **${fixed(baseline.tolerance)}**; accepted Pearson **${fixed(baseline.acceptedPearson)}**; enforced floor **${fixed(regressionFloor)}**. Tolerance is persisted independently in docs/S3_LINEUP_VALIDATION_BASELINE.json, derived at acceptance as max(0.0100, 2 × accepted primary-cohort LOSO correlation SD), with the fixed numerical floor ${fixed(regressionBaseline.numericalFloor)}.`, '', '| Held-out season | Pair count | Correlation | CV RMSE |', '| --- | ---: | ---: | ---: |');
    for (const heldOut of primary.losoRows) reportLines.push(`| ${heldOut.season} | ${heldOut.pairCount} | ${fixed(heldOut.correlation)} | ${fixed(heldOut.rmse)} |`);
    reportLines.push('');
  }
  reportLines.push('## Projection seam checks', '', '- Season-relative recency weights are keyed to the target season; no input row after the target season is loaded.', '- Production 2025-26 uses the unchanged default derivation options and direct shot-events path; the rescue branch is enabled only when a historical target has no shot-events rows.', '- The production finisher-share mix is shared with `scripts/calibrate-spacing.ts` and includes the unconditional transition share multiplied by `TRANSITION_ELIGIBLE_RATE`.', '- No persisted player field, save shape, active pool, engine constant, or gameplay path is written by this harness.', '');
  return `${reportLines.join('\n')}\n`;
}

function main(): void {
  if (SEASONS.length !== 18) throw new Error(`expected 18 completed lineup seasons, found ${SEASONS.length}`);
  const manifest = loadManifest();
  if (!manifest.complete || manifest.completeness_issues.length > 0) throw new Error('normalized NBA manifest is incomplete');
  const cache = new ContractCache();
  const evaluated: { rows: EvaluatedLineup[]; summary: SeasonSummary }[] = [];
  for (const season of SEASONS) {
    const projection = buildProjection(season, cache);
    evaluated.push(evaluateSeason(season, projection, cache));
  }
  const pairs = createPairs(evaluated);
  const output = report(evaluated.map((value) => value.summary), pairs, evaluated.flatMap((value) => value.rows));
  if (process.argv.includes('--check')) {
    const committed = fs.readFileSync(REPORT_PATH, 'utf8');
    if (committed !== output) throw new Error(`${REPORT_PATH} is stale; regenerate it with node --import tsx scripts/validate-lineups.ts`);
    console.log(`--check OK: ${REPORT_PATH} is byte-identical.`);
    return;
  }
  if (process.argv.includes('--stdout')) {
    process.stdout.write(output);
    return;
  }
  fs.writeFileSync(REPORT_PATH, output);
  console.log(output);
  console.log(`Wrote ${REPORT_PATH}`);
}

if (process.argv[1]?.endsWith('validate-lineups.ts')) main();
