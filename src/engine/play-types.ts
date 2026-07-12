import { Player, Position } from '@/models/player';
import { PlayType, ShotZone } from '@/models/game';
import { OffensiveSystem } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import {
  PLAY_TYPE_SHOT_ZONES,
  PLAY_TYPE_SHOT_ZONES_REAL,
  SPACING_RIM_FREQ_COEF,
  SPACING_MID_FREQ_COEF,
  SPACING_THREE_FREQ_COEF,
  SPACING_RIM_DETER_RELIEF_COEF,
  VERSATILITY_HUNT_COEF,
  PRIMARY_PLAYER_MIN_WEIGHT,
  CANDIDATE_TRANSITION_ELIGIBLE_RATE,
  CANDIDATE_SELECTOR_MIN_WEIGHT,
  CANDIDATE_SYSTEM_MODIFIER_STRENGTH,
  CANDIDATE_POSITION_MODIFIER_STRENGTH,
  CANDIDATE_SITUATION_MODIFIER_STRENGTH,
} from './constants';
import { computeVersatility } from './spacing';

const POSITION_PLAY_WEIGHTS: Record<Position, Partial<Record<PlayType, number>>> = {
  PG: { isolation: 1.2, pick_and_roll: 1.5, spot_up: 0.8, transition: 1.3, off_screen: 0.6, handoff: 1.0 },
  SG: { isolation: 1.0, pick_and_roll: 0.8, spot_up: 1.3, transition: 1.1, off_screen: 1.4, handoff: 0.9 },
  SF: { isolation: 1.1, pick_and_roll: 0.7, spot_up: 1.2, transition: 1.0, cut: 1.2, post_up: 0.7 },
  PF: { post_up: 1.2, pick_and_roll: 1.0, spot_up: 1.0, cut: 1.3, putback: 1.5 },
  C: { post_up: 1.5, pick_and_roll: 1.2, cut: 1.0, putback: 2.0, spot_up: 0.5 },
};

export interface LegacyPlayTypeSelectionFactor {
  playType: PlayType;
  systemFactor: number;
  tendency: number;
  tendencyFactor: number;
  positionFactor: number;
  situationFactor: number;
  finalWeight: number;
}

/** Read-only decomposition of the legacy selector, used by S2c1 diagnostics. */
export function explainLegacyPlayTypeSelection(
  ballHandler: Player,
  system: OffensiveSystem,
  situation: GameSituation,
): LegacyPlayTypeSelectionFactor[] {
  const playTypes: PlayType[] = [
    'isolation', 'pick_and_roll', 'post_up', 'spot_up',
    'cut', 'off_screen', 'handoff',
  ];

  return playTypes.map((pt) => {
    let systemFactor = 1.0;
    switch (pt) {
      case 'isolation': systemFactor = 0.6 + system.isolationEmphasis * 0.8; break;
      case 'pick_and_roll': systemFactor = 0.8 + system.screeningEmphasis * 0.6; break;
      case 'post_up': systemFactor = 0.4 + system.postPlayEmphasis * 1.0; break;
      case 'spot_up': systemFactor = 0.8 + system.threePointEmphasis * 0.6; break;
      case 'cut': systemFactor = 0.6 + system.screeningEmphasis * 0.4; break;
      case 'off_screen': systemFactor = 0.5 + system.threePointEmphasis * 0.5; break;
      case 'handoff': systemFactor = 0.5 + system.screeningEmphasis * 0.3; break;
    }
    const tendency = getPlayerTendencyForPlay(ballHandler, pt);
    const tendencyFactor = 0.5 + tendency * 2.0;
    const positionFactor = POSITION_PLAY_WEIGHTS[ballHandler.position]?.[pt] ?? 0.8;
    let situationFactor = 1.0;
    if (situation.quarter >= 4 && Math.abs(situation.scoreDiff) <= 5 && situation.gameClock < 120) {
      if (pt === 'isolation') situationFactor *= 1.5;
      if (pt === 'pick_and_roll') situationFactor *= 1.2;
    }
    if (situation.scoreDiff < -15 && (pt === 'spot_up' || pt === 'off_screen')) {
      situationFactor *= 1.4;
    }
    return {
      playType: pt,
      systemFactor,
      tendency,
      tendencyFactor,
      positionFactor,
      situationFactor,
      finalWeight: Math.max(0.01, systemFactor * tendencyFactor * positionFactor * situationFactor),
    };
  });
}

export interface GameSituation {
  scoreDiff: number; // positive = offense winning
  gameClock: number;
  quarter: number;
}

export type PlayTypeSelectionMode = 'legacy' | 'candidate';
export type ShotZoneTableSelection = 'shaded' | 'real';
export interface PlayTypeSelectionConfig {
  readonly mode: PlayTypeSelectionMode;
  /** Explicit evaluation input; never inferred from a pool path or environment. */
  readonly shotZones: ShotZoneTableSelection;
}

export const LEGACY_PLAY_TYPE_SELECTION: PlayTypeSelectionConfig = Object.freeze({ mode: 'legacy', shotZones: 'shaded' });
export const CANDIDATE_PLAY_TYPE_SELECTION: PlayTypeSelectionConfig = Object.freeze({ mode: 'candidate', shotZones: 'shaded' });

/** Candidate-only decomposition: derived tendency is the base share, with
 * bounded system, position, and situation modifiers around it. */
export function explainCandidatePlayTypeSelection(
  onCourtPlayers: Player[],
  system: OffensiveSystem,
  situation: GameSituation,
): LegacyPlayTypeSelectionFactor[] {
  const legacyFactors = explainLegacyPlayTypeSelection(onCourtPlayers[0], system, situation);
  return legacyFactors.map((legacy) => {
    const tendency = weightedCandidateTendency(onCourtPlayers, legacy.playType);
    const positionFactor = weightedPositionFactor(onCourtPlayers, legacy.playType);
    const systemModifier = 1 + CANDIDATE_SYSTEM_MODIFIER_STRENGTH * (legacy.systemFactor - 1);
    const positionModifier = 1 + CANDIDATE_POSITION_MODIFIER_STRENGTH * (positionFactor - 1);
    const situationModifier = 1 + CANDIDATE_SITUATION_MODIFIER_STRENGTH * (legacy.situationFactor - 1);
    return {
      playType: legacy.playType,
      systemFactor: systemModifier,
      tendency,
      tendencyFactor: tendency,
      positionFactor: positionModifier,
      situationFactor: situationModifier,
      finalWeight: Math.max(CANDIDATE_SELECTOR_MIN_WEIGHT, tendency * systemModifier * positionModifier * situationModifier),
    };
  });
}

export function selectPlayType(
  ballHandler: Player,
  system: OffensiveSystem,
  situation: GameSituation,
  isTransitionOpportunity: boolean,
  rng: SeededRNG,
  config: PlayTypeSelectionConfig = LEGACY_PLAY_TYPE_SELECTION,
  onCourtPlayers: Player[] = [ballHandler],
): PlayType {
  if (isTransitionOpportunity) {
    return 'transition';
  }

  const playTypes: PlayType[] = [
    'isolation', 'pick_and_roll', 'post_up', 'spot_up',
    'cut', 'off_screen', 'handoff',
  ];

  if (config.mode === 'candidate') {
    const legacyFactors = explainLegacyPlayTypeSelection(ballHandler, system, situation);
    const weights = playTypes.map((pt) => {
      const legacy = legacyFactors.find((row) => row.playType === pt)!;
      const tendency = Math.max(CANDIDATE_SELECTOR_MIN_WEIGHT, weightedCandidateTendency(onCourtPlayers, pt));
      const positionFactor = weightedPositionFactor(onCourtPlayers, pt);
      const systemModifier = 1 + CANDIDATE_SYSTEM_MODIFIER_STRENGTH * (legacy.systemFactor - 1);
      const positionModifier = 1 + CANDIDATE_POSITION_MODIFIER_STRENGTH * (positionFactor - 1);
      const situationModifier = 1 + CANDIDATE_SITUATION_MODIFIER_STRENGTH * (legacy.situationFactor - 1);
      return tendency * systemModifier * positionModifier * situationModifier;
    });
    return rng.weightedChoice(playTypes, weights);
  }

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

function weightedCandidateTendency(players: Player[], playType: PlayType): number {
  const totalUsage = players.reduce((sum, player) => sum + player.tendencies.usageRate, 0);
  return players.reduce((sum, player) => sum + getCandidateTendencyForPlay(player, playType) * player.tendencies.usageRate, 0)
    / Math.max(CANDIDATE_SELECTOR_MIN_WEIGHT, totalUsage);
}

function weightedPositionFactor(players: Player[], playType: PlayType): number {
  const totalUsage = players.reduce((sum, player) => sum + player.tendencies.usageRate, 0);
  return players.reduce((sum, player) => {
    const factor = POSITION_PLAY_WEIGHTS[player.position]?.[playType] ?? 0.8;
    return sum + factor * player.tendencies.usageRate;
  }, 0) / Math.max(CANDIDATE_SELECTOR_MIN_WEIGHT, totalUsage);
}

function getCandidateTendencyForPlay(player: Player, playType: PlayType): number {
  if (playType === 'pick_and_roll') {
    // Synergy exposes the same PnR possession through the ball-handler and
    // roll-man role rows. Their sum is the player's mapped PnR share.
    return player.tendencies.pickAndRollBallHandlerFreq + player.tendencies.pickAndRollScreenerFreq;
  }
  return getPlayerTendencyForPlay(player, playType);
}

export function getPlayerTendencyForPlay(player: Player, playType: PlayType): number {
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

export interface ShotZoneContext {
  /** >1 chases threes (trailing late), <1 avoids them (protecting a lead). */
  threePointBias?: number;
  /** 0-1 rim deterrence from a shot-blocker — pushes shots away from the rim. */
  rimDeterrence?: number;
  /** Centered lineup spacing z-score (engine/spacing.ts); 0 = league average. */
  spacing?: number;
}

/**
 * Cumulative per-zone weight stages behind selectShotZone, exposed for the
 * read-only S2c2-R decomposition diagnostic (scripts/diagnose-s2c2-zones.ts).
 * `final` is the authoritative vector selectShotZone consumes — it is computed
 * with the exact expression shapes the selector always used, so extracting it
 * here changes no simulated outcome. The intermediate stages recompute the
 * same math cumulatively for attribution; ulp-level float reassociation
 * against `final` is irrelevant to the aggregate shares they exist to report.
 */
export interface ShotZoneWeightStages {
  zones: ShotZone[];
  /** s0 — raw table diet (shaded or real per the selection config). */
  table: number[];
  /** s1 — s0 × player tendency term (threePointRate / midrangeRate / rimRate). */
  tendency: number[];
  /** s2 — s1 × shooter outside-ability term (three-point zones only). */
  ability: number[];
  /** s3 — s2 × threeBias × global three dampener (threes) and × rim-deterrence multiplier (rim). */
  dampener: number[];
  /** s4 — s3 ± additive spacing terms. */
  spacing: number[];
  /** s5 — max(0.01, s4): the weights selectShotZone actually consumes. */
  final: number[];
}

export function explainShotZoneSelection(
  shooter: Player,
  playType: PlayType,
  ctx: ShotZoneContext = {},
  selection: PlayTypeSelectionConfig = LEGACY_PLAY_TYPE_SELECTION,
): ShotZoneWeightStages {
  const zoneOptions = (selection.shotZones === 'real' ? PLAY_TYPE_SHOT_ZONES_REAL : PLAY_TYPE_SHOT_ZONES)[playType];
  const zones = zoneOptions.map((z) => z.zone);
  const outside = shooter.ratings.outsideShooting / 80;
  const threeBias = ctx.threePointBias ?? 1;
  const rimDeterrence = ctx.rimDeterrence ?? 0;
  // Centered spacing reshapes the shot mix on the real Moreyball pattern: good
  // spacing opens driving lanes (rim↑) and the deterred mid-range is the donor
  // (mid↓), threes flat-to-up (drive-and-kick). Poor spacing packs the paint
  // (rim↓) and forces settle-for pull-ups (mid↑, three↓). All three are ADDITIVE
  // offsets scaled by the centered z, so an average lineup (spacing 0) is a
  // no-op. NOTE: this only moves FREQUENCY between zones; three-shot QUALITY is
  // handled separately via the openness term in resolveShot.
  const spacing = ctx.spacing ?? 0;
  const table: number[] = [];
  const tendency: number[] = [];
  const ability: number[] = [];
  const dampener: number[] = [];
  const spaced: number[] = [];
  const final: number[] = [];
  for (const z of zoneOptions) {
    let w = z.weight;
    table.push(z.weight);
    // Modify based on player shot tendencies and ability. A poor outside shooter
    // both wants to and should rarely launch threes.
    if (z.zone === 'corner_three' || z.zone === 'above_break_three' || z.zone === 'deep_three') {
      const tendencyTerm = 0.3 + shooter.tendencies.threePointRate * 2.0;
      const abilityTerm = 0.25 + outside * 1.5;
      // Global dampener pulls the league's three-point share down to ~40% of
      // attempts (real ~35 3PA on ~88 FGA).
      w *= tendencyTerm * abilityTerm * threeBias * 0.62;
      tendency.push(z.weight * tendencyTerm);
      ability.push(z.weight * tendencyTerm * abilityTerm);
      dampener.push(w);
      w += SPACING_THREE_FREQ_COEF * spacing; // flat-to-up: small, not the donor
      spaced.push(w);
    } else if (z.zone === 'short_midrange' || z.zone === 'long_midrange') {
      w *= 0.5 + shooter.tendencies.midrangeRate * 2.0;
      tendency.push(w);
      ability.push(w);
      dampener.push(w);
      w -= SPACING_MID_FREQ_COEF * spacing; // donor zone: shrinks when spacing is good
      spaced.push(w);
    } else if (z.zone === 'rim') {
      const tendencyTerm = 0.5 + shooter.tendencies.rimRate * 2.0;
      // Elite rim protection deters attacks at the basket.
      w *= tendencyTerm * (1 - rimDeterrence * 0.2);
      tendency.push(z.weight * tendencyTerm);
      ability.push(z.weight * tendencyTerm);
      dampener.push(w);
      // Good spacing opens the rim AND additively relieves rim-protection
      // deterrence (the help defender is occupied), scaled by how much
      // deterrence is present.
      w += (SPACING_RIM_FREQ_COEF + SPACING_RIM_DETER_RELIEF_COEF * rimDeterrence) * spacing;
      spaced.push(w);
    } else {
      // Every ShotZone is rim, mid, or three; unreachable, kept total for safety.
      tendency.push(w);
      ability.push(w);
      dampener.push(w);
      spaced.push(w);
    }
    final.push(Math.max(0.01, w));
  }
  return { zones, table, tendency, ability, dampener, spacing: spaced, final };
}

export function selectShotZone(
  shooter: Player,
  playType: PlayType,
  rng: SeededRNG,
  ctx: ShotZoneContext = {},
  selection: PlayTypeSelectionConfig = LEGACY_PLAY_TYPE_SELECTION,
): ShotZone {
  const { zones, final } = explainShotZoneSelection(shooter, playType, ctx, selection);
  return rng.weightedChoice(zones, final);
}

export function selectPrimaryPlayer(
  onCourt: Player[],
  playType: PlayType,
  rng: SeededRNG,
): Player {
  const weights = onCourt.map((p) => {
    // Base weight is the player's usage rate — the fraction of possessions he
    // consumes. This preserves the real proportional distribution: a 35% usage
    // star gets ~35% of possessions on a balanced lineup, and on a star-heavy
    // lineup where rates sum above 1.0, each player's share is compressed
    // proportionally (the one-ball constraint). posWeight and skillFit then
    // tune the distribution by play type on top.
    let w = p.tendencies.usageRate;
    const posWeight = POSITION_PLAY_WEIGHTS[p.position]?.[playType] ?? 0.8;
    w *= posWeight;
    // Skill fit: the player finishing a play should be suited to it. This keeps
    // shooters taking spot-up/off-screen threes and bigs taking post-ups,
    // instead of a center launching catch-and-shoot threes.
    w *= playTypeSkillFit(p, playType);
    return Math.max(PRIMARY_PLAYER_MIN_WEIGHT, w);
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
  playType: PlayType = 'isolation',
): Player {
  // On isolation and post-ups the offense actively hunts the weakest defender
  // (a classic switch-and-attack), so the primary defender skews softer. A
  // genuinely switchable defense (high perimeter-D FLOOR, low mobility/size
  // spread) finds that soft target LESS often: an additive, centered offset to
  // the hunt rate driven by the WEAK LINK, not the mean — so four studs and one
  // sieve (high mean, low floor) still get hunted. An average defense (z≈0)
  // leaves the 0.45 base rate unchanged.
  const huntsMismatch = playType === 'isolation' || playType === 'post_up';
  const versatility = computeVersatility(defensivePlayers);
  const huntRate = Math.max(0.15, Math.min(0.6, 0.45 - VERSATILITY_HUNT_COEF * versatility));
  if (huntsMismatch && rng.nextBool(huntRate)) {
    const weakWeights = defensivePlayers.map((d) => {
      const defRating = (d.ratings.perimeterDefense + d.ratings.interiorDefense + d.ratings.defensiveIQ) / 3;
      return Math.max(1, 85 - defRating); // invert: weaker defenders weighted higher
    });
    return rng.weightedChoice(defensivePlayers, weakWeights);
  }

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
  config: PlayTypeSelectionConfig = LEGACY_PLAY_TYPE_SELECTION,
): boolean {
  if (!previousPossessionWasTurnover && !previousPossessionWasLongRebound) {
    return false;
  }
  if (config.mode === 'candidate') {
    return rng.nextBool(getCandidateTransitionOpportunityChance(offensivePlayers));
  }
  return rng.nextBool(getLegacyTransitionOpportunityChance(offensivePlayers));
}

export function getCandidateTransitionOpportunityChance(offensivePlayers: Player[]): number {
  const totalUsage = offensivePlayers.reduce((sum, player) => sum + player.tendencies.usageRate, 0);
  const transitionTendency = offensivePlayers.reduce(
    (sum, player) => sum + player.tendencies.transitionFreq * player.tendencies.usageRate,
    0,
  ) / Math.max(CANDIDATE_SELECTOR_MIN_WEIGHT, totalUsage);
  return Math.max(0, Math.min(1, transitionTendency / CANDIDATE_TRANSITION_ELIGIBLE_RATE));
}

export function getLegacyTransitionOpportunityChance(offensivePlayers: Player[]): number {
  const avgAthleticism = offensivePlayers.reduce((sum, p) => sum + p.ratings.athleticism, 0) / offensivePlayers.length;
  return 0.15 + (avgAthleticism / 80) * 0.25;
}
