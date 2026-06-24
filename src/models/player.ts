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
  health: HealthStatus;

  careerStats: SeasonStats[];
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

export interface Contract {
  yearsRemaining: number;
  salaryPerYear: number; // in millions
  option?: 'player' | 'team' | 'none';
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
