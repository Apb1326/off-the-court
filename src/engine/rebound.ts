import { Player } from '@/models/player';
import { SeededRNG } from '@/lib/rng';
import { getEffectiveRating } from './fatigue';
import { BASE_OFFENSIVE_REBOUND_RATE, TEAM_REBOUND_RATE } from './constants';

export interface ReboundResult {
  rebounder: Player | null; // null = uncredited team rebound
  type: 'offensive' | 'defensive';
}

export function resolveRebound(
  offensivePlayers: Player[],
  defensivePlayers: Player[],
  offensiveFatigue: Map<string, number>,
  defensiveFatigue: Map<string, number>,
  rng: SeededRNG,
): ReboundResult {
  const offRebStrength = calculateTeamReboundStrength(offensivePlayers, offensiveFatigue);
  const defRebStrength = calculateTeamReboundStrength(defensivePlayers, defensiveFatigue);

  const offRebRate = BASE_OFFENSIVE_REBOUND_RATE * (offRebStrength / defRebStrength);
  const clampedRate = Math.max(0.15, Math.min(0.40, offRebRate));

  const isOffensiveRebound = rng.nextBool(clampedRate);
  const type = isOffensiveRebound ? 'offensive' : 'defensive';

  // A fraction of boards are uncredited team rebounds (ball out of bounds): the
  // possession still resolves by type, but no player is awarded the rebound.
  if (rng.nextBool(TEAM_REBOUND_RATE)) {
    return { rebounder: null, type };
  }

  const pool = isOffensiveRebound ? offensivePlayers : defensivePlayers;
  const fatigue = isOffensiveRebound ? offensiveFatigue : defensiveFatigue;
  return { rebounder: selectRebounder(pool, fatigue, rng), type };
}

function calculateTeamReboundStrength(
  players: Player[],
  fatigue: Map<string, number>,
): number {
  return players.reduce((sum, p) => {
    const f = fatigue.get(p.id) ?? 0;
    const reb = getEffectiveRating(p.ratings.rebounding, f);
    const ath = getEffectiveRating(p.ratings.athleticism, f);
    const str = getEffectiveRating(p.ratings.strength, f);
    const posMultiplier = positionReboundMultiplier(p.position);
    return sum + ((reb * 2 + ath + str) / 4) * posMultiplier;
  }, 0);
}

function positionReboundMultiplier(position: string): number {
  switch (position) {
    case 'C': return 1.6;
    case 'PF': return 1.3;
    case 'SF': return 1.0;
    case 'SG': return 0.7;
    case 'PG': return 0.5;
    default: return 1.0;
  }
}

function selectRebounder(
  players: Player[],
  fatigue: Map<string, number>,
  rng: SeededRNG,
): Player {
  const weights = players.map((p) => {
    const f = fatigue.get(p.id) ?? 0;
    const reb = getEffectiveRating(p.ratings.rebounding, f);
    const ath = getEffectiveRating(p.ratings.athleticism, f);
    const posMultiplier = positionReboundMultiplier(p.position);
    return Math.max(1, ((reb * 2 + ath) / 3) * posMultiplier);
  });

  return rng.weightedChoice(players, weights);
}
