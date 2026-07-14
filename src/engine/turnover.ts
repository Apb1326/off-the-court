import { Player } from '@/models/player';
import { PlayType, TurnoverType } from '@/models/game';
import { SeededRNG } from '@/lib/rng';
import { getEffectiveRating } from './fatigue';
import { PLAY_TYPE_TURNOVER_RATE, TURNOVER_STEAL_BASE, TURNOVER_STEAL_RATING_COEF, TURNOVER_STEAL_CAP } from './constants';

export interface TurnoverResult {
  occurred: boolean;
  type?: TurnoverType;
  stealBy?: Player;
}

export function checkTurnover(
  ballHandler: Player,
  ballHandlerFatigue: number,
  defenders: Player[],
  defenderFatigue: Map<string, number>,
  playType: PlayType,
  rng: SeededRNG,
  stealMult: number = 1,
): TurnoverResult {
  const baseTORate = PLAY_TYPE_TURNOVER_RATE[playType];

  const handling = getEffectiveRating(ballHandler.ratings.ballHandling, ballHandlerFatigue);
  const offIQ = getEffectiveRating(ballHandler.ratings.offensiveIQ, ballHandlerFatigue);
  const handlerMod = -((handling + offIQ) / 2 - 40) / 40 * 0.06;

  const bestDefender = defenders.reduce((best, d) => {
    const f = defenderFatigue.get(d.id) ?? 0;
    const rating = getEffectiveRating(d.ratings.steal, f) + getEffectiveRating(d.ratings.defensiveIQ, f);
    const bestRating = getEffectiveRating(best.ratings.steal, defenderFatigue.get(best.id) ?? 0) +
      getEffectiveRating(best.ratings.defensiveIQ, defenderFatigue.get(best.id) ?? 0);
    return rating > bestRating ? d : best;
  });

  const defF = defenderFatigue.get(bestDefender.id) ?? 0;
  const defSteal = getEffectiveRating(bestDefender.ratings.steal, defF);
  const defMod = (defSteal - 40) / 40 * 0.04;

  // Defensive pressure (scheme + intensity) scales the steal-driven portion.
  const pressuredDefMod = defMod * stealMult;
  const turnoverChance = Math.max(0.03, Math.min(0.25, baseTORate + handlerMod + pressuredDefMod));

  if (!rng.nextBool(turnoverChance)) {
    return { occurred: false };
  }

  // Determine turnover type. Well over half of real turnovers are steals
  // (~8.0 STL vs ~14.1 TOV per team-game), scaled by the best on-ball
  // defender's hands. Shared constants with the chain bad-pass split.
  const stealChance = Math.min(TURNOVER_STEAL_CAP, TURNOVER_STEAL_BASE + defSteal / 80 * TURNOVER_STEAL_RATING_COEF);
  if (rng.nextBool(stealChance)) {
    return { occurred: true, type: 'steal', stealBy: bestDefender };
  }

  const types: TurnoverType[] = ['bad_pass', 'travel', 'offensive_foul', 'out_of_bounds'];
  const weights = [0.40, 0.15, 0.15, 0.30];
  const type = rng.weightedChoice(types, weights);

  return { occurred: true, type };
}
