/**
 * TypeScript mirrors of the v1 normalized NBA data contracts produced by
 * pipeline/normalize.py (and pipeline/crosswalk.py) into data/nba/normalized/.
 *
 * These contracts are the ONLY interface between the Python pipeline and the
 * TypeScript side. TypeScript never calls stats.nba.com. If the NBA changes
 * an endpoint, only the Python side changes; these shapes stay stable and
 * are versioned via `schema_version`.
 */

export const NBA_DATA_SCHEMA_VERSION = 1;

/** Envelope shared by every seasonal contract file. */
export interface SeasonEnvelope<Row> {
  schema_version: number;
  season: string; // NBA notation, e.g. "2024-25"
  rows: Row[];
}

// ---------------------------------------------------------------- players

export interface NbaPlayerRow {
  personId: number;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  teamId: number | null;
  teamAbbreviation: string | null;
  age: number | null;
  position: string | null; // NBA notation: G, F, C, G-F, ...
  heightCm: number | null;
  weightKg: number | null;
  country: string | null;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  fromYear: number | null;
  toYear: number | null;
  wingspanCm: number | null; // from draft combine, where matched
}

// ----------------------------------------------------------- box_advanced

export interface BoxBaseLine {
  gp: number | null;
  w: number | null;
  l: number | null;
  min: number | null;
  fgm: number | null;
  fga: number | null;
  fgPct: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fg3Pct: number | null;
  ftm: number | null;
  fta: number | null;
  ftPct: number | null;
  oreb: number | null;
  dreb: number | null;
  reb: number | null;
  ast: number | null;
  tov: number | null;
  stl: number | null;
  blk: number | null;
  blka: number | null;
  pf: number | null;
  pfd: number | null;
  pts: number | null;
  plusMinus: number | null;
}

export interface BoxAdvancedBlock {
  offRating: number | null;
  defRating: number | null;
  netRating: number | null;
  astPct: number | null;
  astTo: number | null;
  astRatio: number | null;
  orebPct: number | null;
  drebPct: number | null;
  rebPct: number | null;
  tmTovPct: number | null;
  efgPct: number | null;
  tsPct: number | null;
  usgPct: number | null;
  pace: number | null;
  pie: number | null;
  poss: number | null;
}

export interface BoxPer100Block {
  fgm: number | null;
  fga: number | null;
  fg3m: number | null;
  fg3a: number | null;
  ftm: number | null;
  fta: number | null;
  oreb: number | null;
  dreb: number | null;
  reb: number | null;
  ast: number | null;
  tov: number | null;
  stl: number | null;
  blk: number | null;
  pf: number | null;
  pfd: number | null;
  pts: number | null;
}

export interface BoxAdvancedRow {
  personId: number;
  name: string | null;
  teamId: number | null;
  age: number | null;
  gp: number | null;
  mpg: number | null;
  perGame: BoxBaseLine;
  advanced: BoxAdvancedBlock | null;
  /** Share-of-team columns from MeasureType=Usage, camelCased. */
  usage: Record<string, number | string | null> | null;
  /** Scoring-mix columns from MeasureType=Scoring, camelCased. */
  scoring: Record<string, number | string | null> | null;
  /** Defensive columns from MeasureType=Defense, camelCased. */
  defense: Record<string, number | string | null> | null;
  per100: BoxPer100Block | null;
}

// ------------------------------------------------------------- shot_zones

export interface ZoneLine {
  fgm: number;
  fga: number;
  fgPct?: number | null;
}

/** OTC's five-zone taxonomy. See pipeline/lib/zones.py for the mapping. */
export type OtcZone =
  | 'rim'
  | 'short_midrange'
  | 'long_midrange'
  | 'corner_three'
  | 'above_break_three';

export interface ShotZonesRow {
  personId: number;
  name: string | null;
  teamId: number | null;
  /** Raw NBA zone columns, kept so the mapping can be revisited. */
  nbaZones: Record<string, ZoneLine>;
  otcZones: Record<OtcZone, ZoneLine>;
}

// ------------------------------------------------------------ shot_events

export interface ShotEventRow {
  gameId: string;
  gameEventId: number;
  playerId: number;
  teamId: number | null;
  period: number;
  minutesRemaining: number;
  secondsRemaining: number;
  actionType: string | null;
  shotType: string | null; // "2PT Field Goal" | "3PT Field Goal"
  shotZoneBasic: string | null;
  shotZoneArea: string | null;
  shotZoneRange: string | null;
  shotDistance: number | null;
  locX: number | null;
  locY: number | null;
  made: boolean;
}

// -------------------------------------------------------------- playtypes

export interface PlayTypeRow {
  personId: number;
  name: string | null;
  teamId: number | null;
  playType: string; // Isolation, PRBallHandler, ...
  typeGrouping: 'offensive' | 'defensive';
  gp: number | null;
  poss: number | null;
  possPct: number | null; // frequency
  ppp: number | null;
  pts: number | null;
  fgm: number | null;
  fga: number | null;
  fgPct: number | null;
  efgPct: number | null;
  ftPossPct: number | null;
  tovPossPct: number | null;
  sfPossPct: number | null;
  scorePossPct: number | null;
  percentile: number | null;
}

// --------------------------------------------------------------- tracking

export interface TrackingRow {
  personId: number;
  name: string | null;
  teamId: number | null;
  /**
   * One block per harvested PtMeasureType, keyed by lowerCamel measure name
   * (drives, passing, possessions, pullUpShot, catchShoot, rebounding,
   * defense, speedDistance, elbowTouch, postTouch, paintTouch, efficiency),
   * each holding that measure's camelCased stat columns.
   */
  measures: Record<string, Record<string, number | string | null>>;
}

// ---------------------------------------------------------------- defense

export interface DefendedCategoryLine {
  gp: number | null;
  freq: number | null;
  dFgm: number | null;
  dFga: number | null;
  dFgPct: number | null;
  normalFgPct: number | null;
  pctPlusMinus: number | null;
}

export interface MatchupPositionBucket {
  partialPoss: number;
  playerPts: number;
  matchupFgm: number;
  matchupFga: number;
  matchupFg3m: number;
  matchupFg3a: number;
  matchupFgPct: number | null;
}

export interface DefenseRow {
  personId: number;
  name: string | null;
  teamId: number | null;
  /** Keyed by category: overall, threePointers, twoPointers, lessThan6Ft, ... */
  defended: Record<string, DefendedCategoryLine>;
  /** Keyed by opponent position (NBA notation: G, F, C, G-F, ..., or UNK). */
  matchupsByOppPosition: Record<string, MatchupPositionBucket>;
}

// ----------------------------------------------------------------- hustle

export interface HustleRow {
  personId: number;
  name: string | null;
  teamId: number | null;
  g: number | null;
  min: number | null;
  contestedShots: number | null;
  contestedShots2pt: number | null;
  contestedShots3pt: number | null;
  deflections: number | null;
  chargesDrawn: number | null;
  screenAssists: number | null;
  screenAstPts: number | null;
  offLooseBallsRecovered: number | null;
  defLooseBallsRecovered: number | null;
  looseBallsRecovered: number | null;
  offBoxouts: number | null;
  defBoxouts: number | null;
  boxOuts: number | null;
}

// ---------------------------------------------------------------- lineups

export interface LineupRow {
  personIds: number[]; // exactly five, sorted ascending
  teamId: number | null;
  gp: number | null;
  minutes: number | null;
  possessions: number | null;
  offRating: number | null;
  defRating: number | null;
  netRating: number | null;
}

// ------------------------------------------------------------------ games

export interface GameRow {
  gameId: string;
  date: string | null; // YYYY-MM-DD
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

// -------------------------------------------------------------------- pbp

export interface PbpActionRow {
  actionNumber: number;
  period: number;
  clockSeconds: number | null; // seconds remaining in the period
  teamId: number | null;
  personId: number | null;
  actionType: string | null;
  subType: string | null;
  isFieldGoal: boolean;
  shotResult: string | null; // "Made" | "Missed" for shots
  shotValue: number | null;
  shotDistance: number | null;
  x: number | null;
  y: number | null;
  scoreHome: number | null;
  scoreAway: number | null;
  /** Kept: carries assist/steal/block attribution v3 exposes nowhere else. */
  description: string | null;
}

export interface PbpGameFile extends SeasonEnvelope<PbpActionRow> {
  gameId: string;
}

// -------------------------------------------------------------- crosswalk

export interface CrosswalkRow {
  /** Full OTC player id, e.g. "player_255" or "espn_player_4873201". */
  sourceId: string;
  /** BallDontLie numeric id; null for ESPN-sourced players. */
  bdlId: number | null;
  nbaPersonId: number;
  name: string;
  matchMethod: 'name' | 'name+team' | 'name+age' | 'override';
}

export interface CrosswalkUnmatched {
  sourceId: string;
  bdlId: number | null;
  name: string;
  teamId: string | null;
  age: number | null;
}

export interface CrosswalkFile {
  schema_version: number;
  rows: CrosswalkRow[];
  unmatched: CrosswalkUnmatched[];
}

// --------------------------------------------------------------- manifest

export interface NbaDataManifest {
  schema_version: number;
  generated_at: string;
  nba_api_versions: string[];
  /** contract name -> seasons (or season/gameId for pbp) present. */
  contracts: Record<string, string[]>;
}
