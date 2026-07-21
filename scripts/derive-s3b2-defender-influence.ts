/**
 * S3.b2 — deterministic zone-specific defender-influence derivation.
 *
 * Fits defended FG% suppression on season-as-of perimeter/interior ratings for
 * four disjoint distance bands. Three bands publish runtime weights; long two
 * remains measurement evidence and maps to a separately named legacy fallback.
 * No timestamps or RNG. --check recomputes and byte-compares both outputs.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  hasNormalizedFile,
  listSeasons,
  loadBoxAdvanced,
  loadDefense,
  loadHustle,
  loadManifest,
  loadPlayers,
  loadShotEvents,
  loadShotZones,
  loadTracking,
} from '../src/data/nba/load';
import {
  NBA_POSITION_FALLBACK,
  nbaPrimaryPosition,
} from '../src/data/nba/position-mapping';
import type {
  BoxAdvancedRow,
  DefendedCategoryLine,
  DefenseRow,
  HustleRow,
  NbaPlayerRow,
  ShotEventRow,
  ShotZonesRow,
  TrackingRow,
} from '../src/data/nba/types';
import {
  deriveNbaRatings,
  seasonRelativeNbaDerivationOptions,
  type NbaDerivationInput,
  type NbaDerivationPlayer,
  type ShotEventSeasonAggregate,
} from '../src/ratings/nba-derivation';

const REPORT_PATH = path.join(process.cwd(), 'docs', 'S3B2_DEFENDER_INFLUENCE.md');
const CONSTANTS_PATH = path.join(process.cwd(), 'src', 'engine', 'constants.ts');
const BLOCK_START = '// BEGIN GENERATED S3B2 DEFENDER INFLUENCE';
const BLOCK_END = '// END GENERATED S3B2 DEFENDER INFLUENCE';

const FIRST_SEASON = '2013-14';
const LAST_SEASON = '2024-25';
const IN_PROGRESS_SEASON = '2025-26';
const EARLY_FIRST = '2013-14';
const EARLY_LAST = '2018-19';
const LATE_FIRST = '2019-20';
const LATE_LAST = '2024-25';
const SEASONS = listSeasons('defense')
  .filter((season) => season >= FIRST_SEASON && season <= LAST_SEASON)
  .sort();

const DEFENDED_CATEGORY_KEYS = [
  'overall', 'threePointers', 'twoPointers',
  'lessThan6Ft', 'lessThan10Ft', 'greaterThan15Ft',
] as const;
const BANDS = ['lessThan6', 'sixToTen', 'longTwo', 'threePointers'] as const;
type Band = typeof BANDS[number];
const PUBLISHING_BANDS: readonly Band[] = ['lessThan6', 'sixToTen', 'threePointers'];
const WINDOWS = {
  full: [FIRST_SEASON, LAST_SEASON],
  early: [EARLY_FIRST, EARLY_LAST],
  late: [LATE_FIRST, LATE_LAST],
} as const;
type WindowName = keyof typeof WINDOWS;

// Stored `freq` values are rounded to 0.001. Direct identities can differ by
// half a unit; subtracting two rounded frequencies can differ by one unit.
const DIRECT_FREQ_ROUNDING_TOLERANCE = 0.000_500_001;
const DIFFERENCED_FREQ_ROUNDING_TOLERANCE = 0.001_000_001;
const CI_Z_95 = 1.96;
const REGRESSION_EPSILON = 1e-14;
const DIAGNOSTIC_REPRO_TOLERANCE = 0.000_000_005;
const CONSTANT_DECIMALS = 6;

const LOCKED_DIAGNOSTIC = {
  sourceStdoutSha256: 'c147250bf80c745f700947f92f1585643d8d2cae6ea0fb00269cdd7b47cc448d',
  shortInteriorWeights: {
    full: 0.5895762506083766,
    early: 0.7381715702197313,
    late: 0.4605035061450151,
  },
  longTwoSlopeSumCi95: {
    full: [-0.000027527445939273473, 0.0005121649125958774],
    early: [-0.00009344347064786516, 0.0005607141519460865],
    late: [-0.00014695270130434706, 0.0006414445806878368],
  },
} as const;

interface Drops {
  nonFiniteInput: number;
  negativeAttempts: number;
  zeroAttempts: number;
  invalidDerivedMakes: number;
  invalidDerivedPercentage: number;
}

interface Observation {
  band: Band;
  season: string;
  personId: number;
  perimeterDefense: number;
  interiorDefense: number;
  bandFga: number;
  defendedDelta: number;
}

interface CoverageRow {
  season: string;
  eligiblePlayers: number;
  joinedDefenseRows: number;
  perimeterFallbackEntries: number;
  interiorFallbackEntries: number;
  validByBand: Record<Band, number>;
  attemptsByBand: Record<Band, number>;
  dropsByBand: Record<Band, Drops>;
}

interface CompositionSummary {
  finiteRows: number;
  exactOverallEqualsTwoPlusThree: number;
  greaterThan15AtLeastThree: number;
  positiveLongTwoAttempts: number;
  zeroLongTwoAttempts: number;
  maxDirectFreqError: number;
  maxDifferencedFreqError: number;
  overallFga: number;
  twoFga: number;
  threeFga: number;
  greaterThan15Fga: number;
  longTwoFga: number;
}

interface Fit {
  observations: number;
  clusters: number;
  attempts: number;
  predictorCorrelation: number;
  intercept: number;
  interceptSe: number;
  perimeterCoefficient: number;
  perimeterSe: number;
  interiorCoefficient: number;
  interiorSe: number;
  slopeSum: number;
  slopeSumSe: number;
  slopeSumCi95: readonly [number, number];
  projectedPerimeter: number;
  projectedInterior: number;
  interiorWeight: number | null;
  marginalPerimeter: number;
  marginalInterior: number;
  marginalInteriorWeight: number | null;
}

interface LosoRange {
  perimeterCoefficient: readonly [number, number];
  interiorCoefficient: readonly [number, number];
  slopeSum: readonly [number, number];
  slopeSumCiLower: readonly [number, number];
  slopeSumCiUpper: readonly [number, number];
  interiorWeight: readonly [number, number] | null;
}

interface Derivation {
  coverage: CoverageRow[];
  categoryFiniteCoverage: Record<string, { rows: number; finiteAllFields: number }>;
  composition: CompositionSummary;
  observations: Observation[];
  fits: Record<WindowName, Record<Band, Fit>>;
  loso: Record<Band, LosoRange>;
  derivedWeights: {
    rim: number;
    shortMidrange: number;
    sharedThree: number;
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function emptyDrops(): Drops {
  return {
    nonFiniteInput: 0,
    negativeAttempts: 0,
    zeroAttempts: 0,
    invalidDerivedMakes: 0,
    invalidDerivedPercentage: 0,
  };
}

function emptyBandRecord<T>(make: () => T): Record<Band, T> {
  return Object.fromEntries(BANDS.map((band) => [band, make()])) as Record<Band, T>;
}

function seasonStart(season: string): number {
  return Number.parseInt(season.slice(0, 4), 10);
}

function seasonFromStart(start: number): string {
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function targetRecentSeasons(target: string): string[] {
  const start = seasonStart(target);
  return [0, 1, 2].map((offset) => seasonFromStart(start - offset));
}

function classifyShotEvent(
  row: ShotEventRow,
): keyof Omit<ShotEventSeasonAggregate, 'season'> | 'heave' | 'covered_by_shot_zones' {
  if (row.shotZoneBasic === null || row.shotDistance === null) {
    throw new Error(`shot_events ${row.gameId}/${row.gameEventId} lacks shotZoneBasic or shotDistance`);
  }
  const seconds = row.minutesRemaining * 60 + row.secondsRemaining;
  if (row.shotZoneBasic === 'Backcourt' || (row.shotDistance >= 32 && seconds <= 3)) return 'heave';
  switch (row.shotZoneBasic) {
    case 'Restricted Area':
    case 'In The Paint (Non-RA)':
    case 'Left Corner 3':
    case 'Right Corner 3':
      return 'covered_by_shot_zones';
    case 'Mid-Range':
      return row.shotDistance < 14 ? 'midrangeUnder14' : 'longMidrange';
    case 'Above the Break 3':
      return row.shotDistance >= 27 ? 'deepThree' : 'aboveBreakThree';
    default:
      throw new Error(`shot_events ${row.gameId}/${row.gameEventId} has unknown zone ${row.shotZoneBasic}`);
  }
}

function emptyShotAggregate(season: string): ShotEventSeasonAggregate {
  const zone = () => ({ fgm: 0, fga: 0 });
  return {
    season,
    midrangeUnder14: zone(),
    longMidrange: zone(),
    aboveBreakThree: zone(),
    deepThree: zone(),
  };
}

function aggregateShotEvents(rows: readonly ShotEventRow[], season: string): Map<number, ShotEventSeasonAggregate> {
  const byPerson = new Map<number, ShotEventSeasonAggregate>();
  for (const row of rows) {
    const kind = classifyShotEvent(row);
    if (kind === 'heave' || kind === 'covered_by_shot_zones') continue;
    const aggregate = byPerson.get(row.playerId) ?? emptyShotAggregate(season);
    aggregate[kind].fga++;
    if (row.made) aggregate[kind].fgm++;
    byPerson.set(row.playerId, aggregate);
  }
  return byPerson;
}

class ContractCache {
  readonly boxSeasons = listSeasons('box_advanced').filter((season) => season <= LAST_SEASON).sort();
  private readonly files = new Map<string, unknown>();

  private read<T>(contract: string, season: string, loader: (value: string) => { rows: T[] }): { rows: T[] } {
    const key = `${contract}/${season}`;
    const cached = this.files.get(key);
    if (cached !== undefined) return cached as { rows: T[] };
    const loaded = loader(season);
    this.files.set(key, loaded);
    return loaded;
  }

  has(contract: string, season: string): boolean {
    return hasNormalizedFile(`${contract}/${season}.json`);
  }

  box(season: string) { return this.read<BoxAdvancedRow>('box_advanced', season, loadBoxAdvanced); }
  defense(season: string) { return this.read<DefenseRow>('defense', season, loadDefense); }
  hustle(season: string) { return this.read<HustleRow>('hustle', season, loadHustle); }
  players(season: string) { return this.read<NbaPlayerRow>('players', season, loadPlayers); }
  shotEvents(season: string) { return this.read<ShotEventRow>('shot_events', season, loadShotEvents); }
  shotZones(season: string) { return this.read<ShotZonesRow>('shot_zones', season, loadShotZones); }
  tracking(season: string) { return this.read<TrackingRow>('tracking', season, loadTracking); }
}

function buildSeasonRatings(season: string, cache: ContractCache) {
  const options = seasonRelativeNbaDerivationOptions(season);
  const boxRows = cache.box(season).rows;
  const bioByPerson = new Map(cache.players(season).rows.map((row) => [row.personId, row]));
  const defenseByPerson = new Map(cache.defense(season).rows.map((row) => [row.personId, row]));
  const trackingByPerson = new Map(
    cache.has('tracking', season) ? cache.tracking(season).rows.map((row) => [row.personId, row] as const) : [],
  );
  const hustleByPerson = new Map(
    cache.has('hustle', season) ? cache.hustle(season).rows.map((row) => [row.personId, row] as const) : [],
  );

  const boxByPerson = new Map<number, { season: string; row: BoxAdvancedRow }[]>();
  for (const historicalSeason of cache.boxSeasons.filter((candidate) => candidate <= season)) {
    for (const row of cache.box(historicalSeason).rows) {
      const entries = boxByPerson.get(row.personId) ?? [];
      entries.push({ season: historicalSeason, row });
      boxByPerson.set(row.personId, entries);
    }
  }

  const recentSeasons = targetRecentSeasons(season).filter((candidate) => candidate >= '1996-97');
  const shotZonesByPerson = new Map<number, { season: string; row: ShotZonesRow }[]>();
  for (const recentSeason of recentSeasons) {
    if (!cache.has('shot_zones', recentSeason)) continue;
    for (const row of cache.shotZones(recentSeason).rows) {
      const entries = shotZonesByPerson.get(row.personId) ?? [];
      entries.push({ season: recentSeason, row });
      shotZonesByPerson.set(row.personId, entries);
    }
  }

  const shotEventsBySeason = new Map<string, Map<number, ShotEventSeasonAggregate>>();
  for (const recentSeason of options.recentSeasons) {
    if (cache.has('shot_events', recentSeason)) {
      shotEventsBySeason.set(recentSeason, aggregateShotEvents(cache.shotEvents(recentSeason).rows, recentSeason));
    }
  }

  const inputs: NbaDerivationPlayer[] = [...boxRows]
    .sort((a, b) => a.personId - b.personId)
    .map((box) => {
      const bio = bioByPerson.get(box.personId);
      if (!bio) throw new Error(`${season}: eligible box player ${box.personId} has no same-season bio`);
      return {
        personId: box.personId,
        id: `nba_${box.personId}`,
        position: nbaPrimaryPosition(bio.position) ?? NBA_POSITION_FALLBACK,
        heightCm: bio.heightCm,
        weightKg: bio.weightKg,
        wingspanCm: bio.wingspanCm,
        boxSeasons: boxByPerson.get(box.personId) ?? [],
        shotZoneSeasons: shotZonesByPerson.get(box.personId) ?? [],
        shotEventSeasons: options.recentSeasons.flatMap((recentSeason) => {
          const aggregate = shotEventsBySeason.get(recentSeason)?.get(box.personId);
          return aggregate ? [aggregate] : [];
        }),
        tracking: trackingByPerson.get(box.personId),
        defense: defenseByPerson.get(box.personId),
        hustle: hustleByPerson.get(box.personId),
      };
    });

  const input: NbaDerivationInput = {
    players: inputs,
    rosteredPersonIds: new Set(inputs.map((player) => player.personId)),
  };
  const result = deriveNbaRatings(input, options);
  return { eligiblePlayers: inputs.length, defenseByPerson, result };
}

function directBand(line: DefendedCategoryLine | undefined, drops: Drops): { fga: number; delta: number } | undefined {
  if (!line || !finite(line.dFga) || !finite(line.dFgm) || !finite(line.dFgPct) || !finite(line.normalFgPct)) {
    drops.nonFiniteInput++;
    return undefined;
  }
  if (line.dFga < 0) {
    drops.negativeAttempts++;
    return undefined;
  }
  if (line.dFga === 0) {
    drops.zeroAttempts++;
    return undefined;
  }
  if (line.dFgm < 0 || line.dFgm > line.dFga) {
    drops.invalidDerivedMakes++;
    return undefined;
  }
  if (line.dFgPct < 0 || line.dFgPct > 1 || line.normalFgPct < 0 || line.normalFgPct > 1) {
    drops.invalidDerivedPercentage++;
    return undefined;
  }
  return { fga: line.dFga, delta: line.normalFgPct - line.dFgPct };
}

function differencedBand(
  outer: DefendedCategoryLine | undefined,
  inner: DefendedCategoryLine | undefined,
  drops: Drops,
): { fga: number; delta: number } | undefined {
  const inputs = [
    outer?.dFga, outer?.dFgm, outer?.normalFgPct,
    inner?.dFga, inner?.dFgm, inner?.normalFgPct,
  ];
  if (!inputs.every(finite)) {
    drops.nonFiniteInput++;
    return undefined;
  }
  const outerFga = outer!.dFga!;
  const innerFga = inner!.dFga!;
  const bandFga = outerFga - innerFga;
  if (bandFga < 0) {
    drops.negativeAttempts++;
    return undefined;
  }
  if (bandFga === 0) {
    drops.zeroAttempts++;
    return undefined;
  }
  const defendedMakes = outer!.dFgm! - inner!.dFgm!;
  const normalMakes = outerFga * outer!.normalFgPct! - innerFga * inner!.normalFgPct!;
  if (!finite(defendedMakes) || !finite(normalMakes) || defendedMakes < 0 || normalMakes < 0) {
    drops.invalidDerivedMakes++;
    return undefined;
  }
  const defendedPct = defendedMakes / bandFga;
  const normalPct = normalMakes / bandFga;
  if (!finite(defendedPct) || !finite(normalPct)
    || defendedPct < 0 || defendedPct > 1 || normalPct < 0 || normalPct > 1) {
    drops.invalidDerivedPercentage++;
    return undefined;
  }
  return { fga: bandFga, delta: normalPct - defendedPct };
}

function zeros(length: number): number[] {
  return Array.from({ length }, () => 0);
}

function zeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => zeros(size));
}

function inverse(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...zeros(size).map((_, columnIndex) => rowIndex === columnIndex ? 1 : 0),
  ]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < REGRESSION_EPSILON) {
      throw new Error('S3.b2 regression matrix is singular');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const scale = augmented[column][column];
    augmented[column] = augmented[column].map((value) => value / scale);
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      augmented[row] = augmented[row].map((value, index) => value - factor * augmented[column][index]);
    }
  }
  return augmented.map((row) => row.slice(size));
}

function multiply(left: readonly (readonly number[])[], right: readonly (readonly number[])[]): number[][] {
  return left.map((row) => right[0].map((_, column) => (
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)
  )));
}

function matrixVector(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function marginalSlope(rows: readonly Observation[], field: 'perimeterDefense' | 'interiorDefense'): number {
  const totalWeight = rows.reduce((sum, row) => sum + row.bandFga, 0);
  const meanX = rows.reduce((sum, row) => sum + row.bandFga * (row[field] - 40), 0) / totalWeight;
  const meanY = rows.reduce((sum, row) => sum + row.bandFga * row.defendedDelta, 0) / totalWeight;
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const centeredX = row[field] - 40 - meanX;
    numerator += row.bandFga * centeredX * (row.defendedDelta - meanY);
    denominator += row.bandFga * centeredX * centeredX;
  }
  if (denominator <= REGRESSION_EPSILON) throw new Error('S3.b2 marginal regression is degenerate');
  return numerator / denominator;
}

function weightedCorrelation(rows: readonly Observation[]): number {
  const totalWeight = rows.reduce((sum, row) => sum + row.bandFga, 0);
  const meanPerimeter = rows.reduce((sum, row) => sum + row.bandFga * row.perimeterDefense, 0) / totalWeight;
  const meanInterior = rows.reduce((sum, row) => sum + row.bandFga * row.interiorDefense, 0) / totalWeight;
  let covariance = 0;
  let perimeterVariance = 0;
  let interiorVariance = 0;
  for (const row of rows) {
    const perimeterDelta = row.perimeterDefense - meanPerimeter;
    const interiorDelta = row.interiorDefense - meanInterior;
    covariance += row.bandFga * perimeterDelta * interiorDelta;
    perimeterVariance += row.bandFga * perimeterDelta * perimeterDelta;
    interiorVariance += row.bandFga * interiorDelta * interiorDelta;
  }
  return covariance / Math.sqrt(perimeterVariance * interiorVariance);
}

function fit(rows: readonly Observation[]): Fit {
  if (rows.length <= 3) throw new Error('S3.b2 fit has too few observations');
  const size = 3;
  const bread = zeroMatrix(size);
  const rhs = zeros(size);
  for (const row of rows) {
    const x = [1, row.perimeterDefense - 40, row.interiorDefense - 40];
    for (let left = 0; left < size; left++) {
      rhs[left] += row.bandFga * x[left] * row.defendedDelta;
      for (let right = 0; right < size; right++) {
        bread[left][right] += row.bandFga * x[left] * x[right];
      }
    }
  }
  const breadInverse = inverse(bread);
  const coefficients = matrixVector(breadInverse, rhs);
  const clusterScores = new Map<number, number[]>();
  for (const row of rows) {
    const x = [1, row.perimeterDefense - 40, row.interiorDefense - 40];
    const residual = row.defendedDelta
      - x.reduce((sum, value, index) => sum + value * coefficients[index], 0);
    const score = clusterScores.get(row.personId) ?? zeros(size);
    for (let index = 0; index < size; index++) score[index] += row.bandFga * x[index] * residual;
    clusterScores.set(row.personId, score);
  }
  const meat = zeroMatrix(size);
  for (const score of clusterScores.values()) {
    for (let left = 0; left < size; left++) {
      for (let right = 0; right < size; right++) meat[left][right] += score[left] * score[right];
    }
  }
  const clusters = clusterScores.size;
  if (clusters <= 1) throw new Error('S3.b2 clustered covariance has fewer than two clusters');
  const correction = (clusters / (clusters - 1)) * ((rows.length - 1) / (rows.length - size));
  const covariance = multiply(multiply(breadInverse, meat), breadInverse)
    .map((row) => row.map((value) => value * correction));
  const standardErrors = coefficients.map((_, index) => Math.sqrt(Math.max(0, covariance[index][index])));
  const slopeSum = coefficients[1] + coefficients[2];
  const slopeSumSe = Math.sqrt(Math.max(
    0,
    covariance[1][1] + covariance[2][2] + 2 * covariance[1][2],
  ));
  const projectedPerimeter = Math.max(0, coefficients[1]);
  const projectedInterior = Math.max(0, coefficients[2]);
  const projectedTotal = projectedPerimeter + projectedInterior;
  const marginalPerimeter = marginalSlope(rows, 'perimeterDefense');
  const marginalInterior = marginalSlope(rows, 'interiorDefense');
  const marginalTotal = Math.max(0, marginalPerimeter) + Math.max(0, marginalInterior);
  return {
    observations: rows.length,
    clusters,
    attempts: rows.reduce((sum, row) => sum + row.bandFga, 0),
    predictorCorrelation: weightedCorrelation(rows),
    intercept: coefficients[0],
    interceptSe: standardErrors[0],
    perimeterCoefficient: coefficients[1],
    perimeterSe: standardErrors[1],
    interiorCoefficient: coefficients[2],
    interiorSe: standardErrors[2],
    slopeSum,
    slopeSumSe,
    slopeSumCi95: [slopeSum - CI_Z_95 * slopeSumSe, slopeSum + CI_Z_95 * slopeSumSe],
    projectedPerimeter,
    projectedInterior,
    interiorWeight: projectedTotal > 0 ? projectedInterior / projectedTotal : null,
    marginalPerimeter,
    marginalInterior,
    marginalInteriorWeight: marginalTotal > 0 ? Math.max(0, marginalInterior) / marginalTotal : null,
  };
}

function minMax(values: readonly number[]): readonly [number, number] {
  if (values.length === 0) throw new Error('S3.b2 cannot summarize an empty range');
  return [Math.min(...values), Math.max(...values)];
}

function losoRange(rows: readonly Observation[], band: Band): LosoRange {
  const fits = SEASONS.map((heldOut) => fit(rows.filter((row) => row.band === band && row.season !== heldOut)));
  const weights = fits.flatMap((value) => value.interiorWeight === null ? [] : [value.interiorWeight]);
  return {
    perimeterCoefficient: minMax(fits.map((value) => value.perimeterCoefficient)),
    interiorCoefficient: minMax(fits.map((value) => value.interiorCoefficient)),
    slopeSum: minMax(fits.map((value) => value.slopeSum)),
    slopeSumCiLower: minMax(fits.map((value) => value.slopeSumCi95[0])),
    slopeSumCiUpper: minMax(fits.map((value) => value.slopeSumCi95[1])),
    interiorWeight: weights.length === fits.length ? minMax(weights) : null,
  };
}

function compositionSummary(cache: ContractCache): CompositionSummary {
  const summary: CompositionSummary = {
    finiteRows: 0,
    exactOverallEqualsTwoPlusThree: 0,
    greaterThan15AtLeastThree: 0,
    positiveLongTwoAttempts: 0,
    zeroLongTwoAttempts: 0,
    maxDirectFreqError: 0,
    maxDifferencedFreqError: 0,
    overallFga: 0,
    twoFga: 0,
    threeFga: 0,
    greaterThan15Fga: 0,
    longTwoFga: 0,
  };
  for (const season of SEASONS) {
    for (const row of cache.defense(season).rows) {
      const { overall, twoPointers, threePointers, greaterThan15Ft } = row.defended;
      if (![overall?.dFga, twoPointers?.dFga, threePointers?.dFga, greaterThan15Ft?.dFga].every(finite)) continue;
      const overallFga = overall.dFga!;
      const twoFga = twoPointers.dFga!;
      const threeFga = threePointers.dFga!;
      const greaterFga = greaterThan15Ft.dFga!;
      summary.finiteRows++;
      if (overallFga === twoFga + threeFga) summary.exactOverallEqualsTwoPlusThree++;
      if (greaterFga >= threeFga) summary.greaterThan15AtLeastThree++;
      if (greaterFga - threeFga > 0) summary.positiveLongTwoAttempts++;
      if (greaterFga - threeFga === 0) summary.zeroLongTwoAttempts++;
      summary.overallFga += overallFga;
      summary.twoFga += twoFga;
      summary.threeFga += threeFga;
      summary.greaterThan15Fga += greaterFga;
      summary.longTwoFga += greaterFga - threeFga;
      for (const line of [twoPointers, threePointers, greaterThan15Ft]) {
        if (overallFga > 0 && finite(line.freq)) {
          summary.maxDirectFreqError = Math.max(
            summary.maxDirectFreqError,
            Math.abs(line.dFga! / overallFga - line.freq),
          );
        }
      }
      if (overallFga > 0 && finite(greaterThan15Ft.freq) && finite(threePointers.freq)) {
        summary.maxDifferencedFreqError = Math.max(
          summary.maxDifferencedFreqError,
          Math.abs((greaterFga - threeFga) / overallFga - (greaterThan15Ft.freq - threePointers.freq)),
        );
      }
    }
  }
  if (summary.finiteRows === 0) throw new Error('S3.b2 composition check has no finite rows');
  if (summary.exactOverallEqualsTwoPlusThree !== summary.finiteRows) {
    throw new Error('S3.b2 composition check failed: overall FGA != twoPointers + threePointers');
  }
  if (summary.greaterThan15AtLeastThree !== summary.finiteRows) {
    throw new Error('S3.b2 composition check failed: greaterThan15Ft does not consistently include threes');
  }
  if (summary.maxDirectFreqError > DIRECT_FREQ_ROUNDING_TOLERANCE) {
    throw new Error(`S3.b2 direct freq identity exceeds ${DIRECT_FREQ_ROUNDING_TOLERANCE}`);
  }
  if (summary.maxDifferencedFreqError > DIFFERENCED_FREQ_ROUNDING_TOLERANCE) {
    throw new Error(`S3.b2 differenced freq identity exceeds ${DIFFERENCED_FREQ_ROUNDING_TOLERANCE}`);
  }
  return summary;
}

function assertCategoryVocabulary(cache: ContractCache) {
  const expected = new Set<string>(DEFENDED_CATEGORY_KEYS);
  const observed = new Set<string>();
  const finiteCoverage = Object.fromEntries(DEFENDED_CATEGORY_KEYS.map((key) => [
    key,
    { rows: 0, finiteAllFields: 0 },
  ])) as Record<string, { rows: number; finiteAllFields: number }>;
  for (const season of SEASONS) {
    for (const row of cache.defense(season).rows) {
      for (const key of Object.keys(row.defended).sort()) {
        observed.add(key);
        if (!expected.has(key)) throw new Error(`${season}: unexpected defended category ${key}`);
        const line = row.defended[key];
        finiteCoverage[key].rows++;
        if ([line.dFga, line.dFgm, line.dFgPct, line.normalFgPct].every(finite)) {
          finiteCoverage[key].finiteAllFields++;
        }
      }
    }
  }
  const actual = [...observed].sort();
  const locked = [...DEFENDED_CATEGORY_KEYS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(locked)) {
    throw new Error(`S3.b2 defended category vocabulary mismatch: ${actual.join(', ')}`);
  }
  return finiteCoverage;
}

function close(actual: number, expected: number, tolerance = DIAGNOSTIC_REPRO_TOLERANCE): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function enforceGates(fits: Derivation['fits']): void {
  for (const window of Object.keys(WINDOWS) as WindowName[]) {
    for (const band of PUBLISHING_BANDS) {
      const result = fits[window][band];
      if (result.perimeterCoefficient <= 0 && result.interiorCoefficient <= 0) {
        throw new Error(`S3.b2 ${window}/${band}: both joint slopes are non-positive`);
      }
      if (result.slopeSum <= 0 || result.slopeSumCi95[0] <= 0) {
        throw new Error(`S3.b2 ${window}/${band}: clustered 95% slope-sum CI includes zero`);
      }
      if (result.interiorWeight === null || result.interiorWeight < 0 || result.interiorWeight > 1) {
        throw new Error(`S3.b2 ${window}/${band}: invalid projected interior weight`);
      }
    }
    const rimWeight = fits[window].lessThan6.interiorWeight!;
    const threeWeight = fits[window].threePointers.interiorWeight!;
    if (rimWeight <= 0.5) throw new Error(`S3.b2 ${window}: rim structural prior inverted`);
    if (threeWeight >= 0.5) throw new Error(`S3.b2 ${window}: shared-3PT structural prior inverted`);

    const longTwo = fits[window].longTwo;
    if (!(longTwo.slopeSumCi95[0] <= 0 && longTwo.slopeSumCi95[1] >= 0)) {
      throw new Error(`S3.b2 ${window}/longTwo no longer reproduces the authorized zero-crossing CI`);
    }
    const lockedCi = LOCKED_DIAGNOSTIC.longTwoSlopeSumCi95[window];
    if (!close(longTwo.slopeSumCi95[0], lockedCi[0]) || !close(longTwo.slopeSumCi95[1], lockedCi[1])) {
      throw new Error(`S3.b2 ${window}/longTwo differs from the locked read-only diagnostic`);
    }
    if (!close(fits[window].sixToTen.interiorWeight!, LOCKED_DIAGNOSTIC.shortInteriorWeights[window])) {
      throw new Error(`S3.b2 ${window}/sixToTen differs from the locked read-only diagnostic`);
    }
  }
}

function derive(): Derivation {
  if (SEASONS.length !== 12 || SEASONS[0] !== FIRST_SEASON || SEASONS.at(-1) !== LAST_SEASON) {
    throw new Error(`S3.b2 expected 12 completed defense seasons ${FIRST_SEASON}..${LAST_SEASON}; found ${SEASONS.join(', ')}`);
  }
  if (SEASONS.includes(IN_PROGRESS_SEASON)) throw new Error('S3.b2 fitting window includes in-progress 2025-26');
  const manifest = loadManifest();
  if (!manifest.complete || manifest.completeness_issues.length > 0) {
    throw new Error('S3.b2 normalized NBA manifest is incomplete');
  }

  const cache = new ContractCache();
  const categoryFiniteCoverage = assertCategoryVocabulary(cache);
  const composition = compositionSummary(cache);
  const observations: Observation[] = [];
  const coverage: CoverageRow[] = [];

  for (const season of SEASONS) {
    const projection = buildSeasonRatings(season, cache);
    const validByBand = emptyBandRecord(() => 0);
    const attemptsByBand = emptyBandRecord(() => 0);
    const dropsByBand = emptyBandRecord(emptyDrops);
    let joinedDefenseRows = 0;
    for (const [personId, ratings] of [...projection.result.ratingsByPerson.entries()].sort((a, b) => a[0] - b[0])) {
      const defense = projection.defenseByPerson.get(personId);
      if (!defense) {
        for (const band of BANDS) dropsByBand[band].nonFiniteInput++;
        continue;
      }
      joinedDefenseRows++;
      const defended = defense.defended;
      const bandValues: Record<Band, { fga: number; delta: number } | undefined> = {
        lessThan6: directBand(defended.lessThan6Ft, dropsByBand.lessThan6),
        sixToTen: differencedBand(defended.lessThan10Ft, defended.lessThan6Ft, dropsByBand.sixToTen),
        longTwo: differencedBand(defended.greaterThan15Ft, defended.threePointers, dropsByBand.longTwo),
        threePointers: directBand(defended.threePointers, dropsByBand.threePointers),
      };
      for (const band of BANDS) {
        const value = bandValues[band];
        if (!value) continue;
        validByBand[band]++;
        attemptsByBand[band] += value.fga;
        observations.push({
          band,
          season,
          personId,
          perimeterDefense: ratings.perimeterDefense,
          interiorDefense: ratings.interiorDefense,
          bandFga: value.fga,
          defendedDelta: value.delta,
        });
      }
    }
    const perimeterFallbackEntries = projection.result.fallbackLog
      .filter((entry) => entry.field.startsWith('perimeterDefense.')).length;
    const interiorFallbackEntries = projection.result.fallbackLog
      .filter((entry) => entry.field.startsWith('interiorDefense.')).length;
    coverage.push({
      season,
      eligiblePlayers: projection.eligiblePlayers,
      joinedDefenseRows,
      perimeterFallbackEntries,
      interiorFallbackEntries,
      validByBand,
      attemptsByBand,
      dropsByBand,
    });
  }

  const fits = {} as Derivation['fits'];
  for (const [window, [first, last]] of Object.entries(WINDOWS) as [WindowName, readonly [string, string]][]) {
    fits[window] = {} as Record<Band, Fit>;
    for (const band of BANDS) {
      fits[window][band] = fit(observations.filter((row) => (
        row.band === band && row.season >= first && row.season <= last
      )));
    }
  }
  enforceGates(fits);

  const loso = Object.fromEntries(BANDS.map((band) => [band, losoRange(observations, band)])) as Record<Band, LosoRange>;
  const derivedWeights = {
    rim: fits.full.lessThan6.interiorWeight!,
    shortMidrange: fits.full.sixToTen.interiorWeight!,
    sharedThree: fits.full.threePointers.interiorWeight!,
  };
  return { coverage, categoryFiniteCoverage, composition, observations, fits, loso, derivedWeights };
}

function fixed(value: number, digits = 6): string {
  return value.toFixed(digits);
}

function probability(value: number): string {
  return value.toFixed(8);
}

function range(value: readonly [number, number], render = probability): string {
  return `${render(value[0])} to ${render(value[1])}`;
}

function dropTotal(drops: Drops): number {
  return drops.nonFiniteInput + drops.negativeAttempts + drops.zeroAttempts
    + drops.invalidDerivedMakes + drops.invalidDerivedPercentage;
}

function renderReport(result: Derivation): string {
  const composition = result.composition;
  const lines = [
    '# S3.b2 Defender Influence Derivation',
    '',
    'Deterministic measurements and provenance generated by `scripts/derive-s3b2-defender-influence.ts`. Decision status and interpretation live in `docs/ROADMAP.md` and `docs/PROJECT_STATUS.md`.',
    '',
    '## Scope and method',
    '',
    `- Completed fitting window: ${FIRST_SEASON} through ${LAST_SEASON}, inclusive; ${IN_PROGRESS_SEASON} is excluded as in progress.`,
    `- Predeclared primary window: ${FIRST_SEASON} through ${LAST_SEASON}; sensitivities: ${EARLY_FIRST} through ${EARLY_LAST} and ${LATE_FIRST} through ${LATE_LAST}.`,
    '- One observation is one player-season defended-band row. Historical ratings use the shared `deriveNbaRatings` path with season-relative recency weights/full-window anchor, the target-season `box_advanced` eligibility population, and no input after the target season.',
    '- Outcome sign: `normalFgPct - dFgPct`; positive means the defender suppresses FG%. `pctPlusMinus` has the opposite sign and is not fitted.',
    '- Joint WLS includes an intercept and centered predictors (`perimeterDefense - 40`, `interiorDefense - 40`), weighted by reconstructed band FGA.',
    `- Primary uncertainty: personId-clustered CR1 sandwich covariance with normal ${CI_Z_95.toFixed(2)} critical value for a 95% confidence interval.`,
    '- Negative joint slopes are projected to zero only when forming an eligible runtime ratio. The unprojected coefficients and slope-sum interval remain the identification evidence.',
    `- Locked read-only diagnostic stdout SHA-256: \`${LOCKED_DIAGNOSTIC.sourceStdoutSha256}\`.`,
    '',
    '## Defended-category vocabulary and composition',
    '',
    `Observed vocabulary is exactly: ${DEFENDED_CATEGORY_KEYS.map((key) => `\`${key}\``).join(', ')}.`,
    '',
    '| Category | Present rows | Finite dFga/dFgm/dFgPct/normalFgPct |',
    '| --- | ---: | ---: |',
    ...DEFENDED_CATEGORY_KEYS.map((key) => {
      const coverage = result.categoryFiniteCoverage[key];
      return `| ${key} | ${coverage.rows} | ${coverage.finiteAllFields} |`;
    }),
    '',
    `Composition rows with finite overall/2PT/3PT/>15 FGA: ${composition.finiteRows}.`,
    '',
    '| Check | Result |',
    '| --- | ---: |',
    `| exact overall FGA = 2PT FGA + 3PT FGA | ${composition.exactOverallEqualsTwoPlusThree}/${composition.finiteRows} |`,
    `| >15 FGA >= 3PT FGA | ${composition.greaterThan15AtLeastThree}/${composition.finiteRows} |`,
    `| positive reconstructed long-two attempts | ${composition.positiveLongTwoAttempts} |`,
    `| zero reconstructed long-two attempts | ${composition.zeroLongTwoAttempts} |`,
    `| maximum direct freq identity error (tolerance ${DIRECT_FREQ_ROUNDING_TOLERANCE}) | ${composition.maxDirectFreqError.toFixed(9)} |`,
    `| maximum differenced freq identity error (tolerance ${DIFFERENCED_FREQ_ROUNDING_TOLERANCE}) | ${composition.maxDifferencedFreqError.toFixed(9)} |`,
    '',
    `Aggregate FGA: overall ${composition.overallFga}; 2PT ${composition.twoFga}; 3PT ${composition.threeFga}; >15 ${composition.greaterThan15Fga}; reconstructed long two ${composition.longTwoFga}. The exact counts and frequency identities show that \`greaterThan15Ft\` includes threes, so long two is reconstructed as \`greaterThan15Ft - threePointers\`.`,
    '',
    '## Eligibility, joins, fallback logs, and exclusions',
    '',
    '| Season | Eligible | Defense join | Perim fallback entries | Interior fallback entries | <6 valid/FGA/drops | 6–10 valid/FGA/drops | long-two valid/FGA/drops | 3PT valid/FGA/drops |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.coverage.map((row) => {
      const cell = (band: Band) => `${row.validByBand[band]}/${row.attemptsByBand[band].toFixed(0)}/${dropTotal(row.dropsByBand[band])}`;
      return `| ${row.season} | ${row.eligiblePlayers} | ${row.joinedDefenseRows} | ${row.perimeterFallbackEntries} | ${row.interiorFallbackEntries} | ${cell('lessThan6')} | ${cell('sixToTen')} | ${cell('longTwo')} | ${cell('threePointers')} |`;
    }),
    '',
    'Each band cell is `valid player-seasons / effective attempts / excluded player-seasons`. Fallback columns count shared-derivation low-sample/substitution log entries for the two defensive ratings.',
    '',
    '### Exclusion reasons by season and differenced band',
    '',
    '| Season | Band | Non-finite input | Negative attempts | Zero attempts | Invalid derived makes | Invalid derived percentage |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...result.coverage.flatMap((row) => (['sixToTen', 'longTwo'] as const).map((band) => {
      const drops = row.dropsByBand[band];
      return `| ${row.season} | ${band === 'sixToTen' ? '6–10ft' : 'long two'} | ${drops.nonFiniteInput} | ${drops.negativeAttempts} | ${drops.zeroAttempts} | ${drops.invalidDerivedMakes} | ${drops.invalidDerivedPercentage} |`;
    })),
    '',
    '## Joint fits and marginal sensitivity',
    '',
    'Coefficients use defended-FG probability points per rating point. `Interior weight` is the non-negative-projected joint ratio; `Marginal weight` uses the two separate one-predictor WLS slopes on the same observations and weights.',
    '',
    '| Window | Band | Obs | Clusters | FGA | Predictor r | Intercept ± SE | Perimeter β ± SE | Interior β ± SE | Slope-sum 95% CI | Interior weight | Marginal weight |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const window of Object.keys(WINDOWS) as WindowName[]) {
    for (const band of BANDS) {
      const fitResult = result.fits[window][band];
      const publishedJointWeight = band === 'longTwo' || fitResult.interiorWeight === null
        ? '—'
        : fixed(fitResult.interiorWeight);
      lines.push(`| ${window} | ${band} | ${fitResult.observations} | ${fitResult.clusters} | ${fitResult.attempts.toFixed(0)} | ${fixed(fitResult.predictorCorrelation)} | ${probability(fitResult.intercept)} ± ${probability(fitResult.interceptSe)} | ${probability(fitResult.perimeterCoefficient)} ± ${probability(fitResult.perimeterSe)} | ${probability(fitResult.interiorCoefficient)} ± ${probability(fitResult.interiorSe)} | ${range(fitResult.slopeSumCi95)} | ${publishedJointWeight} | ${fitResult.marginalInteriorWeight === null ? '—' : fixed(fitResult.marginalInteriorWeight)} |`);
    }
  }
  lines.push(
    '',
    '## Leave-one-season-out ranges',
    '',
    '| Band | Perimeter β range | Interior β range | Slope-sum range | CI-lower range | CI-upper range | Interior-weight range |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...BANDS.map((band) => {
      const loso = result.loso[band];
      const publishedWeightRange = band === 'longTwo' || loso.interiorWeight === null
        ? '—'
        : range(loso.interiorWeight, fixed);
      return `| ${band} | ${range(loso.perimeterCoefficient)} | ${range(loso.interiorCoefficient)} | ${range(loso.slopeSum)} | ${range(loso.slopeSumCiLower)} | ${range(loso.slopeSumCiUpper)} | ${publishedWeightRange} |`;
    }),
    '',
    '## Runtime constant provenance',
    '',
    '| Engine zone(s) | Evidence band | Interior weight | Source classification |',
    '| --- | --- | ---: | --- |',
    `| rim | <6ft (approximate mapping) | ${fixed(result.derivedWeights.rim)} | full-window derived |`,
    `| short_midrange | 6–10ft (approximate mapping) | ${fixed(result.derivedWeights.shortMidrange)} | full-window derived; early ${fixed(result.fits.early.sixToTen.interiorWeight!)} / late ${fixed(result.fits.late.sixToTen.interiorWeight!)} sensitivity |`,
    '| long_midrange | long two | 0.000000 | separately named legacy fallback; long-two fit remains in the measurement table |',
    `| corner_three / above_break_three / deep_three | threePointers | ${fixed(result.derivedWeights.sharedThree)} | shared full-window derived constant |`,
    '',
    'The `pt_defend` bands are radial-distance categories while engine zones use shot-chart semantics. `<6ft` ≈ `rim` and `6–10ft` ≈ `short_midrange` are approximations: engine rim is Restricted Area only, and Paint (Non-RA) belongs to short midrange. The three 3PT engine zones are not separately identifiable from this source.',
    '',
    '## Circularity disclosure',
    '',
    '- `perimeterDefense = 0.70 × standardized(threePointers defended delta) - 0.30 × standardized(guard matchup FG%)`.',
    '- `interiorDefense = 0.70 × standardized(lessThan6Ft defended delta) - 0.30 × standardized(center matchup FG%)`.',
    '',
    'The rim and 3PT fits therefore partly recover the construction of their predictors and are not independent causal confirmation. The 6–10ft and long-two outcomes are new defended-category evidence but remain observational and share the same derived rating predictors.',
    '',
    '## Determinism',
    '',
    '- Seasons, players, categories, clusters, and report rows are sorted deterministically; no RNG or timestamps are used.',
    '- `--check` recomputes and byte-compares this report and the marked constants block.',
    '',
  );
  return lines.join('\n');
}

function renderConstantBlock(result: Derivation): string {
  return [
    BLOCK_START,
    `// Generated by scripts/derive-s3b2-defender-influence.ts from ${FIRST_SEASON} through ${LAST_SEASON}.`,
    '// Values are interior-defense weights in a raw perimeter/interior blend; sane range [0, 1].',
    `export const S3B2_RIM_INTERIOR_WEIGHT = ${fixed(result.derivedWeights.rim, CONSTANT_DECIMALS)};`,
    `export const S3B2_SHORT_MIDRANGE_INTERIOR_WEIGHT = ${fixed(result.derivedWeights.shortMidrange, CONSTANT_DECIMALS)};`,
    `export const S3B2_SHARED_THREE_INTERIOR_WEIGHT = ${fixed(result.derivedWeights.sharedThree, CONSTANT_DECIMALS)};`,
    '// Policy provenance: long two did not clear the unchanged clustered 95% slope-sum gate.',
    '// This preserves accepted perimeter-only behavior; it is a legacy fallback, not a derived weight.',
    'export const S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT = 0;',
    'export const S3B2_INTERIOR_WEIGHT_BY_ZONE: Readonly<Record<ShotZone, number>> = {',
    '  rim: S3B2_RIM_INTERIOR_WEIGHT,',
    '  short_midrange: S3B2_SHORT_MIDRANGE_INTERIOR_WEIGHT,',
    '  long_midrange: S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT,',
    '  corner_three: S3B2_SHARED_THREE_INTERIOR_WEIGHT,',
    '  above_break_three: S3B2_SHARED_THREE_INTERIOR_WEIGHT,',
    '  deep_three: S3B2_SHARED_THREE_INTERIOR_WEIGHT,',
    '};',
    BLOCK_END,
  ].join('\n');
}

function constantsWithBlock(block: string): string {
  const existing = fs.readFileSync(CONSTANTS_PATH, 'utf8');
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start < 0 || end < start) throw new Error('constants.ts is missing the S3.b2 generated block markers');
  return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) throw new Error(`unknown argument(s): ${args.join(' ')}`);
  const check = args.includes('--check');
  const result = derive();
  const report = renderReport(result);
  const block = renderConstantBlock(result);
  const nextConstants = constantsWithBlock(block);

  if (check) {
    const reportMatches = fs.existsSync(REPORT_PATH) && fs.readFileSync(REPORT_PATH, 'utf8') === report;
    const constantsMatch = fs.readFileSync(CONSTANTS_PATH, 'utf8') === nextConstants;
    if (!reportMatches || !constantsMatch) {
      if (!reportMatches) console.error(`--check FAILED: ${REPORT_PATH} is stale or missing.`);
      if (!constantsMatch) console.error(`--check FAILED: generated block in ${CONSTANTS_PATH} is stale.`);
      process.exitCode = 1;
      return;
    }
    console.log(`--check OK: ${REPORT_PATH} and the constants block are byte-identical to the derivation.`);
    return;
  }

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  fs.writeFileSync(CONSTANTS_PATH, nextConstants, 'utf8');
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Updated generated block in ${CONSTANTS_PATH}`);
  console.log(`Primary interior weights: rim=${fixed(result.derivedWeights.rim)}, short=${fixed(result.derivedWeights.shortMidrange)}, shared3=${fixed(result.derivedWeights.sharedThree)}; long-mid legacy fallback=0.`);
  console.log(`Locked diagnostic source SHA-256 ${LOCKED_DIAGNOSTIC.sourceStdoutSha256}.`);
}

main();
