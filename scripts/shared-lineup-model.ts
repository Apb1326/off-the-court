import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { PlayType } from '../src/models/game';
import { explainPlayTypeSelection, getTransitionOpportunityChance, primaryPlayerWeight } from '../src/engine/play-types';
import { TRANSITION_ELIGIBLE_RATE } from '../src/engine/constants';

/** Neutral situation: no clutch, trailing, or late-clock selector modifier. */
export const NEUTRAL_SITUATION = { scoreDiff: 0, gameClock: 720, quarter: 2 };

/** Production half-court mix plus unconditional transition share. */
export function productionPlayTypeMix(five: Player[], team: Team): { playType: PlayType; share: number }[] {
  const halfCourt = explainPlayTypeSelection(five, team.offensiveSystem, NEUTRAL_SITUATION);
  const halfCourtTotal = halfCourt.reduce((sum, row) => sum + row.finalWeight, 0);
  const transitionShare = Math.min(1, getTransitionOpportunityChance(five)) * TRANSITION_ELIGIBLE_RATE;
  return [
    ...halfCourt.map((row) => ({ playType: row.playType, share: (1 - transitionShare) * (row.finalWeight / halfCourtTotal) })),
    { playType: 'transition' as PlayType, share: transitionShare },
  ];
}

/** Finisher share over the production play-type mix and primary-player weights. */
export function productionFinisherShare(
  finisher: Player,
  five: Player[],
  mix: { playType: PlayType; share: number }[],
): number {
  return mix.reduce((sum, { playType, share }) => {
    const total = five.reduce((lineupSum, player) => lineupSum + primaryPlayerWeight(player, playType), 0);
    return sum + share * (primaryPlayerWeight(finisher, playType) / total);
  }, 0);
}
