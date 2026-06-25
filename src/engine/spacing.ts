import { Player } from '@/models/player';
import {
  SPACING_THREAT_FLOOR,
  SPACING_MOVEMENT_WEIGHT,
  SPACING_BASELINE_OFFBALL_FOUR,
  SPACING_SPREAD,
  SPACING_CLAMP,
  VERSATILITY_W_FLOOR,
  VERSATILITY_W_DEFIQ,
  VERSATILITY_W_ATH_SPREAD,
  VERSATILITY_W_SIZE_SPREAD,
  VERSATILITY_W_RIM,
  VERSATILITY_BASELINE,
  VERSATILITY_SPREAD,
  VERSATILITY_CLAMP,
} from './constants';

/**
 * Lineup spacing.
 *
 * A possession's offensive output should not be the bare sum of five individual
 * ratings — who you put AROUND the finisher matters. This module distills the
 * four OFF-BALL players (everyone except the player finishing the action) into a
 * single CENTERED spacing value that the offensive hooks consume.
 *
 * The value is centered on a league-average off-ball-four group, so an
 * average-spacing lineup nets ~zero. It is pure arithmetic over the players in
 * the order given — no RNG, no Math.random — so it is fully deterministic.
 *
 * Gravity comes primarily from outside shooting WEIGHTED BY three-point
 * tendency (the PRODUCT, not the sum: a player who can shoot but never does
 * provides little gravity, and a high-volume non-shooter provides none). A
 * small, CONDITIONAL movement term is added on top: off-ball IQ × cut tendency,
 * but only honored once a player carries enough scoring threat that his man must
 * stay attached. Below that threat floor a cutter is a free help defender — a
 * spacing NEGATIVE — so the movement term is signed, not unconditionally
 * positive.
 */

/** Per-player off-ball gravity contribution (raw, uncentered). */
function playerGravity(p: Player): number {
  const outNorm = p.ratings.outsideShooting / 80;
  // Shooting gravity: product of ability and willingness. Both must be present.
  const shootGravity = outNorm * p.tendencies.threePointRate;

  // Scoring threat the defender must respect (mirrors the double-team read in
  // defense.ts: the best of the three scoring ratings).
  const threat =
    Math.max(p.ratings.interiorScoring, p.ratings.midrangeShooting, p.ratings.outsideShooting) / 80;

  // Off-ball movement, gated on threat. (threat - floor) is signed: an honored
  // mover (high threat) adds spacing; a non-threat cutter whose man can sag off
  // subtracts it. Kept small so an approximation here can't dominate.
  const moveRaw = (p.ratings.offensiveIQ / 80) * p.tendencies.cutFreq;
  const moveContribution = SPACING_MOVEMENT_WEIGHT * moveRaw * (threat - SPACING_THREAT_FLOOR);

  return shootGravity + moveContribution;
}

/**
 * Mean off-ball gravity over the supplied players, UNCENTERED. Used both by the
 * live engine and by scripts/calibrate-spacing.ts to derive the baseline. The
 * caller must pass the off-ball four (lineup minus the finisher); iteration
 * follows the array order, which the caller keeps deterministic.
 */
export function rawOffBallGravity(offBall: Player[]): number {
  if (offBall.length === 0) return SPACING_BASELINE_OFFBALL_FOUR; // degenerate → neutral
  let sum = 0;
  for (const p of offBall) sum += playerGravity(p);
  return sum / offBall.length;
}

/**
 * Spacing for a possession, expressed RELATIVE to a league-average off-ball
 * four and normalized to an approximately unit-variance z-score: 0 = average,
 * positive = better-spaced than league average, negative = worse. Clamped.
 */
export function computeSpacing(offBall: Player[]): number {
  const raw = rawOffBallGravity(offBall);
  const z = (raw - SPACING_BASELINE_OFFBALL_FOUR) / SPACING_SPREAD;
  return Math.max(-SPACING_CLAMP, Math.min(SPACING_CLAMP, z));
}

// --- Defensive versatility (weak-link switchability) ---------------------

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
}

/**
 * Raw (uncentered) defensive versatility for a 5-man defensive lineup. Driven by
 * the WEAK LINK — the minimum perimeter defender, the man mismatch-hunting
 * attacks — plus a LOW-SPREAD-in-mobility/size bonus (everyone can credibly
 * switch). Defensive IQ is a minor positive; rim protection is a minor term that
 * must not dominate (immobile rim protectors are the opposite of switchable).
 * Pure arithmetic over the players given; no RNG.
 */
export function rawVersatility(defenders: Player[]): number {
  if (defenders.length === 0) return VERSATILITY_BASELINE;
  const perim = defenders.map((d) => d.ratings.perimeterDefense);
  const floorPerim = Math.min(...perim) / 80; // weak link — the hunted defender
  const defIQ = mean(defenders.map((d) => d.ratings.defensiveIQ)) / 80;
  const athSpread = stdev(defenders.map((d) => d.ratings.athleticism)) / 80;
  const sizeSpread = stdev(defenders.map((d) => d.height)) / 8; // ~inches → comparable scale
  const rimMean = mean(defenders.map((d) => d.ratings.interiorDefense)) / 80;

  return (
    VERSATILITY_W_FLOOR * floorPerim +
    VERSATILITY_W_DEFIQ * defIQ -
    VERSATILITY_W_ATH_SPREAD * athSpread -
    VERSATILITY_W_SIZE_SPREAD * sizeSpread +
    VERSATILITY_W_RIM * rimMean
  );
}

/**
 * Defensive versatility as a centered, normalized z-score: 0 = league-average
 * switchability, positive = a genuinely switch-everything (high-floor, low-
 * spread) defense, negative = a hunt-me lineup (a sieve, or all immobile bigs).
 */
export function computeVersatility(defenders: Player[]): number {
  const raw = rawVersatility(defenders);
  const z = (raw - VERSATILITY_BASELINE) / VERSATILITY_SPREAD;
  return Math.max(-VERSATILITY_CLAMP, Math.min(VERSATILITY_CLAMP, z));
}
