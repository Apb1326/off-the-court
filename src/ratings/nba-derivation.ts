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

/**
 * Season-relative derivation policy. The production default below is frozen;
 * historical validation supplies the same weights relative to its target
 * season so a row never sees a later season.
 */
export interface NbaDerivationOptions {
  recentSeasons: readonly string[];
  recentSeasonWeights: Readonly<Record<string, number>>;
  fullWindowLatestStartYear: number;
}

export const PRODUCTION_NBA_DERIVATION_OPTIONS: NbaDerivationOptions = {
  recentSeasons: RECENT_SEASONS,
  recentSeasonWeights: RECENT_SEASON_WEIGHTS,
  fullWindowLatestStartYear: 2025,
};

function seasonStartYear(season: string): number {
  const start = Number.parseInt(season.slice(0, 4), 10);
  if (!Number.isFinite(start)) throw new Error(`Invalid NBA season: ${season}`);
  return start;
}

/** Build the production recency/full-window policy relative to a target season. */
export function seasonRelativeNbaDerivationOptions(targetSeason: string): NbaDerivationOptions {
  const targetStart = seasonStartYear(targetSeason);
  const recentSeasons = [0, 1, 2].map((offset) => `${targetStart - offset}-${String((targetStart - offset + 1) % 100).padStart(2, '0')}`);
  const recentSeasonWeights: Record<string, number> = {
    [recentSeasons[0]]: 0.55,
    [recentSeasons[1]]: 0.30,
    [recentSeasons[2]]: 0.15,
  };
  return { recentSeasons, recentSeasonWeights, fullWindowLatestStartYear: targetStart };
}
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
/**
 * Fixed S2b compatibility target SDs, frozen at S2d activation.
 *
 * Provenance: per-rating `standardDeviation()` over the retired heuristic
 * active pool (`data/players.json` as of the S2d preflight, repo at commit
 * 9ee5dfa, 2026-07-12) — the values the pre-S2d builder derived at build time.
 * The source pool was overwritten at promotion and no copy survives, so these
 * cannot be re-derived; they are now
 * ordinary tuning constants. Per ROADMAP §"Center and spread" they are
 * compatibility priors, NOT empirical truth: adjust deliberately, with
 * profile evidence, when a rating's spread should change — never by
 * re-snapshotting whatever pool happens to be active.
 */
export const S2B_TARGET_SDS: Record<RatingKey, number> = {
  outsideShooting: 14.332552935488, midrangeShooting: 14.293164473580,
  interiorScoring: 12.878931833376, freeThrowShooting: FREE_THROW_TARGET_SD,
  ballHandling: 13.414714926446, passing: 10.285200005365,
  offensiveIQ: 10.697189450655, perimeterDefense: 8.782679774367,
  interiorDefense: 10.685463129953, defensiveIQ: 8.653630777845,
  steal: 11.590999574363, block: 9.669353759438,
  athleticism: 9.153571748241, strength: 10.048293219099,
  rebounding: 10.510453289826, stamina: 14.941098686540,
  durability: 16.087959546531,
};

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

export interface NbaDerivationResult {
  ratingsByPerson: Map<number, PlayerRatings>;
  continuousFreeThrowRatings: Map<number, number>;
  freeThrowPercentages: Map<number, number>;
  fallbackLog: FallbackLogEntry[];
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

function recentBox(player: NbaDerivationPlayer, options: NbaDerivationOptions): { row: BoxAdvancedRow; weight: number }[] {
  const bySeason = new Map(player.boxSeasons.map((entry) => [entry.season, entry.row]));
  return options.recentSeasons.flatMap((season) => {
    const row = bySeason.get(season);
    const weight = options.recentSeasonWeights[season];
    return row && weight !== undefined ? [{ row, weight }] : [];
  });
}

function aggregateBoxMetric(
  player: NbaDerivationPlayer,
  read: (row: BoxAdvancedRow) => number | null | undefined,
  sample: (row: BoxAdvancedRow) => number | null | undefined,
  options: NbaDerivationOptions,
): Metric {
  let numerator = 0;
  let denominator = 0;
  for (const { row, weight } of recentBox(player, options)) {
    const value = read(row);
    const count = sample(row);
    if (!finite(value) || !finite(count) || count <= 0) continue;
    numerator += value * count * weight;
    denominator += count * weight;
  }
  return { id: '', label: '', value: denominator > 0 ? numerator / denominator : 0, n: denominator };
}

function fullWindow(player: NbaDerivationPlayer, options: NbaDerivationOptions): { row: BoxAdvancedRow; weight: number }[] {
  const latestStart = options.fullWindowLatestStartYear;
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
  options: NbaDerivationOptions,
): Metric {
  let numerator = 0;
  let denominator = 0;
  for (const { row, weight } of fullWindow(player, options)) {
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
function aggregateFullGamesPlayed(player: NbaDerivationPlayer, options: NbaDerivationOptions): Metric {
  let numerator = 0;
  let seasonWeight = 0;
  let weightedGames = 0;
  for (const { row, weight } of fullWindow(player, options)) {
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

function recentShotEventAggregate(player: NbaDerivationPlayer, options: NbaDerivationOptions): Record<keyof Omit<ShotEventSeasonAggregate, 'season'>, ZoneAggregate> {
  const zero = (): ZoneAggregate => ({ fgm: 0, fga: 0 });
  const out = {
    midrangeUnder14: zero(), longMidrange: zero(), aboveBreakThree: zero(), deepThree: zero(),
  };
  const bySeason = new Map(player.shotEventSeasons.map((entry) => [entry.season, entry]));
  for (const season of options.recentSeasons) {
    const data = bySeason.get(season);
    if (!data) continue;
    const weight = options.recentSeasonWeights[season];
    if (weight === undefined) continue;
    for (const key of Object.keys(out) as (keyof typeof out)[]) {
      out[key].fgm += data[key].fgm * weight;
      out[key].fga += data[key].fga * weight;
    }
  }
  return out;
}

function recentShotZoneAggregate(player: NbaDerivationPlayer, options: NbaDerivationOptions): Record<'rim' | 'paintNonRa' | 'cornerThree', ZoneAggregate> {
  const out = { rim: { fgm: 0, fga: 0 }, paintNonRa: { fgm: 0, fga: 0 }, cornerThree: { fgm: 0, fga: 0 } };
  const bySeason = new Map(player.shotZoneSeasons.map((entry) => [entry.season, entry.row]));
  for (const season of options.recentSeasons) {
    const row = bySeason.get(season);
    if (!row) continue;
    const weight = options.recentSeasonWeights[season];
    if (weight === undefined) continue;
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

function buildMetrics(player: NbaDerivationPlayer, wingspanCm: number, options: NbaDerivationOptions): Record<RatingKey, Metric[]> {
  const eventShots = recentShotEventAggregate(player, options);
  const zones = recentShotZoneAggregate(player, options);
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
  const ft = aggregateBoxMetric(player, (row) => row.perGame.ftPct, (row) => n(row.perGame.fta) * n(row.gp), options);
  const astPct = aggregateBoxMetric(player, (row) => row.advanced?.astPct, (row) => row.advanced?.poss, options);
  const astTo = aggregateBoxMetric(player, (row) => row.advanced?.astTo, (row) => row.advanced?.poss, options);
  const tovPct = aggregateBoxMetric(player, (row) => row.advanced?.tmTovPct, (row) => row.advanced?.poss, options);
  const rebPct = aggregateBoxMetric(player, (row) => row.advanced?.rebPct, (row) => row.advanced?.poss, options);
  const stl100 = aggregateBoxMetric(player, (row) => row.per100?.stl, (row) => row.advanced?.poss, options);
  const blk100 = aggregateBoxMetric(player, (row) => row.per100?.blk, (row) => row.advanced?.poss, options);
  const fullMpg = aggregateFullMetric(player, (row) => row.mpg, (row) => row.gp, options);
  const fullGp = aggregateFullGamesPlayed(player, options);

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

export function deriveNbaRatings(
  input: NbaDerivationInput,
  options: NbaDerivationOptions = PRODUCTION_NBA_DERIVATION_OPTIONS,
): NbaDerivationResult {
  if (input.players.length === 0) throw new Error('S2b derivation received no eligible players');
  const fallbackLog: FallbackLogEntry[] = [];
  const wingspans = resolveWingspans(input, fallbackLog);
  const work: PlayerWork[] = [...input.players]
    .sort((a, b) => a.personId - b.personId)
    .map((player) => ({
      input: player,
      metrics: buildMetrics(player, wingspans.get(player.personId)!, options),
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
      const target = S2B_TARGET_SDS[rating];
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

  return {
    ratingsByPerson, continuousFreeThrowRatings, freeThrowPercentages,
    fallbackLog: fallbackLog.sort((a, b) => a.playerId.localeCompare(b.playerId) || a.field.localeCompare(b.field) || a.reason.localeCompare(b.reason)),
    rosteredPersonIds: input.rosteredPersonIds,
  };
}
