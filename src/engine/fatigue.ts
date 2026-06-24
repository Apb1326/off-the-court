import { Player } from '@/models/player';
import {
  BASE_FATIGUE_PER_POSSESSION,
  BENCH_RECOVERY_PER_MINUTE,
  FATIGUE_PERFORMANCE_PENALTY,
} from './constants';

export function accumulateFatigue(
  currentFatigue: number,
  player: Player,
): number {
  const delta = BASE_FATIGUE_PER_POSSESSION / (player.ratings.stamina / 40);
  return Math.min(1, currentFatigue + delta);
}

export function recoverFatigue(
  currentFatigue: number,
  benchMinutes: number,
): number {
  const recovery = benchMinutes * BENCH_RECOVERY_PER_MINUTE;
  return Math.max(0, currentFatigue - recovery);
}

export function fatigueMultiplier(fatigue: number): number {
  return 1.0 - fatigue * FATIGUE_PERFORMANCE_PENALTY;
}

export function getEffectiveRating(
  baseRating: number,
  fatigue: number,
): number {
  return Math.round(baseRating * fatigueMultiplier(fatigue));
}
