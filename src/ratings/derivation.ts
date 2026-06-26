import { PlayerRatings, PlayerTendencies, PerGameStats, Position } from '@/models/player';

interface RawPlayerStats {
  gamesPlayed: number;
  minutesPerGame: number;
  stats: PerGameStats;
  position: Position;
  age: number;
  experience: number;
}

export function deriveRatings(raw: RawPlayerStats): PlayerRatings {
  const s = raw.stats;
  const mpg = raw.minutesPerGame || 1;
  const per36 = (stat: number) => (stat / mpg) * 36;

  return {
    outsideShooting: deriveOutsideShooting(s),
    midrangeShooting: deriveMidrangeShooting(s),
    interiorScoring: deriveInteriorScoring(s, raw.position),
    freeThrowShooting: deriveFreeThrowShooting(s),
    ballHandling: deriveBallHandling(s, raw.position),
    passing: derivePassing(s, raw.position),
    offensiveIQ: deriveOffensiveIQ(s),
    perimeterDefense: derivePerimeterDefense(s, raw.position),
    interiorDefense: deriveInteriorDefense(s, raw.position),
    defensiveIQ: deriveDefensiveIQ(s, raw.position),
    steal: deriveSteal(s),
    block: deriveBlock(s, raw.position),
    athleticism: deriveAthleticism(s, raw.age, raw.position),
    strength: deriveStrength(raw.position, raw.age),
    rebounding: deriveRebounding(s, raw.position),
    stamina: deriveStamina(raw.minutesPerGame, raw.gamesPlayed),
    durability: deriveDurability(raw.gamesPlayed),
  };
}

export function deriveTendencies(raw: RawPlayerStats): PlayerTendencies {
  const s = raw.stats;
  const fga = s.fieldGoalsAttempted || 1;
  const threePtRate = s.threePointersAttempted / fga;

  // Estimate shot distribution
  const rimRate = estimateRimRate(raw.position, threePtRate);
  const midrangeRate = Math.max(0.05, 1 - threePtRate - rimRate);

  return {
    isolationFreq: estimateIsoFreq(raw.position, s),
    pickAndRollBallHandlerFreq: estimatePnRHandlerFreq(raw.position, s),
    pickAndRollScreenerFreq: estimatePnRScreenerFreq(raw.position),
    postUpFreq: estimatePostUpFreq(raw.position, s),
    spotUpFreq: estimateSpotUpFreq(raw.position, threePtRate),
    transitionFreq: estimateTransitionFreq(raw.position, s),
    cutFreq: estimateCutFreq(raw.position),
    offScreenFreq: estimateOffScreenFreq(raw.position, threePtRate),
    handoffFreq: estimateHandoffFreq(raw.position),

    threePointRate: threePtRate,
    midrangeRate,
    rimRate,

    drawFoulRate: s.freeThrowsAttempted / Math.max(1, fga * 2) * 0.5,
    assistRate: s.assists / Math.max(1, raw.minutesPerGame) * 5,
    usageRate: estimateUsageRate(s, raw.minutesPerGame),
    reboundRate: s.rebounds / Math.max(1, raw.minutesPerGame) * 2.5,
  };
}

// Age brackets: [<=22, <=25, <=28, <=32, >32]
// Skills are learnable and decline slowly; physical attributes peak earlier
// and decline faster; athleticism is the most age-sensitive of all.
const SKILL_MULT       = [1.30, 1.15, 1.05, 0.98, 0.92];
const PHYSICAL_MULT    = [1.15, 1.08, 1.02, 0.93, 0.82];
const ATHLETICISM_MULT = [1.10, 1.05, 1.00, 0.90, 0.78];
const DURABILITY_MULT  = [1.05, 1.03, 1.00, 0.97, 0.93];

function ageBracket(age: number): number {
  if (age <= 22) return 0;
  if (age <= 25) return 1;
  if (age <= 28) return 2;
  if (age <= 32) return 3;
  return 4;
}

/**
 * Derive a player's potential (ceiling) ratings from their current ratings and age.
 *
 * Different rating categories age along different curves: learnable skills
 * (shooting, passing, IQ, defensive instincts) keep improving into the late 20s
 * and decline slowly; physical attributes peak in the mid-20s and fall off
 * faster; raw athleticism is the most age-sensitive of all; durability tracks a
 * player's record and barely moves. Applying one uniform multiplier to every
 * rating — the old behavior — wrongly gave a young rim-runner the same
 * athleticism ceiling as his interior-scoring ceiling, and let an aging veteran's
 * athleticism stay as high as his passing.
 *
 * Archetype-specific upside is implicit: a high current rating produces a high
 * ceiling and a low one a low ceiling, so no archetype parameter is needed.
 *
 * `experience` is accepted for forward compatibility but is currently unused.
 */
export function derivePotential(
  currentRatings: PlayerRatings,
  age: number,
  _experience: number,
): PlayerRatings {
  const b = ageBracket(age);
  return {
    outsideShooting:   clampRating(Math.round(currentRatings.outsideShooting   * SKILL_MULT[b])),
    midrangeShooting:  clampRating(Math.round(currentRatings.midrangeShooting  * SKILL_MULT[b])),
    interiorScoring:   clampRating(Math.round(currentRatings.interiorScoring   * SKILL_MULT[b])),
    freeThrowShooting: clampRating(Math.round(currentRatings.freeThrowShooting * SKILL_MULT[b])),
    ballHandling:      clampRating(Math.round(currentRatings.ballHandling      * SKILL_MULT[b])),
    passing:           clampRating(Math.round(currentRatings.passing           * SKILL_MULT[b])),
    offensiveIQ:       clampRating(Math.round(currentRatings.offensiveIQ       * SKILL_MULT[b])),
    perimeterDefense:  clampRating(Math.round(currentRatings.perimeterDefense  * SKILL_MULT[b])),
    interiorDefense:   clampRating(Math.round(currentRatings.interiorDefense   * SKILL_MULT[b])),
    defensiveIQ:       clampRating(Math.round(currentRatings.defensiveIQ       * SKILL_MULT[b])),
    steal:             clampRating(Math.round(currentRatings.steal             * SKILL_MULT[b])),
    block:             clampRating(Math.round(currentRatings.block             * SKILL_MULT[b])),
    strength:          clampRating(Math.round(currentRatings.strength          * PHYSICAL_MULT[b])),
    rebounding:        clampRating(Math.round(currentRatings.rebounding        * PHYSICAL_MULT[b])),
    stamina:           clampRating(Math.round(currentRatings.stamina           * PHYSICAL_MULT[b])),
    athleticism:       clampRating(Math.round(currentRatings.athleticism       * ATHLETICISM_MULT[b])),
    durability:        clampRating(Math.round(currentRatings.durability         * DURABILITY_MULT[b])),
  };
}

// Individual rating derivation functions

function deriveOutsideShooting(s: PerGameStats): number {
  if (s.threePointersAttempted < 0.5) return clampRating(15);
  const pct = s.threePointPct || 0;
  const volume = Math.min(s.threePointersAttempted, 10);
  // Weight: 60% accuracy, 40% volume
  const pctScore = percentileToRating(pct, 0.28, 0.42);
  const volScore = percentileToRating(volume, 1, 8);
  return clampRating(Math.round(pctScore * 0.6 + volScore * 0.4));
}

function deriveMidrangeShooting(s: PerGameStats): number {
  // Estimate from overall FG% minus 3pt and rim contribution
  const fg = s.fieldGoalPct || 0.40;
  return clampRating(percentileToRating(fg, 0.38, 0.55));
}

function deriveInteriorScoring(s: PerGameStats, pos: Position): number {
  const pts = s.points || 0;
  const fga = s.fieldGoalsAttempted || 1;
  const fg = s.fieldGoalPct || 0.40;

  // Bigs get more credit for interior scoring
  const posBonus = pos === 'C' ? 8 : pos === 'PF' ? 4 : pos === 'SF' ? 0 : -3;
  const scoring = percentileToRating(pts, 5, 30) * 0.4 + percentileToRating(fg, 0.40, 0.60) * 0.6;
  return clampRating(Math.round(scoring + posBonus));
}

function deriveFreeThrowShooting(s: PerGameStats): number {
  if (s.freeThrowsAttempted < 0.5) return clampRating(40);
  return clampRating(Math.round((s.freeThrowPct || 0.75) * 80));
}

function deriveBallHandling(s: PerGameStats, pos: Position): number {
  const assists = s.assists || 0;
  const turnovers = s.turnovers || 1;
  const astToRatio = assists / turnovers;

  const posBase: Record<Position, number> = { PG: 55, SG: 45, SF: 35, PF: 25, C: 20 };
  const base = posBase[pos];
  const astMod = (astToRatio - 1.5) * 5;
  return clampRating(Math.round(base + astMod));
}

function derivePassing(s: PerGameStats, pos: Position): number {
  const ast = s.assists || 0;
  const posWeight: Record<Position, number> = { PG: 0, SG: -5, SF: -3, PF: 0, C: 3 };
  const rating = percentileToRating(ast, 1, 10) + posWeight[pos];
  return clampRating(Math.round(rating));
}

function deriveOffensiveIQ(s: PerGameStats): number {
  const fg = s.fieldGoalPct || 0.40;
  const turnovers = s.turnovers || 0;
  const assists = s.assists || 0;

  const efficiency = fg * 40 + (assists - turnovers) * 3;
  return clampRating(Math.round(percentileToRating(efficiency, 10, 35)));
}

function derivePerimeterDefense(s: PerGameStats, pos: Position): number {
  const stl = s.steals || 0;
  const posBase: Record<Position, number> = { PG: 42, SG: 44, SF: 42, PF: 35, C: 28 };
  const stlMod = (stl - 0.8) * 10;
  return clampRating(Math.round(posBase[pos] + stlMod));
}

function deriveInteriorDefense(s: PerGameStats, pos: Position): number {
  const blk = s.blocks || 0;
  const posBase: Record<Position, number> = { PG: 20, SG: 22, SF: 30, PF: 42, C: 52 };
  const blkMod = (blk - 0.5) * 12;
  return clampRating(Math.round(posBase[pos] + blkMod));
}

function deriveDefensiveIQ(s: PerGameStats, pos: Position): number {
  const stl = s.steals || 0;
  const blk = s.blocks || 0;
  const reb = s.defensiveRebounds || 0;

  const composite = stl * 8 + blk * 6 + reb * 2;
  const posBase: Record<Position, number> = { PG: 38, SG: 38, SF: 40, PF: 42, C: 42 };
  return clampRating(Math.round(posBase[pos] + (composite - 15) * 0.8));
}

function deriveSteal(s: PerGameStats): number {
  return clampRating(percentileToRating(s.steals || 0, 0.3, 2.0));
}

function deriveBlock(s: PerGameStats, pos: Position): number {
  const posBonus = pos === 'C' ? 5 : pos === 'PF' ? 2 : 0;
  return clampRating(percentileToRating(s.blocks || 0, 0.1, 2.5) + posBonus);
}

function deriveAthleticism(s: PerGameStats, age: number, pos: Position): number {
  // Base from position + age curve
  const posBase: Record<Position, number> = { PG: 50, SG: 48, SF: 46, PF: 44, C: 38 };
  let rating = posBase[pos];

  // Age curve
  if (age <= 24) rating += 5;
  else if (age <= 28) rating += 2;
  else if (age <= 32) rating -= 3;
  else if (age <= 35) rating -= 8;
  else rating -= 15;

  // Scoring volume suggests athleticism
  rating += Math.min(5, (s.points - 10) * 0.3);

  return clampRating(Math.round(rating));
}

function deriveStrength(pos: Position, age: number): number {
  const posBase: Record<Position, number> = { PG: 30, SG: 35, SF: 42, PF: 52, C: 58 };
  let rating = posBase[pos];
  if (age >= 25 && age <= 32) rating += 3;
  if (age < 22) rating -= 5;
  return clampRating(Math.round(rating));
}

function deriveRebounding(s: PerGameStats, pos: Position): number {
  const reb = s.rebounds || 0;
  const posWeight: Record<Position, number> = { PG: -5, SG: -3, SF: 0, PF: 3, C: 5 };
  return clampRating(Math.round(percentileToRating(reb, 2, 12) + posWeight[pos]));
}

function deriveStamina(mpg: number, gamesPlayed: number): number {
  const mpgRating = percentileToRating(mpg, 15, 36);
  const gpRating = percentileToRating(gamesPlayed, 40, 82) * 0.3;
  return clampRating(Math.round(mpgRating * 0.7 + gpRating));
}

function deriveDurability(gamesPlayed: number): number {
  return clampRating(percentileToRating(gamesPlayed, 30, 82));
}

// Utility functions

function percentileToRating(value: number, low: number, high: number): number {
  const pct = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return 10 + pct * 65; // Maps to 10-75 range
}

function clampRating(value: number): number {
  return Math.max(1, Math.min(80, value));
}

// Tendency estimation helpers

function estimateUsageRate(s: PerGameStats, mpg: number): number {
  if (mpg === 0) return 0.15;
  const fga = s.fieldGoalsAttempted || 0;
  const fta = s.freeThrowsAttempted || 0;
  const tov = s.turnovers || 0;
  return Math.min(0.40, Math.max(0.10, (fga + 0.44 * fta + tov) / (mpg / 5 * 100) * 100 * 0.01));
}

function estimateRimRate(pos: Position, threePtRate: number): number {
  const posBase: Record<Position, number> = { PG: 0.30, SG: 0.28, SF: 0.32, PF: 0.42, C: 0.55 };
  return Math.max(0.15, posBase[pos] - threePtRate * 0.3);
}

function estimateIsoFreq(pos: Position, s: PerGameStats): number {
  if (pos === 'PG' || pos === 'SG') return Math.min(0.20, s.points / 100);
  if (pos === 'SF') return Math.min(0.15, s.points / 120);
  return 0.05;
}

function estimatePnRHandlerFreq(pos: Position, s: PerGameStats): number {
  if (pos === 'PG') return 0.25 + s.assists * 0.02;
  if (pos === 'SG') return 0.12 + s.assists * 0.01;
  return 0.05;
}

function estimatePnRScreenerFreq(pos: Position): number {
  const freq: Record<Position, number> = { PG: 0.02, SG: 0.03, SF: 0.06, PF: 0.15, C: 0.20 };
  return freq[pos];
}

function estimatePostUpFreq(pos: Position, s: PerGameStats): number {
  if (pos === 'C') return 0.15 + (s.points > 15 ? 0.05 : 0);
  if (pos === 'PF') return 0.08;
  return 0.02;
}

function estimateSpotUpFreq(pos: Position, threePtRate: number): number {
  return 0.10 + threePtRate * 0.3;
}

function estimateTransitionFreq(pos: Position, s: PerGameStats): number {
  if (pos === 'PG' || pos === 'SG') return 0.12 + s.steals * 0.02;
  return 0.08;
}

function estimateCutFreq(pos: Position): number {
  const freq: Record<Position, number> = { PG: 0.05, SG: 0.08, SF: 0.12, PF: 0.10, C: 0.08 };
  return freq[pos];
}

function estimateOffScreenFreq(pos: Position, threePtRate: number): number {
  if (pos === 'SG') return 0.10 + threePtRate * 0.1;
  return 0.05 + threePtRate * 0.05;
}

function estimateHandoffFreq(pos: Position): number {
  const freq: Record<Position, number> = { PG: 0.06, SG: 0.08, SF: 0.05, PF: 0.04, C: 0.03 };
  return freq[pos];
}
