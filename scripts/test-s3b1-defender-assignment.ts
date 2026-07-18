/** Focused deterministic contract for S3.b1 defender assignment. */
import { S3B1_DEFENDER_MIN_WEIGHT, S3B1_MATCHUP_LIFT, S3B1_SECONDARY_POS_FACTOR } from '../src/engine/constants';
import { explainDefenderSelection, selectDefender } from '../src/engine/play-types';
import { SeededRNG } from '../src/lib/rng';
import type { PlayType } from '../src/models/game';
import type { Player, PlayerRatings, Position } from '../src/models/player';

const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const PLAY_TYPES: readonly PlayType[] = [
  'isolation', 'pick_and_roll', 'post_up', 'spot_up', 'transition',
  'cut', 'off_screen', 'handoff', 'putback',
];
const PROBABILITY_TOLERANCE = 1e-12;
const SAMPLE_DRAWS = 120_000;
const SAMPLE_DIRECTION_TOLERANCE = 0.01;

class CountingRNG extends SeededRNG {
  draws = 0;
  override next(): number {
    this.draws++;
    return super.next();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ratings(avgDef: number, perimeterDefense = avgDef): PlayerRatings {
  return {
    outsideShooting: 40, midrangeShooting: 40, interiorScoring: 40, freeThrowShooting: 40,
    ballHandling: 40, passing: 40, offensiveIQ: 40,
    perimeterDefense, interiorDefense: avgDef, defensiveIQ: avgDef,
    steal: 40, block: 40, athleticism: 45, strength: 40, rebounding: 40,
    stamina: 40, durability: 40,
  };
}

function player(
  id: string,
  position: Position,
  avgDef = 40,
  options: { secondaryPosition?: Position; perimeterDefense?: number; athleticism?: number; height?: number } = {},
): Player {
  const r = ratings(avgDef, options.perimeterDefense ?? avgDef);
  r.athleticism = options.athleticism ?? 45;
  return {
    id, firstName: id, lastName: id, position,
    ...(options.secondaryPosition === undefined ? {} : { secondaryPosition: options.secondaryPosition }),
    height: options.height ?? 78, weight: 220, age: 26, experience: 4,
    teamId: id.startsWith('S') ? 'OFF' : 'DEF', jerseyNumber: 0,
    ratings: r, potential: { ...r }, scoutingAccuracy: 1,
    tendencies: {
      isolationFreq: 0.1, pickAndRollBallHandlerFreq: 0.1, pickAndRollScreenerFreq: 0.1,
      postUpFreq: 0.1, spotUpFreq: 0.1, transitionFreq: 0.1, cutFreq: 0.1,
      offScreenFreq: 0.1, handoffFreq: 0.1, threePointRate: 0.33, midrangeRate: 0.33,
      rimRate: 0.34, drawFoulRate: 0.1, assistRate: 0.1, usageRate: 0.2, reboundRate: 0.1,
    },
    contract: { type: 'veteran', salarySchedule: [1], noTradeClause: false },
    health: { healthy: true }, careerStats: [],
  };
}

function balanced(): Player[] {
  return POSITIONS.map((position) => player(`D-${position}`, position));
}

function sample(
  defenders: Player[],
  shooter: Player,
  playType: PlayType,
  seed: number,
  draws = SAMPLE_DRAWS,
): Record<string, number> {
  const counts = Object.fromEntries(defenders.map((defender) => [defender.id, 0])) as Record<string, number>;
  const rng = new SeededRNG(seed);
  for (let i = 0; i < draws; i++) counts[selectDefender(defenders, shooter, rng, playType).id]++;
  return Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / draws]));
}

function validateWeights(defenders: Player[], shooter: Player, playType: PlayType): void {
  const factors = explainDefenderSelection(defenders, shooter, playType);
  assert(factors.length === defenders.length, 'factor count differs from lineup size');
  const maxRaw = Math.max(...factors.map((factor) => factor.rawWeight));
  let total = 0;
  for (const factor of factors) {
    assert(Number.isFinite(factor.finalWeight), `${factor.defenderId}: final weight is not finite`);
    assert(factor.finalWeight >= 0, `${factor.defenderId}: final weight is negative`);
    assert(
      factor.finalWeight + PROBABILITY_TOLERANCE >= S3B1_DEFENDER_MIN_WEIGHT * maxRaw,
      `${factor.defenderId}: final weight is below relative floor`,
    );
    total += factor.finalWeight;
  }
  assert(total > 0 && Number.isFinite(total), 'weight total must be positive and finite');
}

function fixedDrawContract(): void {
  const lineups = [
    balanced(),
    POSITIONS.map((position, index) => player(`X-${position}`, position, 10 + index * 17, {
      secondaryPosition: index % 2 === 0 ? 'C' : undefined,
    })),
  ];
  for (const defenders of lineups) {
    for (const playType of PLAY_TYPES) {
      const rng = new CountingRNG(7_000 + PLAY_TYPES.indexOf(playType));
      selectDefender(defenders, player('S-PG', 'PG'), rng, playType);
      assert(rng.draws === 1, `${playType}: expected exactly one RNG draw, got ${rng.draws}`);
      validateWeights(defenders, player('S-PG', 'PG'), playType);
    }
  }
}

function balancedLiftContract(): void {
  const defenders = balanced();
  for (const shooterPosition of ['PG', 'SF', 'C'] as const) {
    const shooter = player(`S-${shooterPosition}`, shooterPosition);
    const factors = explainDefenderSelection(defenders, shooter, 'spot_up');
    const bucket = factors[0].shooterBucket;
    const liftTotal = POSITIONS.reduce((sum, position) => sum + S3B1_MATCHUP_LIFT[position][bucket], 0);
    const weightTotal = factors.reduce((sum, factor) => sum + factor.finalWeight, 0);
    for (let i = 0; i < POSITIONS.length; i++) {
      const expected = S3B1_MATCHUP_LIFT[POSITIONS[i]][bucket] / liftTotal;
      const actual = factors[i].finalWeight / weightTotal;
      assert(Math.abs(actual - expected) <= PROBABILITY_TOLERANCE, `${bucket}/${POSITIONS[i]} is not lift-normalized`);
    }
  }
}

function empiricalDirections(): string[] {
  const defenders = balanced();
  const cases = [
    { shooter: player('S-G', 'PG'), expected: 'PG' as Position, seed: 101 },
    { shooter: player('S-F', 'SF'), expected: 'PF' as Position, seed: 202 },
    { shooter: player('S-C', 'C'), expected: 'C' as Position, seed: 303 },
  ];
  const lines: string[] = [];
  for (const item of cases) {
    const rates = sample(defenders, item.shooter, 'spot_up', item.seed);
    const ranked = [...defenders].sort((a, b) => rates[b.id] - rates[a.id]);
    assert(ranked[0].position === item.expected, `${item.shooter.position}: sampled lift leader is ${ranked[0].position}`);
    const factors = explainDefenderSelection(defenders, item.shooter, 'spot_up');
    const total = factors.reduce((sum, factor) => sum + factor.finalWeight, 0);
    const expectedRate = factors.find((factor) => factor.position === item.expected)!.finalWeight / total;
    assert(Math.abs(rates[ranked[0].id] - expectedRate) < SAMPLE_DIRECTION_TOLERANCE, `${item.shooter.position}: sampled leader misses computed probability`);
    lines.push(`${factors[0].shooterBucket}:${item.expected}=${rates[ranked[0].id].toFixed(4)}`);
  }
  return lines;
}

function secondaryAndShooterContract(): void {
  const secondary = player('D-secondary', 'PG', 40, { secondaryPosition: 'C' });
  const others = [player('D-SG', 'SG'), player('D-SF', 'SF'), player('D-PF', 'PF'), player('D-C', 'C')];
  const shooter = player('S-C', 'C');
  const factor = explainDefenderSelection([secondary, ...others], shooter, 'spot_up')[0];
  const expected = Math.max(
    S3B1_MATCHUP_LIFT.PG.C,
    S3B1_SECONDARY_POS_FACTOR * S3B1_MATCHUP_LIFT.C.C,
  );
  assert(Math.abs(factor.posTerm - expected) <= PROBABILITY_TOLERANCE, 'secondary position does not use locked max blend');

  const shooterWithSecondary = { ...player('S-PG-secondary', 'PG'), secondaryPosition: 'C' as Position };
  const base = explainDefenderSelection(balanced(), player('S-PG-base', 'PG'), 'spot_up');
  const withSecondary = explainDefenderSelection(balanced(), shooterWithSecondary, 'spot_up');
  assert(
    JSON.stringify(base.map((factor) => factor.finalWeight)) === JSON.stringify(withSecondary.map((factor) => factor.finalWeight)),
    'shooter secondary position changed assignment weights',
  );
}

function weakLinkLineup(values: readonly number[], prefix: string): Player[] {
  return values.map((value, index) => player(`${prefix}-${index}`, 'C', value, {
    perimeterDefense: value,
    athleticism: 45 + index,
    height: 78 + index,
  }));
}

function huntContract(): string[] {
  const defenders = weakLinkLineup([20, 55, 55, 55, 55], 'hunt');
  const shooter = player('S-PG-hunt', 'PG');
  for (const playType of ['isolation', 'post_up'] as const) {
    const factors = explainDefenderSelection(defenders, shooter, playType);
    assert(factors[0].huntTerm > factors[1].huntTerm, `${playType}: weak link lacks larger hunt term`);
    const hunted = sample(defenders, shooter, playType, playType === 'isolation' ? 401 : 402);
    const neutral = sample(defenders, shooter, 'spot_up', playType === 'isolation' ? 501 : 502);
    assert(hunted[defenders[0].id] > neutral[defenders[0].id], `${playType}: weak link not hunted above neutral`);
  }

  const switchable = POSITIONS.map((_, index) => player(`switch-${index}`, 'C', 40, {
    perimeterDefense: 45, athleticism: 47 + (index % 2), height: 78 + (index % 2),
  }));
  const studsSievePerimeter = [52, 52, 52, 52, 17];
  const studsSieve = studsSievePerimeter.map((perimeter, index) => player(`sieve-${index}`, 'C', 40, {
    perimeterDefense: perimeter,
    athleticism: [52, 50, 51, 49, 25][index],
    height: [78, 79, 80, 81, 74][index],
  }));
  const switchRate = sample(switchable, shooter, 'isolation', 601)[switchable[0].id];
  const sieveRate = sample(studsSieve, shooter, 'isolation', 602)[studsSieve[4].id];
  assert(sieveRate > switchRate, 'switchable lineup did not suppress weak-link hunting');

  const above40 = weakLinkLineup([45, 60, 65, 70, 75], 'above40');
  const aboveFactors = explainDefenderSelection(above40, shooter, 'isolation');
  assert(aboveFactors[0].huntTerm > aboveFactors[4].huntTerm, 'above-40 relative weak link lacks larger hunt term');
  const aboveHunt = sample(above40, shooter, 'isolation', 701);
  const aboveNeutral = sample(above40, shooter, 'spot_up', 702);
  const aboveGap = aboveHunt[above40[0].id] - aboveNeutral[above40[0].id];
  assert(aboveGap > 0, 'above-40 relative weak link is not shifted above neutral');

  return [
    `switchable=${switchRate.toFixed(4)}`,
    `studs+sieve=${sieveRate.toFixed(4)}`,
    `above40-gap=${aboveGap.toFixed(4)}`,
  ];
}

function repeatContract(): void {
  const run = () => JSON.stringify(sample(balanced(), player('S-repeat', 'SF'), 'isolation', 808, 50_000));
  assert(run() === run(), 'same-seed sampled output differs on repeat');
}

function main(): void {
  fixedDrawContract();
  balancedLiftContract();
  secondaryAndShooterContract();
  const directions = empiricalDirections();
  const hunts = huntContract();
  repeatContract();
  console.log(`Lift leaders: ${directions.join(' | ')}`);
  console.log(`Hunt rates: ${hunts.join(' | ')}`);
  console.log(`Reachability: every final weight is finite, positive, and ≥ ${S3B1_DEFENDER_MIN_WEIGHT.toFixed(2)} × lineup max raw weight.`);
  console.log('S3B1 DEFENDER ASSIGNMENT PASSED: fixed one-draw selection, lift fidelity, max-blend secondary positions, signed weak-link hunting, switchability suppression, and repeat identity.');
}

main();
