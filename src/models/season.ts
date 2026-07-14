import { StatLine } from './game';
import { TransactionEntry } from './transaction';

/** Immutable, append-only grant record for a banked Standard TPE. */
export interface TradeException {
  id: string;
  teamId: string;
  sourceTradeSeq: number;
  sourcePlayerId: string;
  /** Original banked amount in millions. Never mutate this field. */
  amount: number;
  createdDate: string;
  expiresDate: string;
  createdSeason: string;
}

/** Historical event-state needed to determine which signing exceptions remain available. */
export interface TeamExceptionState {
  teamId: string;
  capYear: number;
  /** Event-set fact: once true, it remains true for that cap year. */
  operatedUnderCap: true;
}

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

export type PlayoffConference = 'East' | 'West';
export type PlayoffRound =
  | 'play_in'
  | 'first_round'
  | 'conference_semifinals'
  | 'conference_finals'
  | 'finals';
export type PlayoffStatus = 'pending' | 'in_progress' | 'complete' | 'grandfathered_complete';

export interface PlayoffSeed {
  conference: PlayoffConference;
  seed: number;
  teamId: string;
}

/** One persisted bracket slot. Team A/B order never controls game identity. */
export interface PlayoffSeries {
  id: string;
  round: PlayoffRound;
  conference: PlayoffConference | null;
  bracketPosition: string;
  teamAId: string;
  teamBId: string;
  teamASeed: number;
  teamBSeed: number;
  homeCourtTeamId: string;
  winsRequired: number;
  startDate: string;
}

/** A bracket slot enriched from the authoritative completed-results ledger. */
export interface DerivedPlayoffSeries extends PlayoffSeries {
  teamAWins: number;
  teamBWins: number;
  gameIds: string[];
  winnerTeamId: string | null;
}

/**
 * Persisted postseason state. Regular-season schedule/results/standings remain
 * separate and freeze once their slate completes.
 */
export interface PlayoffsState {
  playInEnabled: boolean;
  startDate: string | null;
  endDate: string | null;
  seeds: PlayoffSeed[];
  series: PlayoffSeries[];
  schedule: ScheduledGame[];
  /** Migration fact for a completed pre-F2 v7 season with no playoff evidence. */
  grandfatheredComplete?: true;
}

export function emptyPlayoffs(grandfatheredComplete = false): PlayoffsState {
  return {
    playInEnabled: true,
    startDate: null,
    endDate: null,
    seeds: [],
    series: [],
    schedule: [],
    ...(grandfatheredComplete ? { grandfatheredComplete: true as const } : {}),
  };
}

/**
 * A temporal, season-level injury record. Injuries are not permanent player
 * attributes — they live on the SeasonState (out from one game through a later
 * one), so `player.health` is never mutated by the season loop.
 */
export interface PlayerInjury {
  playerId: string;
  teamId: string;
  injuryType: string;        // human-readable: 'ankle sprain', 'hamstring', etc.
  severity: 'day_to_day' | 'out' | 'season_ending';
  gamesRemaining: number;    // counts down by team-games-played, not calendar days
  startDate: string;         // YYYY-MM-DD when the injury occurred
}

/**
 * A short post-recovery vulnerability window. After an injury heals, the player
 * is back on the floor but carries elevated re-injury risk for a few games,
 * biased toward the same body region (soft-tissue injuries especially recur).
 * This is separate from `injuries` — a player with a recovery is healthy and
 * available, just fragile.
 */
export interface PlayerRecovery {
  playerId: string;
  teamId: string;
  region: string;      // body region still vulnerable (from the healed injury)
  gamesLeft: number;   // games remaining in the heightened-risk window
}

/**
 * An immutable, append-only record of one injury that occurred. Stored per season
 * on SeasonState.injuryHistory. Designed to roll up into a career history later:
 * Legacy entries carry a finalized `gamesMissed`. New F2 entries are immutable
 * onset evidence; their missed-game count is derived from the result ledger.
 */
export interface InjuryHistoryEntry {
  id: string;            // unique within a season: `${playerId}|${startDate}`
  season: string;        // seasonId — the key that makes multi-season aggregation trivial
  playerId: string;
  teamId: string;
  injuryType: string;
  region: string;
  severity: PlayerInjury['severity'];
  startDate: string;     // YYYY-MM-DD the injury occurred
  /** Present only on legacy pre-v8 entries. */
  gamesMissed?: number;
  /** New v8 onset evidence. */
  onsetGameId?: string;
  playedOnset?: boolean;
  maxGamesMissed?: number;
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
  playoffPlayerStats: PlayerSeasonStats[];
  results: GameSummary[];
  playoffs: PlayoffsState;
  injuries: PlayerInjury[];
  recoveries: PlayerRecovery[];
  injuryHistory: InjuryHistoryEntry[];
  /**
   * The canonical home for every unsigned player (player ids), established in
   * transactions Phase 1. A real collection — not a flag on the player. Everything that
   * releases a player adds them here; signing draws from here.
   */
  freeAgentPool: string[];
  /**
   * Append-only roster-transaction history (trades, signings, cuts). Entries are
   * immutable once written; never rewrite one. See `TransactionEntry`.
   */
  transactionLog: TransactionEntry[];
  /** Append-only event-set grant ledger. Balances and expiry are always derived. */
  tradeExceptions: TradeException[];
  /** Append-only per-cap-year history; legacy v4 saves intentionally start empty. */
  teamExceptionStates: TeamExceptionState[];
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
