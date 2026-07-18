import { Player, Position } from '@/models/player';
import { PlayType, ShotZone } from '@/models/game';
import { OffensiveSystem } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import {
  PLAY_TYPE_SHOT_ZONES,
  SPACING_RIM_FREQ_COEF,
  SPACING_MID_FREQ_COEF,
  SPACING_THREE_FREQ_COEF,
  SPACING_RIM_DETER_RELIEF_COEF,
  VERSATILITY_HUNT_COEF,
  PRIMARY_PLAYER_MIN_WEIGHT,
  TRANSITION_ELIGIBLE_RATE,
  PLAY_TYPE_SELECTOR_MIN_WEIGHT,
  PLAY_TYPE_SYSTEM_MODIFIER_STRENGTH,
  PLAY_TYPE_POSITION_MODIFIER_STRENGTH,
  PLAY_TYPE_SITUATION_MODIFIER_STRENGTH,
  SHOT_ZONE_FREQUENCY_FACTORS,
  S3B1_MATCHUP_LIFT,
  S3B1_SECONDARY_POS_FACTOR,
  S3B1_QUALITY_COEF,
  S3B1_QUALITY_MIN,
  S3B1_QUALITY_MAX,
  S3B1_HUNT_BASE,
  S3B1_HUNT_MIN,
  S3B1_HUNT_MAX,
  S3B1_HUNT_TERM_MIN,
  S3B1_HUNT_TERM_MAX,
  S3B1_DEFENDER_MIN_WEIGHT,
} from './constants';
import { computeVersatility } from './spacing';
import { enginePositionToMatchupBucket } from '@/data/nba/position-mapping';

/** Machine-readable identity for S2d context checks; no selector mode is configurable at runtime. */
export const PRODUCTION_PLAY_TYPE_SELECTOR_ID = 'nba-derived-tendency-selector-v1';

const POSITION_PLAY_WEIGHTS: Record<Position, Partial<Record<PlayType, number>>> = {
  PG: { isolation: 1.2, pick_and_roll: 1.5, spot_up: 0.8, transition: 1.3, off_screen: 0.6, handoff: 1.0 },
  SG: { isolation: 1.0, pick_and_roll: 0.8, spot_up: 1.3, transition: 1.1, off_screen: 1.4, handoff: 0.9 },
  SF: { isolation: 1.1, pick_and_roll: 0.7, spot_up: 1.2, transition: 1.0, cut: 1.2, post_up: 0.7 },
  PF: { post_up: 1.2, pick_and_roll: 1.0, spot_up: 1.0, cut: 1.3, putback: 1.5 },
  C: { post_up: 1.5, pick_and_roll: 1.2, cut: 1.0, putback: 2.0, spot_up: 0.5 },
};

export interface PlayTypeSelectionFactor {
  playType: PlayType;
  systemFactor: number;
  tendency: number;
  positionFactor: number;
  situationFactor: number;
  finalWeight: number;
}

/** The half-court play types the selector weighs, in fixed selection order. */
const HALF_COURT_PLAY_TYPES: PlayType[] = [
  'isolation', 'pick_and_roll', 'post_up', 'spot_up',
  'cut', 'off_screen', 'handoff',
];

function systemEmphasisFactor(playType: PlayType, system: OffensiveSystem): number {
  switch (playType) {
    case 'isolation': return 0.6 + system.isolationEmphasis * 0.8;
    case 'pick_and_roll': return 0.8 + system.screeningEmphasis * 0.6;
    case 'post_up': return 0.4 + system.postPlayEmphasis * 1.0;
    case 'spot_up': return 0.8 + system.threePointEmphasis * 0.6;
    case 'cut': return 0.6 + system.screeningEmphasis * 0.4;
    case 'off_screen': return 0.5 + system.threePointEmphasis * 0.5;
    case 'handoff': return 0.5 + system.screeningEmphasis * 0.3;
    default: return 1.0;
  }
}

function situationEmphasisFactor(playType: PlayType, situation: GameSituation): number {
  let factor = 1.0;
  if (situation.quarter >= 4 && Math.abs(situation.scoreDiff) <= 5 && situation.gameClock < 120) {
    if (playType === 'isolation') factor *= 1.5;
    if (playType === 'pick_and_roll') factor *= 1.2;
  }
  if (situation.scoreDiff < -15 && (playType === 'spot_up' || playType === 'off_screen')) {
    factor *= 1.4;
  }
  return factor;
}

/** Usage-weighted mean of a per-player value over the on-court five. */
function usageWeightedMean(players: Player[], totalUsage: number, valueOf: (player: Player) => number): number {
  return players.reduce((sum, player) => sum + valueOf(player) * player.tendencies.usageRate, 0)
    / Math.max(PLAY_TYPE_SELECTOR_MIN_WEIGHT, totalUsage);
}

function totalUsageOf(players: Player[]): number {
  return players.reduce((sum, player) => sum + player.tendencies.usageRate, 0);
}

function playTypeTendency(players: Player[], totalUsage: number, playType: PlayType): number {
  return Math.max(
    PLAY_TYPE_SELECTOR_MIN_WEIGHT,
    usageWeightedMean(players, totalUsage, (player) => getProductionTendencyForPlay(player, playType)),
  );
}

function weightedPositionFactor(players: Player[], totalUsage: number, playType: PlayType): number {
  return usageWeightedMean(players, totalUsage, (player) => POSITION_PLAY_WEIGHTS[player.position]?.[playType] ?? 0.8);
}

/**
 * Selector weight for one play type — the single source of the composition
 * formula, shared by the hot selection path and the diagnostic decomposition.
 */
function playTypeFinalWeight(
  playType: PlayType,
  players: Player[],
  totalUsage: number,
  system: OffensiveSystem,
  situation: GameSituation,
): number {
  return Math.max(
    PLAY_TYPE_SELECTOR_MIN_WEIGHT,
    playTypeTendency(players, totalUsage, playType)
      * (1 + PLAY_TYPE_SYSTEM_MODIFIER_STRENGTH * (systemEmphasisFactor(playType, system) - 1))
      * (1 + PLAY_TYPE_POSITION_MODIFIER_STRENGTH * (weightedPositionFactor(players, totalUsage, playType) - 1))
      * (1 + PLAY_TYPE_SITUATION_MODIFIER_STRENGTH * (situationEmphasisFactor(playType, situation) - 1)),
  );
}

/** Read-only decomposition of the production, NBA-derived selector. */
export function explainPlayTypeSelection(
  onCourtPlayers: Player[],
  system: OffensiveSystem,
  situation: GameSituation,
): PlayTypeSelectionFactor[] {
  const totalUsage = totalUsageOf(onCourtPlayers);
  return HALF_COURT_PLAY_TYPES.map((pt) => ({
    playType: pt,
    systemFactor: 1 + PLAY_TYPE_SYSTEM_MODIFIER_STRENGTH * (systemEmphasisFactor(pt, system) - 1),
    tendency: playTypeTendency(onCourtPlayers, totalUsage, pt),
    positionFactor: 1 + PLAY_TYPE_POSITION_MODIFIER_STRENGTH * (weightedPositionFactor(onCourtPlayers, totalUsage, pt) - 1),
    situationFactor: 1 + PLAY_TYPE_SITUATION_MODIFIER_STRENGTH * (situationEmphasisFactor(pt, situation) - 1),
    finalWeight: playTypeFinalWeight(pt, onCourtPlayers, totalUsage, system, situation),
  }));
}

export interface GameSituation {
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
  onCourtPlayers: Player[] = [ballHandler],
): PlayType {
  if (isTransitionOpportunity) {
    return 'transition';
  }

  const totalUsage = totalUsageOf(onCourtPlayers);
  return rng.weightedChoice(
    HALF_COURT_PLAY_TYPES,
    HALF_COURT_PLAY_TYPES.map((pt) => playTypeFinalWeight(pt, onCourtPlayers, totalUsage, system, situation)),
  );
}

function getProductionTendencyForPlay(player: Player, playType: PlayType): number {
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
 * Cumulative per-zone weight stages behind selectShotZone (a read-only
 * decomposition seam; the S2c2-R diagnostic that consumed it was retired at
 * S2d, but the attribution stages remain the documented way to instrument
 * zone selection).
 * `final` is the authoritative vector selectShotZone consumes — it is computed
 * with the exact expression shapes the selector always used, so extracting it
 * here changes no simulated outcome. The intermediate stages recompute the
 * same math cumulatively for attribution; ulp-level float reassociation
 * against `final` is irrelevant to the aggregate shares they exist to report.
 */
export interface ShotZoneWeightStages {
  zones: ShotZone[];
  /** s0 — the active production table diet. */
  table: number[];
  /** s1 — s0 × player tendency term (threePointRate / midrangeRate / rimRate). */
  tendency: number[];
  /** s2 — s1 × shooter outside-ability term (three-point zones only). */
  ability: number[];
  /** s3 — s2 × per-zone frequency factor, × threeBias (threes) and × rim-deterrence multiplier (rim). */
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
): ShotZoneWeightStages {
  const zoneOptions = PLAY_TYPE_SHOT_ZONES[playType];
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
      // Per-zone frequency factor; see its annotation in constants.ts for
      // range and the per-type diet-distortion caveat.
      w *= tendencyTerm * abilityTerm * threeBias * SHOT_ZONE_FREQUENCY_FACTORS[z.zone];
      tendency.push(z.weight * tendencyTerm);
      ability.push(z.weight * tendencyTerm * abilityTerm);
      dampener.push(w);
      w += SPACING_THREE_FREQ_COEF * spacing; // flat-to-up: small, not the donor
      spaced.push(w);
    } else if (z.zone === 'short_midrange' || z.zone === 'long_midrange') {
      const tendencyTerm = 0.5 + shooter.tendencies.midrangeRate * 2.0;
      w *= tendencyTerm * SHOT_ZONE_FREQUENCY_FACTORS[z.zone];
      tendency.push(z.weight * tendencyTerm);
      ability.push(z.weight * tendencyTerm);
      dampener.push(w);
      w -= SPACING_MID_FREQ_COEF * spacing; // donor zone: shrinks when spacing is good
      spaced.push(w);
    } else if (z.zone === 'rim') {
      const tendencyTerm = 0.5 + shooter.tendencies.rimRate * 2.0;
      // Elite rim protection deters attacks at the basket.
      w *= tendencyTerm * (1 - rimDeterrence * 0.2) * SHOT_ZONE_FREQUENCY_FACTORS[z.zone];
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
): ShotZone {
  const { zones, final } = explainShotZoneSelection(shooter, playType, ctx);
  return rng.weightedChoice(zones, final);
}

/**
 * Production finisher-selection weight for one player on one play type — the
 * single source shared by selectPrimaryPlayer and the spacing-baseline
 * calibration (scripts/calibrate-spacing.ts), so the derived SPACING_*
 * constants stay centered on the population the runtime actually selects.
 *
 * Base weight is the player's usage rate — the fraction of possessions he
 * consumes. This preserves the real proportional distribution: a 35% usage
 * star gets ~35% of possessions on a balanced lineup, and on a star-heavy
 * lineup where rates sum above 1.0, each player's share is compressed
 * proportionally (the one-ball constraint). posWeight and skillFit then tune
 * the distribution by play type on top: the player finishing a play should be
 * suited to it — shooters take spot-up/off-screen threes and bigs take
 * post-ups, instead of a center launching catch-and-shoot threes.
 */
export function primaryPlayerWeight(p: Player, playType: PlayType): number {
  let w = p.tendencies.usageRate;
  const posWeight = POSITION_PLAY_WEIGHTS[p.position]?.[playType] ?? 0.8;
  w *= posWeight;
  w *= playTypeSkillFit(p, playType);
  return Math.max(PRIMARY_PLAYER_MIN_WEIGHT, w);
}

export function selectPrimaryPlayer(
  onCourt: Player[],
  playType: PlayType,
  rng: SeededRNG,
): Player {
  return rng.weightedChoice(onCourt, onCourt.map((p) => primaryPlayerWeight(p, playType)));
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
  playType: PlayType,
): Player {
  const factors = explainDefenderSelection(defensivePlayers, shooter, playType);
  return rng.weightedChoice(defensivePlayers, factors.map((factor) => factor.finalWeight));
}

export interface DefenderSelectionFactor {
  defenderId: string;
  position: Position;
  shooterBucket: keyof typeof S3B1_MATCHUP_LIFT[Position];
  avgDef: number;
  weakness: number;
  posTerm: number;
  qualTerm: number;
  huntStrength: number;
  huntTerm: number;
  rawWeight: number;
  finalWeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Pure decomposition of S3.b1 defender assignment, in existing lineup order.
 * The empirical term uses only the shooter's primary engine position. The same
 * three-rating average drives quality and signed weak-link hunting.
 */
export function explainDefenderSelection(
  defensivePlayers: Player[],
  shooter: Player,
  playType: PlayType,
): DefenderSelectionFactor[] {
  const shooterBucket = enginePositionToMatchupBucket(shooter.position);
  const huntsMismatch = playType === 'isolation' || playType === 'post_up';
  const versatilityZ = computeVersatility(defensivePlayers);
  const huntStrength = huntsMismatch
    ? clamp(S3B1_HUNT_BASE - VERSATILITY_HUNT_COEF * versatilityZ, S3B1_HUNT_MIN, S3B1_HUNT_MAX)
    : 0;

  const raw = defensivePlayers.map((defender) => {
    const avgDef = (
      defender.ratings.perimeterDefense
      + defender.ratings.interiorDefense
      + defender.ratings.defensiveIQ
    ) / 3;
    const weakness = (40 - avgDef) / 40;
    const primaryLift = S3B1_MATCHUP_LIFT[defender.position][shooterBucket];
    const secondaryLift = defender.secondaryPosition === undefined
      ? 0
      : S3B1_SECONDARY_POS_FACTOR * S3B1_MATCHUP_LIFT[defender.secondaryPosition][shooterBucket];
    const posTerm = Math.max(primaryLift, secondaryLift);
    const qualTerm = clamp(
      1 + S3B1_QUALITY_COEF * (avgDef - 40) / 40,
      S3B1_QUALITY_MIN,
      S3B1_QUALITY_MAX,
    );
    const huntTerm = huntsMismatch
      ? clamp(1 + huntStrength * weakness, S3B1_HUNT_TERM_MIN, S3B1_HUNT_TERM_MAX)
      : 1;
    const rawWeight = posTerm * qualTerm * huntTerm;
    return {
      defenderId: defender.id,
      position: defender.position,
      shooterBucket,
      avgDef,
      weakness,
      posTerm,
      qualTerm,
      huntStrength,
      huntTerm,
      rawWeight,
    };
  });
  const maxRawWeight = Math.max(...raw.map((factor) => factor.rawWeight));
  return raw.map((factor) => ({
    ...factor,
    finalWeight: Math.max(factor.rawWeight, S3B1_DEFENDER_MIN_WEIGHT * maxRawWeight),
  }));
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
  return rng.nextBool(getTransitionOpportunityChance(offensivePlayers));
}

export function getTransitionOpportunityChance(offensivePlayers: Player[]): number {
  const transitionTendency = usageWeightedMean(
    offensivePlayers,
    totalUsageOf(offensivePlayers),
    (player) => player.tendencies.transitionFreq,
  );
  return Math.max(0, Math.min(1, transitionTendency / TRANSITION_ELIGIBLE_RATE));
}
