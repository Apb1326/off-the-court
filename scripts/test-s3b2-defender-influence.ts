/** Focused deterministic contract for S3.b2 defender influence. */
import * as fs from 'fs';
import * as path from 'path';

import {
  S3B2_INTERIOR_WEIGHT_BY_ZONE,
  S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT,
  S3B2_RIM_INTERIOR_WEIGHT,
  S3B2_SHARED_THREE_INTERIOR_WEIGHT,
  S3B2_SHORT_MIDRANGE_INTERIOR_WEIGHT,
} from '../src/engine/constants';
import { getEffectiveRating } from '../src/engine/fatigue';
import {
  blendDefenderRating,
  getDefenderModifier,
  getDefenderRating,
  ratingToModifier,
  resolveShot,
} from '../src/engine/shot';
import type { ShotContext } from '../src/engine/shot';
import { SeededRNG } from '../src/lib/rng';
import type { ShotZone } from '../src/models/game';
import type { Player, PlayerRatings } from '../src/models/player';

const ZONES: readonly ShotZone[] = [
  'rim', 'short_midrange', 'long_midrange',
  'corner_three', 'above_break_three', 'deep_three',
];
const FATIGUE_GRID = [0, 0.1, 0.25, 0.5, 0.75, 1] as const;
const SAMPLE_SHOTS = 25_000;
const PROBABILITY_TOLERANCE = 1e-12;

const BLOCKED_TRACE = [0.6270739405881613, 0.002735721180215478] as const;
const UNBLOCKED_TRACE = [
  0.6011037519201636,
  0.44829055899754167,
  0.8524657934904099,
  0.6697340414393693,
] as const;

class TracingRNG extends SeededRNG {
  readonly values: number[] = [];
  readonly booleanProbabilities: number[] = [];

  override next(): number {
    const value = super.next();
    this.values.push(value);
    return value;
  }

  override nextBool(probability: number = 0.5): boolean {
    this.booleanProbabilities.push(probability);
    return super.nextBool(probability);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ratings(overrides: Partial<PlayerRatings> = {}): PlayerRatings {
  return {
    outsideShooting: 40,
    midrangeShooting: 40,
    interiorScoring: 40,
    freeThrowShooting: 40,
    ballHandling: 40,
    passing: 40,
    offensiveIQ: 40,
    perimeterDefense: 40,
    interiorDefense: 40,
    defensiveIQ: 40,
    steal: 40,
    block: 1,
    athleticism: 40,
    strength: 40,
    rebounding: 40,
    stamina: 40,
    durability: 40,
    ...overrides,
  };
}

function player(id: string, overrides: Partial<PlayerRatings> = {}): Player {
  const playerRatings = ratings(overrides);
  return {
    id,
    firstName: id,
    lastName: id,
    position: 'SF',
    height: 79,
    weight: 220,
    age: 26,
    experience: 4,
    teamId: id.startsWith('S') ? 'OFF' : 'DEF',
    jerseyNumber: 0,
    ratings: playerRatings,
    potential: { ...playerRatings },
    scoutingAccuracy: 1,
    tendencies: {
      isolationFreq: 0.1,
      pickAndRollBallHandlerFreq: 0.1,
      pickAndRollScreenerFreq: 0.1,
      postUpFreq: 0.1,
      spotUpFreq: 0.1,
      transitionFreq: 0.1,
      cutFreq: 0.1,
      offScreenFreq: 0.1,
      handoffFreq: 0.1,
      threePointRate: 0.4,
      midrangeRate: 0.2,
      rimRate: 0.4,
      drawFoulRate: 0.1,
      assistRate: 0.1,
      usageRate: 0.2,
      reboundRate: 0.1,
    },
    contract: { type: 'veteran', salarySchedule: [1], noTradeClause: false },
    health: { healthy: true },
    careerStats: [],
  };
}

function exactArray(actual: readonly number[], expected: readonly number[], label: string): void {
  assert(actual.length === expected.length, `${label}: draw count ${actual.length} != ${expected.length}`);
  for (let index = 0; index < expected.length; index++) {
    assert(actual[index] === expected[index], `${label}: draw ${index} changed`);
  }
}

function constantsContract(): void {
  const sources = {
    rim: S3B2_RIM_INTERIOR_WEIGHT,
    short_midrange: S3B2_SHORT_MIDRANGE_INTERIOR_WEIGHT,
    long_midrange: S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT,
    corner_three: S3B2_SHARED_THREE_INTERIOR_WEIGHT,
    above_break_three: S3B2_SHARED_THREE_INTERIOR_WEIGHT,
    deep_three: S3B2_SHARED_THREE_INTERIOR_WEIGHT,
  } satisfies Record<ShotZone, number>;
  for (const zone of ZONES) {
    const weight = S3B2_INTERIOR_WEIGHT_BY_ZONE[zone];
    assert(Number.isFinite(weight), `${zone}: weight is not finite`);
    assert(weight >= 0 && weight <= 1, `${zone}: weight is outside [0, 1]`);
    assert(weight === sources[zone], `${zone}: lookup does not equal its named source`);
    assert(Math.abs(weight + (1 - weight) - 1) <= PROBABILITY_TOLERANCE, `${zone}: complementary weights do not sum to one`);
  }
  assert(S3B2_RIM_INTERIOR_WEIGHT > 0.5, 'rim is not interior-defense dominant');
  assert(S3B2_SHARED_THREE_INTERIOR_WEIGHT < 0.5, 'shared 3PT is not perimeter-defense dominant');
  assert(S3B2_SHORT_MIDRANGE_INTERIOR_WEIGHT === 0.589576, 'short-midrange constant differs from generated full-window value');
  assert(S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT === 0, 'long-midrange legacy fallback is not zero');

  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'engine', 'constants.ts'), 'utf8');
  for (const zone of ['corner_three', 'above_break_three', 'deep_three']) {
    assert(
      source.includes(`${zone}: S3B2_SHARED_THREE_INTERIOR_WEIGHT`),
      `${zone}: source does not reference the shared 3PT constant`,
    );
  }
  assert(
    source.includes('long_midrange: S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT'),
    'long_midrange does not reference the separately named legacy fallback',
  );
  const report = fs.readFileSync(path.join(process.cwd(), 'docs', 'S3B2_DEFENDER_INFLUENCE.md'), 'utf8');
  assert(report.includes('| short_midrange | 6–10ft (approximate mapping) | 0.589576 |'), 'report/short-midrange constant mismatch');
  assert(report.includes('| long_midrange | long two | 0.000000 | separately named legacy fallback;'), 'report does not label long-midrange as a legacy fallback');
}

function degenerateEquivalence(): void {
  for (let perimeter = 1; perimeter <= 80; perimeter++) {
    for (let interior = 1; interior <= 80; interior++) {
      for (const zone of ZONES) {
        const degenerateWeight = zone === 'rim' ? 1 : 0;
        for (const fatigue of FATIGUE_GRID) {
          const blended = blendDefenderRating(perimeter, interior, degenerateWeight);
          const candidate = -ratingToModifier(getEffectiveRating(blended, fatigue));
          const legacyRaw = zone === 'rim' ? interior : perimeter;
          const legacy = -ratingToModifier(getEffectiveRating(legacyRaw, fatigue));
          assert(candidate === legacy, `${zone}/${perimeter}/${interior}/${fatigue}: degenerate formula changed`);
        }
      }
    }
  }
}

function centeringAndFatigueContract(): void {
  const average = player('D-average');
  for (const zone of ZONES) {
    assert(getDefenderRating(average, zone) === 40, `${zone}: raw 40/40 defender is not 40`);
    assert(getDefenderModifier(average, 0, zone) === 0, `${zone}: raw 40/40 defender modifier is not zero`);
  }

  const defender = player('D-fatigue', { perimeterDefense: 23, interiorDefense: 71 });
  const zone: ShotZone = 'short_midrange';
  const fatigue = 0.4;
  const raw = blendDefenderRating(23, 71, S3B2_INTERIOR_WEIGHT_BY_ZONE[zone]);
  const expected = -ratingToModifier(getEffectiveRating(raw, fatigue));
  const doubleFatigued = -ratingToModifier(getEffectiveRating(getEffectiveRating(raw, fatigue), fatigue));
  const actual = getDefenderModifier(defender, fatigue, zone);
  assert(actual === expected, 'fatigue was not applied after raw blending exactly once');
  assert(actual !== doubleFatigued, 'fatigue-once fixture does not distinguish a double application');
}

function rngTraceContract(): void {
  const shooter = player('S-trace');
  const defender = player('D-trace', { block: 80 });

  const blockedRng = new TracingRNG(1);
  const blocked = resolveShot(shooter, 0, defender, 0, 'rim', 'spot_up', blockedRng);
  assert(blocked.blocked && !blocked.made && !blocked.fouled, 'blocked trace result changed');
  exactArray(blockedRng.values, BLOCKED_TRACE, 'blocked trace');

  const unblockedRng = new TracingRNG(42);
  const unblocked = resolveShot(shooter, 0, defender, 0, 'rim', 'spot_up', unblockedRng);
  assert(!unblocked.blocked && !unblocked.made && !unblocked.fouled, 'unblocked trace result changed');
  exactArray(unblockedRng.values, UNBLOCKED_TRACE, 'unblocked trace');
}

function resolvedMakeProbability(
  zone: ShotZone,
  perimeterDefense: number,
  interiorDefense: number,
  ctx: ShotContext = {},
): number {
  const shooter = player(`S-probability-${zone}`);
  const defender = player(`D-probability-${zone}`, { perimeterDefense, interiorDefense, block: 1 });
  const rng = new TracingRNG(42);
  const result = resolveShot(shooter, 0, defender, 0, zone, 'spot_up', rng, 0, ctx);
  assert(!result.blocked, `${zone}: probability fixture unexpectedly blocked`);
  assert(rng.booleanProbabilities.length === 3, `${zone}: probability fixture draw shape changed`);
  return rng.booleanProbabilities[1];
}

function sampleMakes(zone: ShotZone, perimeterDefense: number, interiorDefense: number, seed: number): number {
  const shooter = player(`S-${zone}`);
  const defender = player(`D-${zone}`, { perimeterDefense, interiorDefense, block: 1 });
  const rng = new SeededRNG(seed);
  let made = 0;
  for (let shot = 0; shot < SAMPLE_SHOTS; shot++) {
    if (resolveShot(shooter, 0, defender, 0, zone, 'spot_up', rng).made) made++;
  }
  return made;
}

function additiveAndMonotonicContract(): string[] {
  const lines: string[] = [];
  for (let index = 0; index < ZONES.length; index++) {
    const zone = ZONES[index];
    const weight = S3B2_INTERIOR_WEIGHT_BY_ZONE[zone];
    const lowPerimeter = player('D-low-p', { perimeterDefense: 20, interiorDefense: 40 });
    const highPerimeter = player('D-high-p', { perimeterDefense: 60, interiorDefense: 40 });
    const lowInterior = player('D-low-i', { perimeterDefense: 40, interiorDefense: 20 });
    const highInterior = player('D-high-i', { perimeterDefense: 40, interiorDefense: 60 });
    const lowPerimeterMod = getDefenderModifier(lowPerimeter, 0, zone);
    const highPerimeterMod = getDefenderModifier(highPerimeter, 0, zone);
    const lowInteriorMod = getDefenderModifier(lowInterior, 0, zone);
    const highInteriorMod = getDefenderModifier(highInterior, 0, zone);
    const lowPerimeterProbability = resolvedMakeProbability(zone, 20, 40);
    const highPerimeterProbability = resolvedMakeProbability(zone, 60, 40);
    const lowInteriorProbability = resolvedMakeProbability(zone, 40, 20);
    const highInteriorProbability = resolvedMakeProbability(zone, 40, 60);
    assert(
      Math.abs((lowPerimeterProbability - highPerimeterProbability)
        - (lowPerimeterMod - highPerimeterMod)) <= PROBABILITY_TOLERANCE,
      `${zone}: perimeter defender term is not a single additive term`,
    );
    assert(
      Math.abs((lowInteriorProbability - highInteriorProbability)
        - (lowInteriorMod - highInteriorMod)) <= PROBABILITY_TOLERANCE,
      `${zone}: interior defender term is not a single additive term`,
    );
    assert(highPerimeterProbability <= lowPerimeterProbability, `${zone}: higher perimeter defense increased make probability`);
    assert(highInteriorProbability <= lowInteriorProbability, `${zone}: higher interior defense increased make probability`);
    if (weight < 1) assert(highPerimeterProbability < lowPerimeterProbability, `${zone}: positive perimeter weight lacks strict effect`);
    else assert(highPerimeterProbability === lowPerimeterProbability, `${zone}: zero perimeter weight changed probability`);
    if (weight > 0) assert(highInteriorProbability < lowInteriorProbability, `${zone}: positive interior weight lacks strict effect`);
    else assert(highInteriorProbability === lowInteriorProbability, `${zone}: zero interior weight changed probability`);

    const seed = 30_000 + index;
    const lowPerimeterMakes = sampleMakes(zone, 20, 40, seed);
    const highPerimeterMakes = sampleMakes(zone, 60, 40, seed);
    const lowInteriorMakes = sampleMakes(zone, 40, 20, seed);
    const highInteriorMakes = sampleMakes(zone, 40, 60, seed);
    if (weight < 1) assert(highPerimeterMakes < lowPerimeterMakes, `${zone}: fixed-seed perimeter A/B lacks strict decrease`);
    else assert(highPerimeterMakes === lowPerimeterMakes, `${zone}: fixed-seed zero perimeter weight changed outcomes`);
    if (weight > 0) assert(highInteriorMakes < lowInteriorMakes, `${zone}: fixed-seed interior A/B lacks strict decrease`);
    else assert(highInteriorMakes === lowInteriorMakes, `${zone}: fixed-seed zero interior weight changed outcomes`);
    lines.push(`${zone}:P ${lowPerimeterMakes}->${highPerimeterMakes}, I ${lowInteriorMakes}->${highInteriorMakes}`);
  }

  assert(resolvedMakeProbability('rim', 40, 40, { effortMod: 1 }) === 0.95, 'upper probability clamp failed');
  assert(resolvedMakeProbability('rim', 40, 40, { effortMod: -1 }) === 0.05, 'lower probability clamp failed');
  return lines;
}

function main(): void {
  constantsContract();
  degenerateEquivalence();
  centeringAndFatigueContract();
  rngTraceContract();
  const samples = additiveAndMonotonicContract();
  console.log(`Derived weights: rim=${S3B2_RIM_INTERIOR_WEIGHT.toFixed(6)}, short=${S3B2_SHORT_MIDRANGE_INTERIOR_WEIGHT.toFixed(6)}, shared3=${S3B2_SHARED_THREE_INTERIOR_WEIGHT.toFixed(6)}; long-mid legacy=${S3B2_LONG_MIDRANGE_LEGACY_INTERIOR_WEIGHT}.`);
  console.log(`Fixed-seed make A/B (${SAMPLE_SHOTS} shots each): ${samples.join(' | ')}`);
  console.log(`RNG traces: blocked=${BLOCKED_TRACE.join(',')} | unblocked=${UNBLOCKED_TRACE.join(',')}.`);
  console.log('S3B2 DEFENDER INFLUENCE PASSED: bounds/references, legacy equivalence, centering, full-window values, fatigue-once ordering, fixed RNG traces, additive monotonic effects, and clamp edges.');
}

main();
