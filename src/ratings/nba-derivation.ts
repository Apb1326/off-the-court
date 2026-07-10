/**
 * S2b — deterministic ratings derivation for the NBA candidate league.
 *
 * This module deliberately has no I/O and no randomness.  The builder supplies
 * normalized-contract rows plus its deterministic shot-event aggregates; this
 * module applies the documented shrinkage, ranking, quantile mapping, and
 * report calculations.  It is candidate-only: neither the engine nor app
 * imports it.
 */

import { PlayerRatings, Position } from '../models/player';
import { BoxAdvancedRow, DefenseRow, HustleRow, ShotZonesRow, TrackingRow } from '../data/nba/types';
import {
  FT_DERIVE_SCALE,
  FT_LEAGUE_AVG_PCT,
  FT_PCT_SLOPE,
  FT_SIM_PCT_MAX,
  FT_SIM_PCT_MIN,
} from '../engine/constants';
import { ratingToModifier } from '../engine/shot';

export const RATING_KEYS = [
  'outsideShooting', 'midrangeShooting', 'interiorScoring', 'freeThrowShooting',
  'ballHandling', 'passing', 'offensiveIQ',
  'perimeterDefense', 'interiorDefense', 'defensiveIQ', 'steal', 'block',
  'athleticism', 'strength', 'rebounding', 'stamina', 'durability',
] as const satisfies readonly (keyof PlayerRatings)[];

export type RatingKey = (typeof RATING_KEYS)[number];

/** The three-season S2b window, ordered newest to oldest. */
export const RECENT_SEASONS = ['2025-26', '2024-25', '2023-24'] as const;
/** Recency policy for the recent window, aligned to the Stage-1 era window. */
export const RECENT_SEASON_WEIGHTS: Record<(typeof RECENT_SEASONS)[number], number> = {
  '2025-26': 0.55,
  '2024-25': 0.30,
  '2023-24': 0.15,
};
/** Full-career stamina/durability window gives each older season this decay. */
export const FULL_WINDOW_SEASON_DECAY = 0.85;
/** Per-rating pseudo-sample prior strength.  Higher = more small-sample pull. */
export const SHRINKAGE_K: Partial<Record<RatingKey, number>> = {
  outsideShooting: 240, midrangeShooting: 160, interiorScoring: 200, freeThrowShooting: 40,
  ballHandling: 400, passing: 400, offensiveIQ: 400,
  perimeterDefense: 300, interiorDefense: 300, defensiveIQ: 350, steal: 350, block: 350,
  athleticism: 900, rebounding: 400, stamina: 180, durability: 180,
};
/** Log a shrinkage application below this effective sample size. */
export const FULL_CONFIDENCE_SAMPLE = 80;
/** S2b harness bands after integer quantization. */
export const RATING_MEAN_TOLERANCE = 0.75;
export const RATING_SD_TOLERANCE = 1.0;
/** FT keeps percentage scale through the engine inverse, rather than quantile remapping. */
export const FREE_THROW_TARGET_SD = 8.25;
/** The FTA-weighted league anchor and unweighted player check population differ. */
export const FREE_THROW_MEAN_TOLERANCE = 2.25;
/** Weak-link defense needs distinct perimeter/interior signals, not one interchangeable rating. */
export const PERIMETER_INTERIOR_DEFENSE_R_MAX = 0.70;

export interface ZoneAggregate {
  fgm: number;
  fga: number;
}

export interface ShotEventSeasonAggregate {
  season: string;
  midrangeUnder14: ZoneAggregate;
  longMidrange: ZoneAggregate;
  aboveBreakThree: ZoneAggregate;
  deepThree: ZoneAggregate;
}

export interface NbaDerivationPlayer {
  personId: number;
  id: string;
  position: Position;
  heightCm: number | null;
  weightKg: number | null;
  wingspanCm: number | null;
  boxSeasons: ReadonlyArray<{ season: string; row: BoxAdvancedRow }>;
  shotZoneSeasons: ReadonlyArray<{ season: string; row: ShotZonesRow }>;
  shotEventSeasons: ReadonlyArray<ShotEventSeasonAggregate>;
  tracking: TrackingRow | undefined;
  defense: DefenseRow | undefined;
  hustle: HustleRow | undefined;
}

export interface NbaDerivationInput {
  players: ReadonlyArray<NbaDerivationPlayer>;
  rosteredPersonIds: ReadonlySet<number>;
  activeRatings: ReadonlyArray<PlayerRatings>;
}

interface Metric {
  id: string;
  label: string;
  value: number;
  n: number;
  exempt?: boolean;
}

interface PlayerWork {
  input: NbaDerivationPlayer;
  metrics: Record<RatingKey, Metric[]>;
  shrunk: Map<string, number>;
  standardized: Map<string, number>;
  rawScore: Record<RatingKey, number>;
  resolvedWingspanCm: number;
}

export interface FallbackLogEntry {
  playerId: string;
  field: string;
  reason: string;
}

export interface RatingDistribution {
  mean: number;
  sd: number;
  p1: number;
  p99: number;
  count75Plus: number;
  targetSd: number;
}

export interface NbaDerivationResult {
  ratingsByPerson: Map<number, PlayerRatings>;
  continuousFreeThrowRatings: Map<number, number>;
  freeThrowPercentages: Map<number, number>;
  fallbackLog: FallbackLogEntry[];
  distributions: Record<RatingKey, RatingDistribution>;
  currentDistributions: Record<RatingKey, RatingDistribution>;
  rawScores: Map<number, Record<RatingKey, number>>;
  inputsByPerson: Map<number, string[]>;
  rosteredPersonIds: ReadonlySet<number>;
}

const EPSILON = 1e-9;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function n(value: unknown): number {
  return finite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampRating(value: number): number {
  return Math.round(clamp(value, 1, 80));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function lowerMiddleMedian(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function weightedRate(parts: readonly { made: number; attempts: number; weight: number }[]): Metric {
  let made = 0;
  let attempts = 0;
  for (const part of parts) {
    made += part.made * part.weight;
    attempts += part.attempts * part.weight;
  }
  return { id: '', label: '', value: attempts > 0 ? made / attempts : 0, n: attempts };
}

function recentBox(player: NbaDerivationPlayer): { row: BoxAdvancedRow; weight: number }[] {
  const bySeason = new Map(player.boxSeasons.map((entry) => [entry.season, entry.row]));
  return RECENT_SEASONS.flatMap((season) => {
    const row = bySeason.get(season);
    return row ? [{ row, weight: RECENT_SEASON_WEIGHTS[season] }] : [];
  });
}

function aggregateBoxMetric(
  player: NbaDerivationPlayer,
  read: (row: BoxAdvancedRow) => number | null | undefined,
  sample: (row: BoxAdvancedRow) => number | null | undefined,
): Metric {
  let numerator = 0;
  let denominator = 0;
  for (const { row, weight } of recentBox(player)) {
    const value = read(row);
    const count = sample(row);
    if (!finite(value) || !finite(count) || count <= 0) continue;
    numerator += value * count * weight;
    denominator += count * weight;
  }
  return { id: '', label: '', value: denominator > 0 ? numerator / denominator : 0, n: denominator };
}

function fullWindow(player: NbaDerivationPlayer): { row: BoxAdvancedRow; weight: number }[] {
  const latestStart = 2025;
  return player.boxSeasons.flatMap(({ season, row }) => {
    const start = Number.parseInt(season.slice(0, 4), 10);
    if (!Number.isFinite(start)) return [];
    return [{ row, weight: FULL_WINDOW_SEASON_DECAY ** Math.max(0, latestStart - start) }];
  });
}

function aggregateFullMetric(
  player: NbaDerivationPlayer,
  read: (row: BoxAdvancedRow) => number | null | undefined,
  sample: (row: BoxAdvancedRow) => number | null | undefined,
): Metric {
  let numerator = 0;
  let denominator = 0;
  for (const { row, weight } of fullWindow(player)) {
    const value = read(row);
    const count = sample(row);
    if (!finite(value) || !finite(count) || count <= 0) continue;
    numerator += value * count * weight;
    denominator += count * weight;
  }
  return { id: '', label: '', value: denominator > 0 ? numerator / denominator : 0, n: denominator };
}

/**
 * Full-window games-played metric. The value is the recency-weighted average
 * GP per season, while n carries the recency-weighted games themselves so
 * durability shrinkage reflects actual game exposure rather than season count.
 */
function aggregateFullGamesPlayed(player: NbaDerivationPlayer): Metric {
  let numerator = 0;
  let seasonWeight = 0;
  let weightedGames = 0;
  for (const { row, weight } of fullWindow(player)) {
    const games = n(row.gp);
    if (games <= 0) continue;
    numerator += games * weight;
    seasonWeight += weight;
    weightedGames += games * weight;
  }
  return {
    id: '',
    label: '',
    value: seasonWeight > 0 ? numerator / seasonWeight : 0,
    n: weightedGames,
  };
}

function recentShotEventAggregate(player: NbaDerivationPlayer): Record<keyof Omit<ShotEventSeasonAggregate, 'season'>, ZoneAggregate> {
  const zero = (): ZoneAggregate => ({ fgm: 0, fga: 0 });
  const out = {
    midrangeUnder14: zero(), longMidrange: zero(), aboveBreakThree: zero(), deepThree: zero(),
  };
  const bySeason = new Map(player.shotEventSeasons.map((entry) => [entry.season, entry]));
  for (const season of RECENT_SEASONS) {
    const data = bySeason.get(season);
    if (!data) continue;
    const weight = RECENT_SEASON_WEIGHTS[season];
    for (const key of Object.keys(out) as (keyof typeof out)[]) {
      out[key].fgm += data[key].fgm * weight;
      out[key].fga += data[key].fga * weight;
    }
  }
  return out;
}

function recentShotZoneAggregate(player: NbaDerivationPlayer): Record<'rim' | 'paintNonRa' | 'cornerThree', ZoneAggregate> {
  const out = { rim: { fgm: 0, fga: 0 }, paintNonRa: { fgm: 0, fga: 0 }, cornerThree: { fgm: 0, fga: 0 } };
  const bySeason = new Map(player.shotZoneSeasons.map((entry) => [entry.season, entry.row]));
  for (const season of RECENT_SEASONS) {
    const row = bySeason.get(season);
    if (!row) continue;
    const weight = RECENT_SEASON_WEIGHTS[season];
    const add = (target: ZoneAggregate, source: ZoneAggregate) => {
      target.fgm += source.fgm * weight;
      target.fga += source.fga * weight;
    };
    add(out.rim, row.otcZones.rim);
    // Stage 0's short_midrange entry is exactly Paint (Non-RA); the event
    // aggregate supplies the distinct <14 ft midrange piece below.
    add(out.paintNonRa, row.otcZones.short_midrange);
    add(out.cornerThree, row.otcZones.corner_three);
  }
  return out;
}

function trackingMeasure(row: TrackingRow | undefined, measure: string, key: string): number {
  return n(row?.measures[measure]?.[key]);
}

function matchupRate(row: DefenseRow | undefined, bucket: 'G' | 'C' | 'all'): Metric {
  if (!row) return { id: '', label: '', value: 0, n: 0 };
  let made = 0;
  let attempts = 0;
  const keys = bucket === 'all' ? Object.keys(row.matchupsByOppPosition) : Object.keys(row.matchupsByOppPosition).filter((key) => key.includes(bucket));
  for (const key of keys) {
    const value = row.matchupsByOppPosition[key];
    made += n(value.matchupFgm);
    attempts += n(value.matchupFga);
  }
  return { id: '', label: '', value: attempts > 0 ? made / attempts : 0, n: attempts };
}

function metric(id: string, label: string, value: number, sample: number): Metric {
  return { id, label, value: finite(value) ? value : 0, n: Math.max(0, finite(sample) ? sample : 0) };
}

function resolveWingspans(input: NbaDerivationInput, fallbacks: FallbackLogEntry[]): Map<number, number> {
  const rostered = input.players.filter((player) => input.rosteredPersonIds.has(player.personId));
  const observed = rostered.filter((player) => finite(player.wingspanCm) && player.wingspanCm! > 0);
  const global = lowerMiddleMedian(observed.map((player) => player.wingspanCm!));
  if (global === undefined) throw new Error('S2b requires at least one observed rostered wingspanCm');

  const byPosition = new Map<Position, number>();
  for (const position of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
    const median = lowerMiddleMedian(observed.filter((player) => player.position === position).map((player) => player.wingspanCm!));
    if (median !== undefined) byPosition.set(position, median);
  }

  const out = new Map<number, number>();
  for (const player of [...input.players].sort((a, b) => a.personId - b.personId)) {
    if (finite(player.wingspanCm) && player.wingspanCm > 0) {
      out.set(player.personId, player.wingspanCm);
      continue;
    }
    const positionMedian = byPosition.get(player.position);
    const resolved = positionMedian ?? global;
    out.set(player.personId, resolved);
    fallbacks.push({
      playerId: player.id,
      field: 'wingspanCm',
      reason: positionMedian === undefined
        ? `missing → rostered global available-wingspan lower-middle median (${resolved.toFixed(1)} cm)`
        : `missing → rostered ${player.position} available-wingspan lower-middle median (${resolved.toFixed(1)} cm)`,
    });
  }
  return out;
}

function buildMetrics(player: NbaDerivationPlayer, wingspanCm: number): Record<RatingKey, Metric[]> {
  const eventShots = recentShotEventAggregate(player);
  const zones = recentShotZoneAggregate(player);
  // `deep_three` has no distinct engine rating, so its deterministic event
  // aggregate remains evidence for outside shooting rather than a new rating.
  const outsideAttempts = zones.cornerThree.fga + eventShots.aboveBreakThree.fga + eventShots.deepThree.fga;
  const outsidePct = weightedRate([
    { made: zones.cornerThree.fgm, attempts: zones.cornerThree.fga, weight: 0.35 },
    { made: eventShots.aboveBreakThree.fgm + eventShots.deepThree.fgm, attempts: eventShots.aboveBreakThree.fga + eventShots.deepThree.fga, weight: 0.65 },
  ]);
  const shortMid = { fgm: zones.paintNonRa.fgm + eventShots.midrangeUnder14.fgm, fga: zones.paintNonRa.fga + eventShots.midrangeUnder14.fga };
  const midAttempts = shortMid.fga + eventShots.longMidrange.fga;
  const midPct = weightedRate([
    { made: shortMid.fgm, attempts: shortMid.fga, weight: 0.50 },
    { made: eventShots.longMidrange.fgm, attempts: eventShots.longMidrange.fga, weight: 0.50 },
  ]);
  const interiorAttempts = zones.rim.fga + shortMid.fga;
  const interiorPct = weightedRate([
    { made: zones.rim.fgm, attempts: zones.rim.fga, weight: 0.75 },
    { made: shortMid.fgm, attempts: shortMid.fga, weight: 0.25 },
  ]);
  const ft = aggregateBoxMetric(player, (row) => row.perGame.ftPct, (row) => n(row.perGame.fta) * n(row.gp));
  const astPct = aggregateBoxMetric(player, (row) => row.advanced?.astPct, (row) => row.advanced?.poss);
  const astTo = aggregateBoxMetric(player, (row) => row.advanced?.astTo, (row) => row.advanced?.poss);
  const tovPct = aggregateBoxMetric(player, (row) => row.advanced?.tmTovPct, (row) => row.advanced?.poss);
  const rebPct = aggregateBoxMetric(player, (row) => row.advanced?.rebPct, (row) => row.advanced?.poss);
  const stl100 = aggregateBoxMetric(player, (row) => row.per100?.stl, (row) => row.advanced?.poss);
  const blk100 = aggregateBoxMetric(player, (row) => row.per100?.blk, (row) => row.advanced?.poss);
  const fullMpg = aggregateFullMetric(player, (row) => row.mpg, (row) => row.gp);
  const fullGp = aggregateFullGamesPlayed(player);

  const overall = player.defense?.defended.overall;
  const defendedOverallDelta = metric(
    'defense.delta.source', 'defense.defended.overall.normalFgPct - dFgPct',
    n(overall?.normalFgPct) - n(overall?.dFgPct), n(overall?.dFga),
  );
  const defendedThree = player.defense?.defended.threePointers;
  const defendedThreeDelta = metric(
    'perimeter.defended3ptDelta', 'defense.defended.threePointers.normalFgPct - dFgPct',
    n(defendedThree?.normalFgPct) - n(defendedThree?.dFgPct), n(defendedThree?.dFga),
  );
  const defendedLessThan6 = player.defense?.defended.lessThan6Ft;
  const defendedLessThan6Delta = metric(
    'interior.defendedLessThan6FtDelta', 'defense.defended.lessThan6Ft.normalFgPct - dFgPct',
    n(defendedLessThan6?.normalFgPct) - n(defendedLessThan6?.dFgPct), n(defendedLessThan6?.dFga),
  );
  const guardMatchup = matchupRate(player.defense, 'G');
  guardMatchup.id = 'defense.guardMatchup'; guardMatchup.label = 'defense.matchupsByOppPosition[G*].matchupFgPct';
  const centerMatchup = matchupRate(player.defense, 'C');
  centerMatchup.id = 'defense.centerMatchup'; centerMatchup.label = 'defense.matchupsByOppPosition[C*].matchupFgPct';
  const allMatchup = matchupRate(player.defense, 'all');
  allMatchup.id = 'defense.allMatchup'; allMatchup.label = 'defense.matchupsByOppPosition[*].matchupFgPct';

  const passingMin = trackingMeasure(player.tracking, 'passing', 'min');
  const passingPasses = trackingMeasure(player.tracking, 'passing', 'passesMade');
  const passingAdjAst = trackingMeasure(player.tracking, 'passing', 'astAdj');
  const passingSecondaries = trackingMeasure(player.tracking, 'passing', 'secondaryAst');
  const speedMin = trackingMeasure(player.tracking, 'speedDistance', 'min');
  const speed = trackingMeasure(player.tracking, 'speedDistance', 'avgSpeed');
  const distFeet = trackingMeasure(player.tracking, 'speedDistance', 'distFeet');
  const hustleMin = n(player.hustle?.min);
  const boxOuts = n(player.hustle?.boxOuts);
  const deflections = n(player.hustle?.deflections);
  const heightMeters = n(player.heightCm) / 100;
  const bmi = heightMeters > 0 && n(player.weightKg) > 0 ? n(player.weightKg) / (heightMeters * heightMeters) : 0;
  const wingspanRatio = n(player.heightCm) > 0 ? wingspanCm / n(player.heightCm) : 0;
  const measuredBmi = heightMeters > 0 && n(player.weightKg) > 0;
  const measuredWingspanRatio = n(player.heightCm) > 0 && finite(player.wingspanCm) && player.wingspanCm > 0;

  return {
    outsideShooting: [
      metric('outside.accuracy', 'shot_zones.corner_three + shot_events.above_break_three (including deep) FG%', outsidePct.value, outsidePct.n),
      metric('outside.volume', 'shot_zones.corner_three + shot_events.above_break_three (including deep) attempts', Math.log1p(outsideAttempts), outsideAttempts),
    ],
    midrangeShooting: [
      metric('mid.accuracy', 'shot_zones.paint_non_RA + shot_events short/long midrange FG%', midPct.value, midPct.n),
      metric('mid.volume', 'shot_zones.paint_non_RA + shot_events short/long midrange attempts', Math.log1p(midAttempts), midAttempts),
    ],
    interiorScoring: [
      metric('interior.accuracy', 'shot_zones.rim + Stage-1 short_midrange FG%', interiorPct.value, interiorPct.n),
      metric('interior.volume', 'shot_zones.rim + Stage-1 short_midrange attempts', Math.log1p(interiorAttempts), interiorAttempts),
    ],
    freeThrowShooting: [metric('ft.accuracy', 'box_advanced.perGame.ftPct', ft.value, ft.n)],
    ballHandling: [
      metric('handling.turnoverRatio', 'box_advanced.advanced.tmTovPct (lower is better)', tovPct.value, tovPct.n),
      metric('handling.astTo', 'box_advanced.advanced.astTo', astTo.value, astTo.n),
      metric('handling.passesPerMin', 'tracking.passing.passesMade / min', passingMin > 0 ? passingPasses / passingMin : 0, passingMin),
    ],
    passing: [
      metric('passing.astPct', 'box_advanced.advanced.astPct', astPct.value, astPct.n),
      metric('passing.adjustedAstPerPass', 'tracking.passing.astAdj / passesMade', passingPasses > 0 ? passingAdjAst / passingPasses : 0, passingPasses),
      metric('passing.passesPerMin', 'tracking.passing.passesMade / min', passingMin > 0 ? passingPasses / passingMin : 0, passingMin),
    ],
    offensiveIQ: [
      metric('iq.astTo', 'box_advanced.advanced.astTo', astTo.value, astTo.n),
      metric('iq.turnoverRatio', 'box_advanced.advanced.tmTovPct (lower is better)', tovPct.value, tovPct.n),
      metric('iq.secondaryAstPerPass', 'tracking.passing.secondaryAst / passesMade', passingPasses > 0 ? passingSecondaries / passingPasses : 0, passingPasses),
    ],
    perimeterDefense: [
      defendedThreeDelta,
      guardMatchup,
    ],
    interiorDefense: [
      defendedLessThan6Delta,
      centerMatchup,
    ],
    defensiveIQ: [
      { ...defendedOverallDelta, id: 'defIQ.defendedDelta' },
      allMatchup,
      metric('defense.deflectionsPerMin', 'hustle.deflections / min', hustleMin > 0 ? deflections / hustleMin : 0, hustleMin),
    ],
    steal: [metric('steal.per100', 'box_advanced.per100.stl', stl100.value, stl100.n)],
    block: [metric('block.per100', 'box_advanced.per100.blk', blk100.value, blk100.n)],
    athleticism: [
      metric('athleticism.speed', 'tracking.speedDistance.avgSpeed', speed, speedMin),
      metric('athleticism.distancePerMin', 'tracking.speedDistance.distFeet / min', speedMin > 0 ? distFeet / speedMin : 0, speedMin),
      { ...metric('athleticism.wingspanRatio', 'NbaPlayerRow.wingspanCm / heightCm', wingspanRatio, measuredWingspanRatio ? 1 : 0), exempt: measuredWingspanRatio },
    ],
    strength: [
      { ...metric('strength.bmi', 'NbaPlayerRow.weightKg / heightCm squared', bmi, measuredBmi ? 1 : 0), exempt: measuredBmi },
      { ...metric('strength.wingspanRatio', 'NbaPlayerRow.wingspanCm / heightCm', wingspanRatio, measuredWingspanRatio ? 1 : 0), exempt: measuredWingspanRatio },
    ],
    rebounding: [
      metric('rebounding.rebPct', 'box_advanced.advanced.rebPct', rebPct.value, rebPct.n),
      metric('rebounding.boxOutsPerMin', 'hustle.boxOuts / min', hustleMin > 0 ? boxOuts / hustleMin : 0, hustleMin),
    ],
    stamina: [
      metric('stamina.mpg', 'box_advanced.mpg full-window recency-weighted', fullMpg.value, fullMpg.n),
    ],
    durability: [
      metric('durability.gp', 'box_advanced.gp full-window recency-weighted', fullGp.value, fullGp.n),
    ],
  };
}

function buildPriors(work: readonly PlayerWork[], rostered: ReadonlySet<number>): Map<string, Map<Position, number>> {
  const valuesByPosition = new Map<string, Map<Position, number[]>>();
  const all = new Map<string, number[]>();
  for (const player of work) {
    if (!rostered.has(player.input.personId)) continue;
    for (const rating of RATING_KEYS) {
      for (const item of player.metrics[rating]) {
        if (item.n <= 0) continue;
        let positionMap = valuesByPosition.get(item.id);
        if (!positionMap) { positionMap = new Map(); valuesByPosition.set(item.id, positionMap); }
        const list = positionMap.get(player.input.position) ?? [];
        list.push(item.value);
        positionMap.set(player.input.position, list);
        const global = all.get(item.id) ?? [];
        global.push(item.value); all.set(item.id, global);
      }
    }
  }
  const resolved = new Map<string, Map<Position, number>>();
  for (const [id, positionMap] of valuesByPosition) {
    const result = new Map<Position, number>();
    const global = mean(all.get(id) ?? []);
    for (const position of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
      const values = positionMap.get(position);
      result.set(position, values && values.length > 0 ? mean(values) : global);
    }
    resolved.set(id, result);
  }
  return resolved;
}

function z(value: number, avg: number, sd: number): number {
  return sd > EPSILON ? (value - avg) / sd : 0;
}

/** Acklam's inverse standard-normal CDF approximation; deterministic and dependency-free. */
function inverseNormal(p: number): number {
  const q = clamp(p, 1e-12, 1 - 1e-12);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 0.97575) return -inverseNormal(1 - q);
  const r = q - 0.5;
  const s = r * r;
  return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r /
    (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

function pearson(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const ma = mean(a); const mb = mean(b);
  let numerator = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma; const db = b[i] - mb;
    numerator += da * db; aa += da * da; bb += db * db;
  }
  return aa > EPSILON && bb > EPSILON ? numerator / Math.sqrt(aa * bb) : 0;
}

export function freeThrowPctFromRating(rating: number): number {
  return clamp(FT_LEAGUE_AVG_PCT + ((rating - 40) / 40) * FT_PCT_SLOPE, FT_SIM_PCT_MIN, FT_SIM_PCT_MAX);
}

export function freeThrowRatingFromPct(pct: number): number {
  return 40 + (pct - FT_LEAGUE_AVG_PCT) * FT_DERIVE_SCALE;
}

export function blendScore(rating: RatingKey, standardized: (id: string) => number): number {
  switch (rating) {
    case 'outsideShooting': return 0.85 * standardized('outside.accuracy') + 0.15 * standardized('outside.volume');
    case 'midrangeShooting': return 0.85 * standardized('mid.accuracy') + 0.15 * standardized('mid.volume');
    case 'interiorScoring': return 0.85 * standardized('interior.accuracy') + 0.15 * standardized('interior.volume');
    case 'ballHandling': return -0.55 * standardized('handling.turnoverRatio') + 0.25 * standardized('handling.astTo') + 0.20 * standardized('handling.passesPerMin');
    case 'passing': return 0.55 * standardized('passing.astPct') + 0.30 * standardized('passing.adjustedAstPerPass') + 0.15 * standardized('passing.passesPerMin');
    case 'offensiveIQ': return 0.45 * standardized('iq.astTo') - 0.35 * standardized('iq.turnoverRatio') + 0.20 * standardized('iq.secondaryAstPerPass');
    case 'perimeterDefense': return 0.70 * standardized('perimeter.defended3ptDelta') - 0.30 * standardized('defense.guardMatchup');
    case 'interiorDefense': return 0.70 * standardized('interior.defendedLessThan6FtDelta') - 0.30 * standardized('defense.centerMatchup');
    case 'defensiveIQ': return 0.60 * standardized('defIQ.defendedDelta') - 0.20 * standardized('defense.allMatchup') + 0.20 * standardized('defense.deflectionsPerMin');
    case 'steal': return standardized('steal.per100');
    case 'block': return standardized('block.per100');
    case 'athleticism': return 0.60 * standardized('athleticism.speed') + 0.25 * standardized('athleticism.distancePerMin') + 0.15 * standardized('athleticism.wingspanRatio');
    case 'strength': return 0.75 * standardized('strength.bmi') + 0.25 * standardized('strength.wingspanRatio');
    case 'rebounding': return 0.80 * standardized('rebounding.rebPct') + 0.20 * standardized('rebounding.boxOutsPerMin');
    case 'stamina': return standardized('stamina.mpg');
    case 'durability': return standardized('durability.gp');
    case 'freeThrowShooting': return standardized('ft.accuracy');
  }
}

function distribution(values: readonly number[], targetSd: number): RatingDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: mean(values), sd: standardDeviation(values),
    p1: sorted[Math.floor((sorted.length - 1) * 0.01)] ?? 0,
    p99: sorted[Math.ceil((sorted.length - 1) * 0.99)] ?? 0,
    count75Plus: values.filter((value) => value >= 75).length,
    targetSd,
  };
}

function activeTargetSd(active: readonly PlayerRatings[], rating: RatingKey): number {
  return rating === 'freeThrowShooting'
    ? FREE_THROW_TARGET_SD
    : Math.max(4, standardDeviation(active.map((player) => player[rating])));
}

export function deriveNbaRatings(input: NbaDerivationInput): NbaDerivationResult {
  if (input.players.length === 0) throw new Error('S2b derivation received no eligible players');
  const fallbackLog: FallbackLogEntry[] = [];
  const wingspans = resolveWingspans(input, fallbackLog);
  const work: PlayerWork[] = [...input.players]
    .sort((a, b) => a.personId - b.personId)
    .map((player) => ({
      input: player,
      metrics: buildMetrics(player, wingspans.get(player.personId)!),
      shrunk: new Map(), standardized: new Map(),
      rawScore: Object.fromEntries(RATING_KEYS.map((rating) => [rating, 0])) as Record<RatingKey, number>,
      resolvedWingspanCm: wingspans.get(player.personId)!,
    }));
  const priors = buildPriors(work, input.rosteredPersonIds);
  // FT is the explicit exception: its prior is the rostered league's
  // FTA-weighted percentage, not an unweighted positional mean.
  let ftMadeEquivalent = 0;
  let ftAttempts = 0;
  for (const player of work) {
    if (!input.rosteredPersonIds.has(player.input.personId)) continue;
    const ft = player.metrics.freeThrowShooting[0];
    ftMadeEquivalent += ft.value * ft.n;
    ftAttempts += ft.n;
  }
  const leagueFtPrior = ftAttempts > 0 ? ftMadeEquivalent / ftAttempts : FT_LEAGUE_AVG_PCT;

  // Every input metric is position-prior shrunk.  The log records every use
  // below full confidence, including zero-sample substitutions.
  for (const player of work) {
    for (const rating of RATING_KEYS) {
      for (const item of player.metrics[rating]) {
        const isFreeThrow = item.id === 'ft.accuracy';
        const prior = isFreeThrow ? leagueFtPrior : (priors.get(item.id)?.get(player.input.position) ?? 0);
        if (item.exempt) {
          player.shrunk.set(item.id, item.value);
          continue;
        }
        const k = SHRINKAGE_K[rating];
        if (item.n > 0 && k === undefined) throw new Error(`S2b metric ${item.id} has no shrinkage k for ${rating}`);
        const weight = item.n > 0 && k !== undefined ? item.n / (item.n + k) : 0;
        player.shrunk.set(item.id, weight * item.value + (1 - weight) * prior);
        if (item.n < FULL_CONFIDENCE_SAMPLE) {
          const isBiometric = item.id === 'strength.bmi'
            || item.id === 'strength.wingspanRatio'
            || item.id === 'athleticism.wingspanRatio';
          if (isBiometric && item.id !== 'strength.bmi') continue;
          fallbackLog.push({
            playerId: player.input.id,
            field: isBiometric ? 'strength.bmi.missingMeasurement' : `${rating}.${item.id}`,
            reason: isBiometric
              ? `${item.label}: n=0 substitution; position prior used because height/weight measurement is unavailable`
              : `${item.label}: n=${item.n.toFixed(1)} < ${FULL_CONFIDENCE_SAMPLE}; ${isFreeThrow ? 'league FTA-weighted' : 'position'} prior weight ${(1 - weight).toFixed(3)}`,
          });
        }
      }
    }
  }

  // Standardize each already-shrunk metric across all eligible players before
  // blending, so documented blend weights are comparable across units.
  const metricIds = [...new Set(work.flatMap((player) => RATING_KEYS.flatMap((rating) => player.metrics[rating].map((item) => item.id))))].sort();
  for (const id of metricIds) {
    const values = work.map((player) => player.shrunk.get(id) ?? 0);
    const avg = mean(values); const sd = standardDeviation(values);
    for (const player of work) player.standardized.set(id, z(player.shrunk.get(id) ?? 0, avg, sd));
  }
  for (const player of work) {
    for (const rating of RATING_KEYS) player.rawScore[rating] = blendScore(rating, (id) => player.standardized.get(id) ?? 0);
  }

  const ratingsByPerson = new Map<number, PlayerRatings>();
  const continuousFreeThrowRatings = new Map<number, number>();
  const freeThrowPercentages = new Map<number, number>();
  const rostered = work.filter((player) => input.rosteredPersonIds.has(player.input.personId));
  if (rostered.length === 0) throw new Error('S2b derivation received no rostered players for priors');

  const perRating = new Map<RatingKey, Map<number, number>>();
  for (const rating of RATING_KEYS) {
    const scores = new Map<number, number>();
    if (rating === 'freeThrowShooting') {
      for (const player of work) {
        const pct = player.shrunk.get('ft.accuracy') ?? FT_LEAGUE_AVG_PCT;
        const boundedPct = clamp(pct, FT_SIM_PCT_MIN, FT_SIM_PCT_MAX);
        const continuous = freeThrowRatingFromPct(boundedPct);
        continuousFreeThrowRatings.set(player.input.personId, continuous);
        freeThrowPercentages.set(player.input.personId, boundedPct);
        scores.set(player.input.personId, clampRating(continuous));
      }
    } else {
      const ranked = [...work].sort((a, b) => a.rawScore[rating] - b.rawScore[rating] || a.input.personId - b.input.personId);
      const zByPerson = new Map<number, number>();
      ranked.forEach((player, index) => zByPerson.set(player.input.personId, inverseNormal((index + 0.5) / ranked.length)));
      const rosterZ = rostered.map((player) => zByPerson.get(player.input.personId)!);
      const rosterMean = mean(rosterZ);
      const rosterSd = standardDeviation(rosterZ);
      if (rosterSd <= EPSILON) throw new Error(`S2b ${rating} quantile distribution is degenerate`);
      const target = activeTargetSd(input.activeRatings, rating);
      for (const player of work) {
        const continuous = 40 + target * ((zByPerson.get(player.input.personId)! - rosterMean) / rosterSd);
        scores.set(player.input.personId, clampRating(continuous));
      }
    }
    perRating.set(rating, scores);
  }

  for (const player of work) {
    const ratings = Object.fromEntries(
      RATING_KEYS.map((rating) => [rating, perRating.get(rating)!.get(player.input.personId)!]),
    ) as unknown as PlayerRatings;
    ratingsByPerson.set(player.input.personId, ratings);
  }

  const distributions = {} as Record<RatingKey, RatingDistribution>;
  const currentDistributions = {} as Record<RatingKey, RatingDistribution>;
  for (const rating of RATING_KEYS) {
    const target = activeTargetSd(input.activeRatings, rating);
    distributions[rating] = distribution(rostered.map((player) => ratingsByPerson.get(player.input.personId)![rating]), target);
    currentDistributions[rating] = distribution(input.activeRatings.map((player) => player[rating]), target);
  }
  const inputsByPerson = new Map<number, string[]>();
  for (const player of work) {
    const details = RATING_KEYS.flatMap((rating) => player.metrics[rating].map((item) => `${item.label}=${item.value.toFixed(4)} (n=${item.n.toFixed(1)})`));
    details.push(`resolved wingspanCm=${player.resolvedWingspanCm.toFixed(1)}`);
    inputsByPerson.set(player.input.personId, details);
  }
  return {
    ratingsByPerson, continuousFreeThrowRatings, freeThrowPercentages,
    fallbackLog: fallbackLog.sort((a, b) => a.playerId.localeCompare(b.playerId) || a.field.localeCompare(b.field) || a.reason.localeCompare(b.reason)),
    distributions, currentDistributions, rawScores: new Map(work.map((player) => [player.input.personId, player.rawScore])),
    inputsByPerson, rosteredPersonIds: input.rosteredPersonIds,
  };
}

function matrixLines(title: string, players: readonly { values: Record<RatingKey, number> }[]): string[] {
  const headers = RATING_KEYS.map((key) => key.slice(0, 8).padEnd(8)).join(' ');
  const lines = [`### ${title}`, '', '```text', `         ${headers}`];
  for (const row of RATING_KEYS) {
    const values = RATING_KEYS.map((column) => pearson(
      players.map((player) => player.values[row]),
      players.map((player) => player.values[column]),
    ));
    lines.push(`${row.slice(0, 8).padEnd(8)} ${values.map((value) => value.toFixed(2).padStart(8)).join(' ')}`);
  }
  lines.push('```');
  return lines;
}

function correlationDeltas(
  left: readonly { values: Record<RatingKey, number> }[],
  right: readonly { values: Record<RatingKey, number> }[],
): { pair: string; left: number; right: number; delta: number }[] {
  const out: { pair: string; left: number; right: number; delta: number }[] = [];
  for (let i = 0; i < RATING_KEYS.length; i++) {
    for (let j = i + 1; j < RATING_KEYS.length; j++) {
      const a = RATING_KEYS[i]; const b = RATING_KEYS[j];
      const l = pearson(left.map((player) => player.values[a]), left.map((player) => player.values[b]));
      const r = pearson(right.map((player) => player.values[a]), right.map((player) => player.values[b]));
      out.push({ pair: `${a} / ${b}`, left: l, right: r, delta: Math.abs(l - r) });
    }
  }
  return out.sort((a, b) => b.delta - a.delta || a.pair.localeCompare(b.pair)).slice(0, 10);
}

function histogram(values: readonly number[]): number[] {
  const bins = [-0.11, -0.08, -0.05, -0.02, 0.01, 0.04, 0.07, 0.10];
  const counts = new Array(bins.length + 1).fill(0) as number[];
  for (const value of values) {
    let index = bins.findIndex((edge) => value < edge);
    if (index < 0) index = bins.length;
    counts[index]++;
  }
  return counts;
}

const RATING_DOCUMENTATION: Record<RatingKey, string> = {
  outsideShooting: 'shot_zones corner efficiency plus shot_events above-break/deep efficiency (85%) + attempt volume (15%); three-season recency window; k=240; percentile-to-truncated-normal.',
  midrangeShooting: 'shot_zones paint-non-RA plus shot_events <14-ft / >=14-ft midrange efficiency (85%) + attempt volume (15%); three-season recency window; k=160; percentile-to-truncated-normal.',
  interiorScoring: 'shot_zones rim plus Stage-1 short-mid efficiency (85%) + attempt volume (15%); three-season recency window; k=200; percentile-to-truncated-normal.',
  freeThrowShooting: 'box_advanced ftPct, FTA-weighted three-season shrinkage; k=40; exact FT inverse then integer quantization (no percentile map).',
  ballHandling: 'usage-normalized tmTovPct turnover ratio (negative 55%), AST/TO (25%), tracking passes/min (20%); 2025-26 tracking + three-season box; k=400; percentile-to-truncated-normal.',
  passing: 'AST% (55%), tracking adjusted assists/pass (30%), passes/min (15%); 2025-26 tracking + three-season box; k=400; percentile-to-truncated-normal.',
  offensiveIQ: 'AST/TO (45%), usage-normalized tmTovPct turnover ratio negative (35%), secondary assists/pass (20%); 2025-26 tracking + three-season box; k=400; percentile-to-truncated-normal.',
  perimeterDefense: 'defended three-pointers expected-minus-allowed FG% (70%) plus guard matchup FG% negative (30%); 2025-26 defense; k=300; percentile-to-truncated-normal.',
  interiorDefense: 'defended less-than-6-ft expected-minus-allowed FG% (70%) plus center matchup FG% negative (30%); 2025-26 defense; k=300; percentile-to-truncated-normal.',
  defensiveIQ: 'defended FG delta (60%), all-matchup FG% negative (20%), deflections/min (20%); 2025-26 defense/hustle; k=350; percentile-to-truncated-normal.',
  steal: 'box_advanced per100 steals, possession-weighted three-season rate; k=350; percentile-to-truncated-normal.',
  block: 'box_advanced per100 blocks, possession-weighted three-season rate; k=350; percentile-to-truncated-normal.',
  athleticism: 'tracking average speed (60%), distance/min (25%), measured wingspan/height (15%); 2025-26 tracking and deterministic wingspan fallback; measured biometrics bypass shrinkage; k=900 for non-biometric inputs; percentile-to-truncated-normal. avgSpeed measures movement volume/speed in role, not athletic ceiling; accepted for S2b because no better harvested source exists.',
  strength: 'measured BMI (75%) plus measured wingspan/height (25%); 2025-26 biometrics and deterministic wingspan fallback; measured biometrics bypass shrinkage; missing measurements use position priors; percentile-to-truncated-normal.',
  rebounding: 'reb% (80%) plus hustle box-outs/min (20%); three-season box + 2025-26 hustle; k=400; percentile-to-truncated-normal.',
  stamina: 'full-window recency-weighted mpg only, season decay 0.85; k=180; percentile-to-truncated-normal.',
  durability: 'full-window recency-weighted games played only, season decay 0.85; k=180; percentile-to-truncated-normal. Known limitation: DNP-CD and role conflation remains; F4/Horizon owns future availability modeling.',
};

export function renderRatingsContract(input: NbaDerivationInput, result: NbaDerivationResult): string {
  const players = [...input.players].sort((a, b) => a.personId - b.personId);
  const rostered = players.filter((player) => result.rosteredPersonIds.has(player.personId));
  const derived = rostered.map((player) => ({ values: result.ratingsByPerson.get(player.personId)! }));
  const raw = rostered.map((player) => ({ values: result.rawScores.get(player.personId)! }));
  const current = input.activeRatings.map((values) => ({ values }));
  const out: string[] = [];
  out.push('# S2b — NBA Ratings Statistical Contract');
  out.push('', '> Generated by `scripts/build-league.ts` (`npm run build-league`). Regenerate; never hand-edit.', '> `--check` byte-compares this file against a fresh derivation.', '');
  out.push('## Provenance', '', '- Normalized schema version: **3**', `- Recent windows: **${RECENT_SEASONS.join(', ')}** with weights **0.55 / 0.30 / 0.15** (newest first).`, `- Full-window stamina/durability seasonal decay: **${FULL_WINDOW_SEASON_DECAY}**.`, `- Eligible percentile population: **${players.length}**; rostered check population: **${rostered.length}**.`, '- Percentile ties: ascending `personId`.', `- Shrinkage: position-conditional rostered prior; weight = n / (n + k); measured biometric metrics bypass shrinkage; FT explicitly uses the rostered league FTA-weighted prior; full-confidence log threshold n=${FULL_CONFIDENCE_SAMPLE}.`, `- FT inverse: rating = 40 + (pct - ${FT_LEAGUE_AVG_PCT}) × ${FT_DERIVE_SCALE}; engine clamps ${FT_SIM_PCT_MIN}..${FT_SIM_PCT_MAX}.`, '- Tail policy: retain the percentile-to-truncated-normal map with no discrete top-end target. Its compressed star separation versus the heuristic pool is an explicit S2b decision; S2d owns behavioral evaluation of profile bands and team-strength spread and whether a fatter-tailed remap is needed.', '- Non-FT target SDs remain active-pool compatibility priors to keep modifier spread unchanged through activation, not empirical truth; the existing floor is Math.max(4, active-pool SD). There is no deliberate deviation for S2d to absorb beyond the mapping itself.', '');
  out.push('## Per-rating derivation policy', '', '| Rating | Inputs, formula, window, shrinkage, mapping |', '| --- | --- |');
  for (const rating of RATING_KEYS) out.push(`| ${rating} | ${RATING_DOCUMENTATION[rating]} |`);
  out.push('', '## Center, spread, and tails', '', '| Rating | Derived mean | Target SD | Derived SD | p1 | p99 | Derived 75+ | Current 75+ |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const rating of RATING_KEYS) {
    const d = result.distributions[rating]; const c = result.currentDistributions[rating];
    out.push(`| ${rating} | ${d.mean.toFixed(2)} | ${d.targetSd.toFixed(2)} | ${d.sd.toFixed(2)} | ${d.p1} | ${d.p99} | ${d.count75Plus} | ${c.count75Plus} |`);
  }
  out.push('', `> FT deliberately targets SD ${FREE_THROW_TARGET_SD.toFixed(2)} rather than the active-pool diagnostic SD, because its inverse preserves the shrunk real-percentage scale. Its declared mean band is ±${FREE_THROW_MEAN_TOLERANCE.toFixed(2)}: the FTA-weighted league anchor and the unweighted player check population need not coincide. All other target SDs are active-pool compatibility diagnostics with a ±${RATING_MEAN_TOLERANCE.toFixed(2)} mean band.`);
  out.push('', '## Shrinkage and deterministic fallback log', '', '| Reason | Count |', '| --- | --- |');
  const reasonCounts = new Map<string, number>();
  for (const entry of result.fallbackLog) reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  for (const reason of [...reasonCounts.keys()].sort()) out.push(`| ${reason} | ${reasonCounts.get(reason)} |`);
  out.push('', '| Player id | Field | Reason |', '| --- | --- | --- |');
  for (const entry of result.fallbackLog) out.push(`| ${entry.playerId} | ${entry.field} | ${entry.reason} |`);
  out.push('', '## Correlation preservation', '');
  out.push(...matrixLines('Derived ratings (rostered)', derived), '', ...matrixLines('Current active-pool ratings', current), '', ...matrixLines('Underlying shrunk/blended metrics (rostered)', raw));
  out.push('', '### Largest correlation deltas', '', '| Comparison | Rating pair | Left r | Right r | Absolute delta |', '| --- | --- | ---: | ---: | ---: |');
  for (const delta of correlationDeltas(derived, raw)) out.push(`| derived vs raw | ${delta.pair} | ${delta.left.toFixed(2)} | ${delta.right.toFixed(2)} | ${delta.delta.toFixed(2)} |`);
  for (const delta of correlationDeltas(derived, current)) out.push(`| derived vs current | ${delta.pair} | ${delta.left.toFixed(2)} | ${delta.right.toFixed(2)} | ${delta.delta.toFixed(2)} |`);
  const defenseCorrelation = pearson(
    rostered.map((player) => result.ratingsByPerson.get(player.personId)!.perimeterDefense),
    rostered.map((player) => result.ratingsByPerson.get(player.personId)!.interiorDefense),
  );
  out.push('', `- Enforced defense split check: Pearson r(perimeterDefense, interiorDefense) = **${defenseCorrelation.toFixed(3)}**, ceiling **${PERIMETER_INTERIOR_DEFENSE_R_MAX.toFixed(2)}**.`, '');
  out.push('Derived-vs-raw deltas are attributable to discrete 1–80 quantization, the FT inverse exception, and target-spread normalization after the monotone rank map. Derived-vs-current deltas are expected and intentional: the current pool is position-heuristic output, while this candidate uses sampled NBA metrics. No engine behavior is asserted here; S2d owns the activated-pool behavioral backstop.');
  out.push('', '## Modifier histograms', '', 'Fixed bins use the exported engine modifier formula. Counts compare the rostered candidate to the active pool.', '');
  for (const rating of RATING_KEYS) {
    const candidateCounts = histogram(rostered.map((player) => ratingToModifier(result.ratingsByPerson.get(player.personId)![rating])));
    const activeCounts = histogram(input.activeRatings.map((player) => ratingToModifier(player[rating])));
    out.push(`### ${rating}`, '', '```text', 'bin              candidate  current');
    const labels = ['< -0.11', '-0.11..-0.08', '-0.08..-0.05', '-0.05..-0.02', '-0.02..0.01', '0.01..0.04', '0.04..0.07', '0.07..0.10', '>= 0.10'];
    for (let i = 0; i < labels.length; i++) out.push(`${labels[i].padEnd(15)} ${String(candidateCounts[i]).padStart(9)} ${String(activeCounts[i]).padStart(8)}`);
    out.push('```', '');
  }
  out.push('## Top-10 diagnostics', '');
  for (const rating of RATING_KEYS) {
    out.push(`### ${rating}`, '', '| Player | Rating | Named input metrics and samples |', '| --- | ---: | --- |');
    const top = [...players].sort((a, b) => result.ratingsByPerson.get(b.personId)![rating] - result.ratingsByPerson.get(a.personId)![rating] || a.personId - b.personId).slice(0, 10);
    for (const player of top) out.push(`| ${player.id} | ${result.ratingsByPerson.get(player.personId)![rating]} | ${result.inputsByPerson.get(player.personId)!.join('; ')} |`);
    out.push('');
  }
  out.push('## Behavioral backstop', '', '**Deferred to S2d.** This candidate-only unit does not activate the pool, alter the engine, or tune the profile. S2d owns activation, spacing/versatility re-baselining, the FT-anchor decision, and a behavioral profile PASS on the new pool.', '');
  return out.join('\n');
}
