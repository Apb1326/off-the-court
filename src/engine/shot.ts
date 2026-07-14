import { Player } from '@/models/player';
import { ShotZone, PlayType } from '@/models/game';
import { SeededRNG } from '@/lib/rng';
import { getEffectiveRating } from './fatigue';
import {
  BASE_FG_PCT_BY_ZONE,
  PLAY_TYPE_EFFICIENCY_MOD,
  SHOOTING_FOUL_RATE_BY_ZONE,
  POINTS_BY_ZONE,
  FT_LEAGUE_AVG_PCT,
  FT_PCT_SLOPE,
  FT_SIM_PCT_MIN,
  FT_SIM_PCT_MAX,
  BLOCK_BASE_RATE,
} from './constants';

export type ContestLevel = 'open' | 'lightly_contested' | 'contested' | 'heavily_contested';

const CONTEST_MODIFIER: Record<ContestLevel, number> = {
  open: 0.06,
  lightly_contested: 0,
  contested: -0.04,
  heavily_contested: -0.10,
};

export function ratingToModifier(rating: number): number {
  // Sigmoid-like curve: rating 40 (avg) -> 0, rating 80 -> +0.10625, rating 1 -> -0.1031.
  // The shooter and defender modifiers compound on every shot, so the per-side
  // swing is kept modest — otherwise an elite-vs-poor mismatch produces shot
  // probabilities far outside what real NBA efficiency gaps support, which in
  // turn inflates blowout margins (calibrated vs real games, ~11 pt avg margin).
  const centered = (rating - 40) / 40; // -1 to +1
  return centered * 0.085 * (1 + 0.25 * Math.abs(centered));
}

function getShooterRating(player: Player, zone: ShotZone): number {
  switch (zone) {
    case 'rim':
      return player.ratings.interiorScoring;
    case 'short_midrange':
    case 'long_midrange':
      return player.ratings.midrangeShooting;
    case 'corner_three':
    case 'above_break_three':
    case 'deep_three':
      return player.ratings.outsideShooting;
  }
}

function getDefenderRating(defender: Player, zone: ShotZone): number {
  switch (zone) {
    case 'rim':
      return defender.ratings.interiorDefense;
    case 'short_midrange':
    case 'long_midrange':
      return defender.ratings.perimeterDefense;
    case 'corner_three':
    case 'above_break_three':
    case 'deep_three':
      return defender.ratings.perimeterDefense;
  }
}

export function determineContestLevel(
  defender: Player,
  defenderFatigue: number,
  rng: SeededRNG,
  pressureBonus: number = 0,
): ContestLevel {
  const defIQ = getEffectiveRating(defender.ratings.defensiveIQ, defenderFatigue);
  const athleticism = getEffectiveRating(defender.ratings.athleticism, defenderFatigue);
  // Team defensive pressure makes contests tougher (or softer) on every shot.
  const contestSkill = (defIQ + athleticism) / 2 + pressureBonus * 100;

  const roll = rng.next() * 100;
  if (contestSkill > 60) {
    if (roll < 10) return 'open';
    if (roll < 30) return 'lightly_contested';
    if (roll < 70) return 'contested';
    return 'heavily_contested';
  } else if (contestSkill > 40) {
    if (roll < 20) return 'open';
    if (roll < 50) return 'lightly_contested';
    if (roll < 80) return 'contested';
    return 'heavily_contested';
  } else {
    if (roll < 30) return 'open';
    if (roll < 60) return 'lightly_contested';
    if (roll < 85) return 'contested';
    return 'heavily_contested';
  }
}

export interface ShotResult {
  made: boolean;
  points: number;
  zone: ShotZone;
  fouled: boolean;
  blocked: boolean;
  contestLevel: ContestLevel;
}

export interface ShotContext {
  /** Team defensive pressure toughening contests (from defensivePressure). */
  pressureBonus?: number;
  /** The shooter is being double-teamed — extra contest, lower make. */
  doubleTeamed?: boolean;
  /** Live momentum swing for the shooting team (small, +/-). */
  momentum?: number;
  /** Multiplier on shooting-foul rate from defensive aggressiveness. */
  foulMult?: number;
  /**
   * Shot-quality bonus from a possession that developed and CASHED an advantage
   * (a kick-out off a double-team, a drive-and-kick off a collapsed defense).
   * Additive to make probability, already capped by the chain. On perimeter
   * shots it is scaled by the finisher's own shooting so an "open" look only
   * helps a shooter who can punish it — an open three for a non-shooter is not a
   * good shot.
   */
  advantageBonus?: number;
  /**
   * Late-shot-clock rush: the shot is forced under the shot-clock pressure
   * threshold (the alternative is a violation), so it is a worse look. Additive,
   * negative.
   */
  rushPenalty?: number;
  /**
   * Effort/coasting game-state response (possession.ts): negative for an
   * offense protecting a big lead, positive for a trailing offense pressing.
   * Additive, bounded by COAST_SHOT_EFFORT_MAX, equal-and-opposite around the
   * lead so it is league-aggregate neutral.
   */
  effortMod?: number;
}

export function resolveShot(
  shooter: Player,
  shooterFatigue: number,
  defender: Player,
  defenderFatigue: number,
  zone: ShotZone,
  playType: PlayType,
  rng: SeededRNG,
  shooterForm: number = 0,
  ctx: ShotContext = {},
): ShotResult {
  const contestLevel = determineContestLevel(defender, defenderFatigue, rng, ctx.pressureBonus ?? 0);

  const basePct = BASE_FG_PCT_BY_ZONE[zone];
  const shooterMod = ratingToModifier(getEffectiveRating(getShooterRating(shooter, zone), shooterFatigue));
  const defenderMod = -ratingToModifier(getEffectiveRating(getDefenderRating(defender, zone), defenderFatigue));
  const fatigueMod = -0.08 * shooterFatigue;
  const playTypeMod = PLAY_TYPE_EFFICIENCY_MOD[playType];
  const contestMod = CONTEST_MODIFIER[contestLevel];
  // Per-game "hot/cold" form: shifts a player's accuracy for the whole game.
  // Threes swing more than twos (streaky shooting), interior is steadiest.
  const formScale = zone === 'rim' ? 0.5 : POINTS_BY_ZONE[zone] === 3 ? 1.3 : 1.0;
  const formMod = shooterForm * formScale;
  // A double-team meaningfully lowers shot quality; momentum nudges it.
  const doubleMod = ctx.doubleTeamed ? -0.08 : 0;
  const momentumMod = (ctx.momentum ?? 0) * formScale;
  // Advantage cashed by ball movement. On a three the "open" value is gated on
  // the finisher's outside shooting (an open look only helps a shooter who can
  // punish it); twos take it closer to full since a collapsed defense yields a
  // genuine layup/short look for anyone.
  const advRaw = ctx.advantageBonus ?? 0;
  const isThree = POINTS_BY_ZONE[zone] === 3;
  const advScale = isThree
    ? 0.35 + 0.65 * (getEffectiveRating(getShooterRating(shooter, zone), shooterFatigue) / 80)
    : 1.0;
  const advantageMod = advRaw * advScale;
  // Forced shot under the shot-clock floor.
  const rushMod = ctx.rushPenalty ?? 0;
  // Effort/coasting game-state response (see ShotContext.effortMod).
  const effortMod = ctx.effortMod ?? 0;

  const finalProbability = Math.max(0.05, Math.min(0.95,
    basePct + shooterMod + defenderMod + fatigueMod + playTypeMod + contestMod +
    formMod + doubleMod + momentumMod + advantageMod + rushMod + effortMod
  ));

  // Block check (before shot)
  const blockRating = getEffectiveRating(defender.ratings.block, defenderFatigue);
  const blockChance = (blockRating / 80) * BLOCK_BASE_RATE * (zone === 'rim' ? 2.0 : zone === 'short_midrange' ? 0.5 : 0.1);
  const blocked = rng.nextBool(blockChance);

  if (blocked) {
    return { made: false, points: 0, zone, fouled: false, blocked: true, contestLevel };
  }

  const made = rng.nextBool(finalProbability);
  const points = made ? POINTS_BY_ZONE[zone] : 0;

  // Shooting foul check
  const baseFoulRate = SHOOTING_FOUL_RATE_BY_ZONE[zone];
  const drawFoulMod = (shooter.tendencies.drawFoulRate - 0.10) * 0.5;
  const foulChance = Math.max(0.01, (baseFoulRate + drawFoulMod) * (ctx.foulMult ?? 1));
  const fouled = rng.nextBool(foulChance);

  return { made, points, zone, fouled, blocked: false, contestLevel };
}

export function resolveFreeThrows(
  shooter: Player,
  shooterFatigue: number,
  attempts: number,
  rng: SeededRNG,
): { made: number; attempted: number } {
  const ftRating = getEffectiveRating(shooter.ratings.freeThrowShooting, shooterFatigue);
  const ftPct = Math.max(FT_SIM_PCT_MIN, Math.min(
    FT_SIM_PCT_MAX,
    FT_LEAGUE_AVG_PCT + ((ftRating - 40) / 40) * FT_PCT_SLOPE,
  ));

  let made = 0;
  for (let i = 0; i < attempts; i++) {
    if (rng.nextBool(ftPct)) made++;
  }
  return { made, attempted: attempts };
}
