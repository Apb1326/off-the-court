import { Player, Position } from '@/models/player';
import { PlayType, ShotZone } from '@/models/game';
import { OffensiveSystem } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import { PLAY_TYPE_SHOT_ZONES } from './constants';

const POSITION_PLAY_WEIGHTS: Record<Position, Partial<Record<PlayType, number>>> = {
  PG: { isolation: 1.2, pick_and_roll: 1.5, spot_up: 0.8, transition: 1.3, off_screen: 0.6, handoff: 1.0 },
  SG: { isolation: 1.0, pick_and_roll: 0.8, spot_up: 1.3, transition: 1.1, off_screen: 1.4, handoff: 0.9 },
  SF: { isolation: 1.1, pick_and_roll: 0.7, spot_up: 1.2, transition: 1.0, cut: 1.2, post_up: 0.7 },
  PF: { post_up: 1.2, pick_and_roll: 1.0, spot_up: 1.0, cut: 1.3, putback: 1.5 },
  C: { post_up: 1.5, pick_and_roll: 1.2, cut: 1.0, putback: 2.0, spot_up: 0.5 },
};

interface GameSituation {
  scoreDiff: number; // positive = offense winning
  gameClock: number;
  quarter: number;
}

export function selectPlayType(
  ballHandler: Player,
  system: OffensiveSystem,
  situation: GameSituation,
  isTransitionOpportunity: boolean,
  rng: SeededRNG,
): PlayType {
  if (isTransitionOpportunity) {
    return 'transition';
  }

  const playTypes: PlayType[] = [
    'isolation', 'pick_and_roll', 'post_up', 'spot_up',
    'cut', 'off_screen', 'handoff',
  ];

  const weights = playTypes.map((pt) => {
    let w = 1.0;

    // Team system influence (40%)
    switch (pt) {
      case 'isolation': w *= 0.6 + system.isolationEmphasis * 0.8; break;
      case 'pick_and_roll': w *= 0.8 + system.screeningEmphasis * 0.6; break;
      case 'post_up': w *= 0.4 + system.postPlayEmphasis * 1.0; break;
      case 'spot_up': w *= 0.8 + system.threePointEmphasis * 0.6; break;
      case 'cut': w *= 0.6 + system.screeningEmphasis * 0.4; break;
      case 'off_screen': w *= 0.5 + system.threePointEmphasis * 0.5; break;
      case 'handoff': w *= 0.5 + system.screeningEmphasis * 0.3; break;
    }

    // Player tendency influence (40%)
    const tendency = getPlayerTendencyForPlay(ballHandler, pt);
    w *= 0.5 + tendency * 2.0;

    // Position fit
    const posWeight = POSITION_PLAY_WEIGHTS[ballHandler.position]?.[pt] ?? 0.8;
    w *= posWeight;

    // Game situation (20%)
    if (situation.quarter >= 4 && Math.abs(situation.scoreDiff) <= 5 && situation.gameClock < 120) {
      // Clutch: more iso for best player
      if (pt === 'isolation') w *= 1.5;
      if (pt === 'pick_and_roll') w *= 1.2;
    }
    if (situation.scoreDiff < -15) {
      // Down big: more three-point plays
      if (pt === 'spot_up' || pt === 'off_screen') w *= 1.4;
    }

    return Math.max(0.01, w);
  });

  return rng.weightedChoice(playTypes, weights);
}

function getPlayerTendencyForPlay(player: Player, playType: PlayType): number {
  switch (playType) {
    case 'isolation': return player.tendencies.isolationFreq;
    case 'pick_and_roll': return player.tendencies.pickAndRollBallHandlerFreq;
    case 'post_up': return player.tendencies.postUpFreq;
    case 'spot_up': return player.tendencies.spotUpFreq;
    case 'transition': return player.tendencies.transitionFreq;
    case 'cut': return player.tendencies.cutFreq;
    case 'off_screen': return player.tendencies.offScreenFreq;
    case 'handoff': return player.tendencies.handoffFreq;
    case 'putback': return 0.05;
  }
}

export function selectShotZone(
  shooter: Player,
  playType: PlayType,
  rng: SeededRNG,
): ShotZone {
  const zoneOptions = PLAY_TYPE_SHOT_ZONES[playType];
  const zones = zoneOptions.map((z) => z.zone);
  const outside = shooter.ratings.outsideShooting / 80;
  const weights = zoneOptions.map((z) => {
    let w = z.weight;
    // Modify based on player shot tendencies and ability. A poor outside shooter
    // both wants to and should rarely launch threes.
    if (z.zone === 'corner_three' || z.zone === 'above_break_three' || z.zone === 'deep_three') {
      w *= (0.3 + shooter.tendencies.threePointRate * 2.0) * (0.25 + outside * 1.5);
    } else if (z.zone === 'short_midrange' || z.zone === 'long_midrange') {
      w *= 0.5 + shooter.tendencies.midrangeRate * 2.0;
    } else if (z.zone === 'rim') {
      w *= 0.5 + shooter.tendencies.rimRate * 2.0;
    }
    return Math.max(0.01, w);
  });

  return rng.weightedChoice(zones, weights);
}

export function selectPrimaryPlayer(
  onCourt: Player[],
  playType: PlayType,
  rng: SeededRNG,
): Player {
  const weights = onCourt.map((p) => {
    // Compress usage range: sqrt flattens the curve so stars don't dominate
    let w = Math.sqrt(p.tendencies.usageRate) * 50;
    const posWeight = POSITION_PLAY_WEIGHTS[p.position]?.[playType] ?? 0.8;
    w *= posWeight;
    // Skill fit: the player finishing a play should be suited to it. This keeps
    // shooters taking spot-up/off-screen threes and bigs taking post-ups,
    // instead of a center launching catch-and-shoot threes.
    w *= playTypeSkillFit(p, playType);
    return Math.max(1, w);
  });

  return rng.weightedChoice(onCourt, weights);
}

// Multiplier on a player's likelihood of finishing a given play type, based on
// whether their skills match the shots that play tends to produce.
function playTypeSkillFit(p: Player, playType: PlayType): number {
  const outside = p.ratings.outsideShooting / 80;
  const interior = p.ratings.interiorScoring / 80;
  const handle = p.ratings.ballHandling / 80;
  switch (playType) {
    case 'spot_up':
    case 'off_screen':
    case 'handoff':
      return 0.3 + outside * 1.7; // perimeter shooters
    case 'post_up':
      return 0.3 + interior * 1.5; // back-to-the-basket scorers
    case 'putback':
    case 'cut':
      return 0.5 + interior * 1.2; // finishers near the rim
    case 'isolation':
      return 0.5 + handle * 1.0; // shot creators
    case 'pick_and_roll':
      return 0.6 + handle * 0.8;
    default:
      return 1.0;
  }
}

export function selectDefender(
  defensivePlayers: Player[],
  shooter: Player,
  rng: SeededRNG,
): Player {
  // Match by position primarily
  const positionalMatch = defensivePlayers.find(
    (d) => d.position === shooter.position || d.secondaryPosition === shooter.position
  );
  if (positionalMatch && rng.nextBool(0.7)) {
    return positionalMatch;
  }
  // Otherwise weighted by defensive rating
  const weights = defensivePlayers.map((d) => {
    const defRating = (d.ratings.perimeterDefense + d.ratings.interiorDefense) / 2;
    return Math.max(1, defRating);
  });
  return rng.weightedChoice(defensivePlayers, weights);
}

export function checkTransitionOpportunity(
  offensivePlayers: Player[],
  previousPossessionWasTurnover: boolean,
  previousPossessionWasLongRebound: boolean,
  rng: SeededRNG,
): boolean {
  if (!previousPossessionWasTurnover && !previousPossessionWasLongRebound) {
    return false;
  }
  const avgAthleticism = offensivePlayers.reduce((sum, p) => sum + p.ratings.athleticism, 0) / offensivePlayers.length;
  const transitionChance = 0.15 + (avgAthleticism / 80) * 0.25;
  return rng.nextBool(transitionChance);
}
