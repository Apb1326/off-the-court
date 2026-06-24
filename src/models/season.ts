import { StatLine } from './game';

export interface ScheduledGame {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  day: number; // ordinal slot in the season
  date?: string; // 'YYYY-MM-DD', assigned by the calendar
}

export type MarkerType =
  | 'season_start'
  | 'trade_deadline'
  | 'all_star_break'
  | 'all_star_game'
  | 'season_end';

export interface SeasonMarker {
  type: MarkerType;
  date: string; // 'YYYY-MM-DD'
  label: string;
}

/** Compact record of a finished game, kept on the season state. */
export interface GameSummary {
  id: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  overtimePeriods: number;
  winnerId: string;
}

/** A persisted, in-progress season the user advances through day by day. */
export interface SeasonState {
  seasonId: string;
  seed: number;
  startDate: string;
  endDate: string;
  currentDate: string; // last date simulated through (games on/before this are played)
  schedule: ScheduledGame[];
  markers: SeasonMarker[];
  standings: TeamStanding[];
  playerStats: PlayerSeasonStats[];
  results: GameSummary[];
  gamesPlayed: number;
  totalGames: number;
}

export interface TeamStanding {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  homeWins: number;
  homeLosses: number;
  awayWins: number;
  awayLosses: number;
  confWins: number;
  confLosses: number;
  divWins: number;
  divLosses: number;
  streak: number; // positive = win streak, negative = loss streak
  lastTen: ('W' | 'L')[];
}

export interface PlayerSeasonStats {
  playerId: string;
  teamId: string;
  gamesPlayed: number;
  gamesStarted: number;
  minutes: number;
  totals: StatLine;
}

export interface SeasonResult {
  seasonId: string;
  gamesPlayed: number;
  standings: TeamStanding[];
  playerStats: PlayerSeasonStats[];
}

export function emptyStanding(teamId: string): TeamStanding {
  return {
    teamId,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    homeWins: 0,
    homeLosses: 0,
    awayWins: 0,
    awayLosses: 0,
    confWins: 0,
    confLosses: 0,
    divWins: 0,
    divLosses: 0,
    streak: 0,
    lastTen: [],
  };
}
