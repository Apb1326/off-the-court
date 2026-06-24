export interface Game {
  id: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  date: string;

  result?: GameResult;
  boxScore?: BoxScore;
  playByPlay?: PlayByPlayEvent[];
}

export interface GameResult {
  homeScore: number;
  awayScore: number;
  overtimePeriods: number;
  winnerId: string;
}

export interface BoxScore {
  homeTeam: TeamBoxScore;
  awayTeam: TeamBoxScore;
}

export interface TeamBoxScore {
  teamId: string;
  players: PlayerBoxLine[];
  totals: StatLine;
}

export interface PlayerBoxLine {
  playerId: string;
  starter: boolean;
  minutes: number;
  stats: StatLine;
}

export interface StatLine {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  personalFouls: number;
  plusMinus: number;

  // Advanced (computed post-game)
  trueShootingPct?: number;
  effectiveFieldGoalPct?: number;
  usageRate?: number;
  offensiveRating?: number;
  defensiveRating?: number;
  gameScore?: number;
}

export type PlayType =
  | 'isolation'
  | 'pick_and_roll'
  | 'post_up'
  | 'spot_up'
  | 'transition'
  | 'cut'
  | 'off_screen'
  | 'handoff'
  | 'putback';

export type ShotZone =
  | 'rim'
  | 'short_midrange'
  | 'long_midrange'
  | 'corner_three'
  | 'above_break_three'
  | 'deep_three';

export type PossessionOutcome =
  | 'made_shot'
  | 'missed_shot'
  | 'turnover'
  | 'foul'
  | 'and_one'
  | 'end_of_period';

export type TurnoverType =
  | 'steal'
  | 'bad_pass'
  | 'travel'
  | 'offensive_foul'
  | 'out_of_bounds'
  | 'shot_clock_violation';

export interface PlayByPlayEvent {
  quarter: number;
  gameClock: number; // seconds remaining in quarter
  shotClock: number;
  possessionTeamId: string;

  type: PlayType;
  primaryPlayerId: string;
  secondaryPlayerId?: string;
  assistPlayerId?: string;

  outcome: PossessionOutcome;
  shotZone?: ShotZone;
  shotMade?: boolean;
  points?: number;

  reboundPlayerId?: string;
  reboundType?: 'offensive' | 'defensive';

  foulPlayerId?: string;
  freeThrowsMade?: number;
  freeThrowsAttempted?: number;

  turnoverType?: TurnoverType;
  stealPlayerId?: string;
  blockPlayerId?: string;

  homeScore: number;
  awayScore: number;

  description: string;
}

export function emptyStatLine(): StatLine {
  return {
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personalFouls: 0,
    plusMinus: 0,
  };
}
