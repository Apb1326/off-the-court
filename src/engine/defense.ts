import { Player } from '@/models/player';
import { DefensiveSystem } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import { getEffectiveRating } from './fatigue';

/**
 * Team-level defensive behavior: rim protection that deters drives, scheme/
 * intensity that trade contests and steals against foul risk, and star
 * double-teams that sacrifice help to slow a primary scorer.
 */

/**
 * Rim deterrence (0 = none, ~1 = elite) from the lineup's best interior
 * defender. Strong rim protection pushes the offense away from the basket and
 * toward jumpers, the way a Gobert or Wembanyama does.
 */
export function rimProtection(defenders: Player[], fatigue: Map<string, number>): number {
  let best = 0;
  for (const d of defenders) {
    const f = fatigue.get(d.id) ?? 0;
    const anchor = (getEffectiveRating(d.ratings.interiorDefense, f) * 0.6 +
      getEffectiveRating(d.ratings.block, f) * 0.4);
    best = Math.max(best, anchor);
  }
  // Only genuinely elite rim protection meaningfully deters drives — an average
  // center barely moves shot selection. Map ~58 -> 0, 80 -> ~0.5.
  return Math.max(0, Math.min(0.6, (best - 58) / 44));
}

/**
 * How aggressively the defense plays, derived from scheme + intensity. Higher
 * pressure forces more turnovers and contests harder, but fouls more and gives
 * up the occasional blow-by.
 */
export interface DefensivePressure {
  contestBonus: number;   // added toughness to shot contests (-/+)
  stealMult: number;      // multiplier on steal/turnover generation
  foulMult: number;       // multiplier on shooting-foul rate
}

export function defensivePressure(system: DefensiveSystem): DefensivePressure {
  const intensity = system.intensity; // 0-1, ~0.5 average
  const centered = intensity - 0.5;

  // Switch-all and zones trade rim/foul exposure differently.
  const schemeSteal =
    system.scheme === 'switch_all' ? 0.95 :
    system.scheme === 'zone_23' || system.scheme === 'zone_32' ? 1.1 : 1.0;
  const schemeFoul = system.scheme === 'switch_all' ? 0.9 : 1.0;

  return {
    contestBonus: centered * 0.06,
    stealMult: (1 + centered * 0.5) * schemeSteal,
    foulMult: (1 + centered * 0.4) * schemeFoul,
  };
}

/**
 * Decide whether to send a second defender at the ball. Triggered when the
 * primary option is an elite scorer and the defense plays help-aggressive.
 * A double-team lowers the star's shot quality and raises his turnover risk,
 * but leaves a teammate open (handled by the caller via a higher assist rate).
 */
export function shouldDoubleTeam(
  primary: Player,
  system: DefensiveSystem,
  rng: SeededRNG,
): boolean {
  const scoring = Math.max(
    primary.ratings.interiorScoring,
    primary.ratings.midrangeShooting,
    primary.ratings.outsideShooting,
  );
  if (scoring < system.doubleTeamThreshold) return false;
  // Aggression + how far above threshold drive the chance.
  const over = (scoring - system.doubleTeamThreshold) / 20;
  const chance = Math.min(0.6, system.helpDefenseAggression * (0.3 + over));
  return rng.nextBool(chance);
}
