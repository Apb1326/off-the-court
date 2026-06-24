import { Player } from '@/models/player';
import { ShotZone, PlayType } from '@/models/game';
import { SeededRNG } from '@/lib/rng';
import { getEffectiveRating } from './fatigue';
import {
  BASE_FG_PCT_BY_ZONE,
  PLAY_TYPE_EFFICIENCY_MOD,
  SHOOTING_FOUL_RATE_BY_ZONE,
  POINTS_BY_ZONE,
} from './constants';

export type ContestLevel = 'open' | 'lightly_contested' | 'contested' | 'heavily_contested';

const CONTEST_MODIFIER: Record<ContestLevel, number> = {
  open: 0.06,
  lightly_contested: 0,
  contested: -0.04,
  heavily_contested: -0.10,
};

function ratingToModifier(rating: number): number {
  // Sigmoid-like curve: rating 40 (avg) -> 0, rating 80 -> +0.12, rating 1 -> -0.15
  const centered = (rating - 40) / 40; // -1 to +1
  return centered * 0.12 * (1 + 0.25 * Math.abs(centered));
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
): ContestLevel {
  const defIQ = getEffectiveRating(defender.ratings.defensiveIQ, defenderFatigue);
  const athleticism = getEffectiveRating(defender.ratings.athleticism, defenderFatigue);
  const contestSkill = (defIQ + athleticism) / 2;

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

export function resolveShot(
  shooter: Player,
  shooterFatigue: number,
  defender: Player,
  defenderFatigue: number,
  zone: ShotZone,
  playType: PlayType,
  rng: SeededRNG,
  shooterForm: number = 0,
): ShotResult {
  const contestLevel = determineContestLevel(defender, defenderFatigue, rng);

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

  const finalProbability = Math.max(0.05, Math.min(0.95,
    basePct + shooterMod + defenderMod + fatigueMod + playTypeMod + contestMod + formMod
  ));

  // Block check (before shot)
  const blockRating = getEffectiveRating(defender.ratings.block, defenderFatigue);
  const blockChance = (blockRating / 80) * 0.06 * (zone === 'rim' ? 2.0 : zone === 'short_midrange' ? 0.5 : 0.1);
  const blocked = rng.nextBool(blockChance);

  if (blocked) {
    return { made: false, points: 0, zone, fouled: false, blocked: true, contestLevel };
  }

  const made = rng.nextBool(finalProbability);
  const points = made ? POINTS_BY_ZONE[zone] : 0;

  // Shooting foul check
  const baseFoulRate = SHOOTING_FOUL_RATE_BY_ZONE[zone];
  const drawFoulMod = (shooter.tendencies.drawFoulRate - 0.10) * 0.5;
  const foulChance = Math.max(0.01, baseFoulRate + drawFoulMod);
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
  const ftPct = 0.50 + (ftRating / 80) * 0.40; // 50% to 90% range

  let made = 0;
  for (let i = 0; i < attempts; i++) {
    if (rng.nextBool(ftPct)) made++;
  }
  return { made, attempted: attempts };
}
