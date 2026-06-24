import { PlayerRatings } from '@/models/player';
import { SeededRNG } from '@/lib/rng';

export function getScoutedRatings(
  actualPotential: PlayerRatings,
  scoutingAccuracy: number,
  rng: SeededRNG,
): PlayerRatings {
  const scouted: PlayerRatings = { ...actualPotential };

  const noiseScale = (1 - scoutingAccuracy) * 15;

  for (const key of Object.keys(scouted) as (keyof PlayerRatings)[]) {
    const noise = rng.nextGaussian(0, noiseScale);
    scouted[key] = Math.max(1, Math.min(80, Math.round(scouted[key] + noise)));
  }

  return scouted;
}

export function improveScoutingAccuracy(
  current: number,
  minutesPlayed: number,
): number {
  // Playing a player naturally scouts them
  // ~2000 minutes in a season -> ~0.7 accuracy from play alone
  const playImprovement = Math.min(0.7, minutesPlayed / 2000 * 0.7);
  return Math.min(1.0, Math.max(current, playImprovement));
}
