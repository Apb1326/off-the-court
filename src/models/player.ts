export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  secondaryPosition?: Position;
  height: number; // inches
  weight: number; // pounds
  age: number;
  experience: number; // years in league
  teamId: string;
  jerseyNumber: number;

  ratings: PlayerRatings;
  potential: PlayerRatings;
  scoutingAccuracy: number; // 0-1

  tendencies: PlayerTendencies;
  contract: Contract;
  desiredContract?: DesiredContract;
  /** Re-signing rights exist only while the player is a free agent. */
  birdRights?: ReSigningRights;
  health: HealthStatus;

  careerStats: SeasonStats[];
}

export type ReSigningRightsType = 'bird' | 'early_bird' | 'non_bird';

export interface ReSigningRights {
  teamId: string;
  type: ReSigningRightsType;
}

export interface PlayerRatings {
  // Offensive (1-80)
  outsideShooting: number;
  midrangeShooting: number;
  interiorScoring: number;
  freeThrowShooting: number;
  ballHandling: number;
  passing: number;
  offensiveIQ: number;

  // Defensive (1-80)
  perimeterDefense: number;
  interiorDefense: number;
  defensiveIQ: number;
  steal: number;
  block: number;

  // Physical (1-80)
  athleticism: number;
  strength: number;
  rebounding: number;
  stamina: number;
  durability: number;
}

export interface PlayerTendencies {
  isolationFreq: number;
  pickAndRollBallHandlerFreq: number;
  pickAndRollScreenerFreq: number;
  postUpFreq: number;
  spotUpFreq: number;
  transitionFreq: number;
  cutFreq: number;
  offScreenFreq: number;
  handoffFreq: number;

  threePointRate: number;
  midrangeRate: number;
  rimRate: number;

  drawFoulRate: number;
  assistRate: number;
  usageRate: number;
  reboundRate: number;
}

/**
 * Contract types. Phase 2 sets these as data; enforcement comes later.
 * - 'rookie_scale': first contracts for drafted players (Phase 8 will set these on draft)
 * - 'veteran': standard negotiated contract
 * - 'max': a designated-player or max contract
 * - 'minimum': a veteran- or league-minimum contract
 * - 'two_way': excluded from standard-roster counts; separate slot limits remain deferred
 */
export type ContractType = 'rookie_scale' | 'veteran' | 'max' | 'minimum' | 'two_way';

/**
 * An option on a specific contract year. Set here (Phase 2); resolved in Phase 5a
 * (contract lifecycle / season rollover).
 */
export interface ContractOption {
  type: 'player' | 'team';
  /** 0-indexed year the option applies to (typically the last year). */
  year: number;
}

/**
 * A player's contract. Replaces the Phase 1 placeholder.
 *
 * - `salarySchedule[0]` is the current-year salary. Length = years remaining.
 * - `noTradeClause` is set here, *enforced* in Phase 4 (legality predicate).
 * - `option` is set here, *resolved* in Phase 5a (season rollover).
 * - `type: 'two_way'` does not occupy a standard-roster slot; separate two-way slot
 *   limits and roster structures are deferred.
 *
 * Simplification: a single `option?` cannot represent the two team options on a
 * real rookie-scale deal. Known limitation — Phase 5a may introduce `options[]`.
 *
 * When a player enters the FA pool, `contract` is preserved as their previous/last
 * contract (not an active deal). The `desiredContract` field is what they carry to market.
 */
export interface Contract {
  type: ContractType;
  /** Salary per year in millions, index 0 = current year. Length = years remaining. */
  salarySchedule: number[];
  noTradeClause: boolean;
  option?: ContractOption;
}

/**
 * What a free agent wants when they sign. Signing instantiates a real `Contract`
 * from these parameters. Set when a player enters the FA pool; cleared on signing.
 */
export interface DesiredContract {
  type: ContractType;
  /** Annual salary they're seeking, in millions. */
  desiredSalary: number;
  /** Number of years they want. */
  desiredYears: number;
}

export interface HealthStatus {
  healthy: boolean;
  injury?: string;
  gamesRemaining?: number;
}

export interface SeasonStats {
  season: string; // e.g. "2024-25"
  teamId: string;
  gamesPlayed: number;
  gamesStarted: number;
  minutesPerGame: number;
  stats: PerGameStats;
}

export interface PerGameStats {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  fieldGoalPct: number;
  threePointersMade: number;
  threePointersAttempted: number;
  threePointPct: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  freeThrowPct: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  personalFouls: number;
}

export const RATING_LABELS: Record<string, string> = {
  outsideShooting: 'Outside Shooting',
  midrangeShooting: 'Mid-Range',
  interiorScoring: 'Interior Scoring',
  freeThrowShooting: 'Free Throws',
  ballHandling: 'Ball Handling',
  passing: 'Passing',
  offensiveIQ: 'Offensive IQ',
  perimeterDefense: 'Perimeter Defense',
  interiorDefense: 'Interior Defense',
  defensiveIQ: 'Defensive IQ',
  steal: 'Steal',
  block: 'Block',
  athleticism: 'Athleticism',
  strength: 'Strength',
  rebounding: 'Rebounding',
  stamina: 'Stamina',
  durability: 'Durability',
};
