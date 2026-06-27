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
 * each entry is fully self-contained — it carries its own `season` and a finalized
 * `gamesMissed` — so a multi-season/career log is just these entries concatenated
 * across seasons, with no dependency on any season's live schedule to interpret.
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
  gamesMissed: number;   // finalized games missed, capped by season length
}

/** A persisted, in-progress season the user advances through day by day. */
export interface SeasonState {
  seasonId: string;
  seed: number;
  /**
   * The team id the player controls (their GM franchise). `null` means no team is
   * controlled — a league-wide/spectator perspective, and the value legacy saves
   * (created before team selection existed) normalize to. This is purely a
   * perspective marker: the simulation never reads it, so it cannot change any
   * outcome. Use `isControlledTeam` / `getControlledTeamId` to query it rather
   * than comparing the field directly.
   */
  controlledTeamId: string | null;
  startDate: string;
  endDate: string;
  currentDate: string; // last date simulated through (games on/before this are played)
  schedule: ScheduledGame[];
  markers: SeasonMarker[];
  standings: TeamStanding[];
  playerStats: PlayerSeasonStats[];
  results: GameSummary[];
  injuries: PlayerInjury[];
  recoveries: PlayerRecovery[];
  injuryHistory: InjuryHistoryEntry[];
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

/**
 * The single source of truth for "is this the player's team or a CPU team."
 * Returns true only when a team is controlled and its id matches. Later GM
 * features (transactions, AI-GM behavior) should branch on this accessor rather
 * than re-implementing the comparison.
 */
export function isControlledTeam(state: SeasonState, teamId: string): boolean {
  return state.controlledTeamId != null && state.controlledTeamId === teamId;
}

/** The controlled team id, or null for a league-wide/spectator perspective. */
export function getControlledTeamId(state: SeasonState): string | null {
  return state.controlledTeamId ?? null;
}

/**
 * Bring a possibly-legacy SeasonState up to the current shape in place. Older
 * persisted states predate `controlledTeamId`; default it to null (no controlled
 * team) so every loaded state satisfies the type and the accessors above. Add new
 * field back-fills here as the shape grows.
 */
export function normalizeSeasonState(state: SeasonState): SeasonState {
  if (state.controlledTeamId === undefined) {
    state.controlledTeamId = null;
  }
  return state;
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
