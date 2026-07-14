import { Player } from '@/models/player';
import { Team } from '@/models/team';
import { StatLine, emptyStatLine } from '@/models/game';
import {
  ScheduledGame,
  TeamStanding,
  PlayerSeasonStats,
  SeasonResult,
  SeasonState,
  GameSummary,
  PlayerInjury,
  emptyStanding,
  emptyPlayoffs,
} from '@/models/season';
import { SeededRNG } from '@/lib/rng';
import { simulateGame } from './index';
import { generateSchedule } from './schedule';
import { buildCalendar, addDays, DEFAULT_SEASON_START } from './calendar';
import { rollInjuries, tickInjuries, tickRecoveries, startRecoveries, getHealthyPlayers, scheduleStressMultiplier, adjustRotation, injuryRegion } from './injury';
import { PLAYOFF_MAX_CALENDAR_DAYS } from './constants';
import { allSeasonResults, isSeasonComplete, syncPlayoffs } from './playoffs';

export interface SimulateSeasonOptions {
  seasonId?: string;
  /** Required: the caller (app/API boundary or script) owns seed selection. */
  seed: number;
  schedule?: ScheduledGame[];
}

export function simulateSeason(
  teams: Team[],
  players: Player[],
  options: SimulateSeasonOptions,
): SeasonResult {
  const seasonId = options.seasonId ?? 'season-1';
  const rng = new SeededRNG(options.seed);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) {
    if (p.teamId && playersByTeam.has(p.teamId)) {
      playersByTeam.get(p.teamId)!.push(p);
    }
  }

  const schedule = options.schedule ?? generateSchedule(teams, rng);

  const standings = new Map<string, TeamStanding>();
  for (const t of teams) standings.set(t.id, emptyStanding(t.id));

  const playerStats = new Map<string, PlayerSeasonStats>();
  for (const p of players) {
    playerStats.set(p.id, {
      playerId: p.id,
      teamId: p.teamId ?? '',
      gamesPlayed: 0,
      gamesStarted: 0,
      minutes: 0,
      totals: emptyStatLine(),
    });
  }

  let gamesPlayed = 0;

  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;

    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;

    // Deterministic per-game seed derived from the season seed + game id.
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    const sim = simulateGame(
      home, away, homePlayers, awayPlayers,
      sg.id, seasonId, `day-${sg.day}`, gameSeed,
    );

    gamesPlayed++;
    recordResult(standings, home, away, sim.result.homeScore, sim.result.awayScore);
    accumulatePlayerStats(playerStats, sim.boxScore.homeTeam.players);
    accumulatePlayerStats(playerStats, sim.boxScore.awayTeam.players);
  }

  return {
    seasonId,
    gamesPlayed,
    standings: [...standings.values()],
    playerStats: [...playerStats.values()].filter((s) => s.gamesPlayed > 0),
  };
}

export interface CreateSeasonOptions {
  seasonId?: string;
  /** Required: the caller (app/API boundary or script) owns seed selection. */
  seed: number;
  startDate?: string;
}

/** The UI's existing `rest` action stops at the regular/postseason boundary. */
export function seasonRestTarget(state: SeasonState): string {
  return state.gamesPlayed < state.totalGames
    ? state.endDate
    : (state.playoffs.endDate ?? addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS));
}

/**
 * Builds a fresh, unplayed season: a dated schedule, calendar markers, and
 * empty standings/stats. `currentDate` sits one day before tip-off so the first
 * advance plays opening night.
 */
export function createSeasonState(
  teams: Team[],
  players: Player[],
  options: CreateSeasonOptions,
): SeasonState {
  const seasonId = options.seasonId ?? 'season-1';
  const seed = options.seed;
  const startDate = options.startDate ?? DEFAULT_SEASON_START;

  const rng = new SeededRNG(seed);
  const schedule = generateSchedule(teams, rng);
  const { endDate, markers } = buildCalendar(schedule, startDate);
  schedule.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));

  return {
    seasonId,
    seed,
    startDate,
    endDate,
    currentDate: addDays(startDate, -1),
    schedule,
    markers,
    standings: teams.map((t) => emptyStanding(t.id)),
    playerStats: players.map((p) => ({
      playerId: p.id,
      teamId: p.teamId ?? '',
      gamesPlayed: 0,
      gamesStarted: 0,
      minutes: 0,
      totals: emptyStatLine(),
    })),
    playoffPlayerStats: players.map((p) => ({
      playerId: p.id,
      teamId: p.teamId ?? '',
      gamesPlayed: 0,
      gamesStarted: 0,
      minutes: 0,
      totals: emptyStatLine(),
    })),
    results: [],
    playoffs: emptyPlayoffs(),
    injuries: [],
    recoveries: [],
    injuryHistory: [],
    freeAgentPool: [],
    transactionLog: [],
    tradeExceptions: [],
    teamExceptionStates: [],
    gamesPlayed: 0,
    totalGames: schedule.length,
  };
}

/**
 * Simulates every unplayed game dated after `currentDate` and on/before
 * `targetDate`, folding results into the standings and player stats in place.
 * Returns just the games played in this advance (for the day's recap).
 *
 * Advancement is monotonic and idempotent: `currentDate` never moves backward,
 * and a game whose ID already appears in `state.results` is never re-simulated —
 * so even if persisted state is inconsistent (a stale `currentDate`, a replayed
 * request), completed games cannot be played twice.
 */
export function advanceSeason(
  state: SeasonState,
  targetDate: string,
  teams: Team[],
  players: Player[],
): GameSummary[] {
  const before = JSON.stringify(state);
  const postseasonInScope = state.gamesPlayed >= state.totalGames || targetDate > state.endDate;
  try {
    return advanceSeasonMutable(state, targetDate, teams, players);
  } catch (error) {
    // A playoff invariant is an all-or-nothing operation. Restoring by JSON
    // round-trip also preserves the byte representation callers persist.
    if (postseasonInScope) {
      const restored = JSON.parse(before) as SeasonState;
      for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
      Object.assign(state, restored);
    }
    throw error;
  }
}

function advanceSeasonMutable(
  state: SeasonState,
  targetDate: string,
  teams: Team[],
  players: Player[],
): GameSummary[] {
  const postseasonHorizon = state.playoffs.endDate ?? addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS);
  const target = targetDate > postseasonHorizon ? postseasonHorizon : targetDate;

  // Bracket construction is pure and consumes no RNG. At the regular-season
  // boundary this materializes the first postseason games before enumeration.
  syncPlayoffs(state, teams);

  // Second line of defense against replay: the set of already-recorded game IDs.
  // A game in here is never simulated again, regardless of dates.
  const completed = new Set(allSeasonResults(state).map((r) => r.id));

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) {
    if (p.teamId && playersByTeam.has(p.teamId)) playersByTeam.get(p.teamId)!.push(p);
  }

  // These maps share object identity with the state arrays, so mutating through
  // them updates the persisted standings/stats directly.
  const standings = new Map(state.standings.map((s) => [s.teamId, s]));
  const playerStats = new Map(state.playerStats.map((s) => [s.playerId, s]));
  const playoffPlayerStats = new Map(state.playoffPlayerStats.map((s) => [s.playerId, s]));

  const played: GameSummary[] = [];
  const skipped = new Set<string>();

  // One advancement loop owns both regular-season and postseason games. The
  // bracket may append the next deterministic game after a result, so select
  // the next eligible game afresh each iteration rather than snapshotting.
  while (true) {
    syncPlayoffs(state, teams);
    let sg: (typeof state.schedule)[number] | undefined;
    for (const game of [...state.schedule, ...state.playoffs.schedule]) {
      if (completed.has(game.id) || skipped.has(game.id) || game.date! <= state.currentDate || game.date! > target) continue;
      // Keep the persisted order for same-date games. In particular, do not
      // lexically re-sort regular game ids: that was a post-F2 behavior drift.
      if (!sg || game.date! < sg.date!) sg = game;
    }
    if (!sg) break;
    const date = sg.date!;
    const isPlayoff = sg.id.startsWith('PO-');

    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) {
      if (isPlayoff) throw new Error(`playoff invariant: scheduled game ${sg.id} references an unknown team`);
      skipped.add(sg.id);
      continue;
    }
    const homeAllPlayers = playersByTeam.get(home.id) ?? [];
    const awayAllPlayers = playersByTeam.get(away.id) ?? [];
    if (homeAllPlayers.length < 5 || awayAllPlayers.length < 5) {
      if (isPlayoff) throw new Error(`playoff invariant: scheduled game ${sg.id} cannot field five players per team`);
      skipped.add(sg.id);
      continue;
    }

    // 1. Tick down existing injuries for both teams (one game each). A player
    //    whose counter hits 0 now clears before the new-injury roll below, so
    //    they're healthy for today and eligible for a fresh injury.
    const homeActiveBefore = state.injuries.filter((i) => i.teamId === home.id);
    const awayActiveBefore = state.injuries.filter((i) => i.teamId === away.id);
    state.injuries = tickInjuries(state.injuries, home.id);
    state.injuries = tickInjuries(state.injuries, away.id);

    // Injuries that just healed → open a post-recovery vulnerability window. Age
    // the existing windows by one game first, then add the new ones at full length
    // so a returning player is at elevated risk starting from this game.
    const homeStillOut = new Set(state.injuries.filter((i) => i.teamId === home.id).map((i) => i.playerId));
    const awayStillOut = new Set(state.injuries.filter((i) => i.teamId === away.id).map((i) => i.playerId));
    const expired = [
      ...homeActiveBefore.filter((i) => !homeStillOut.has(i.playerId)),
      ...awayActiveBefore.filter((i) => !awayStillOut.has(i.playerId)),
    ];
    state.recoveries = tickRecoveries(state.recoveries, home.id);
    state.recoveries = tickRecoveries(state.recoveries, away.id);
    state.recoveries = [...state.recoveries, ...startRecoveries(expired)];

    // 2. Roll new injuries on a separate RNG stream so injury outcomes are
    //    reproducible but independent of the game RNG.
    const injuryRng = new SeededRNG(deterministicSeed(state.seed, 'inj_' + sg.id));

    // Schedule-stress multiplier folds in the back-to-back and dense-stretch risk.
    const priorResults = allSeasonResults(state);
    const homeMult = scheduleStressMultiplier(home.id, date, priorResults);
    const awayMult = scheduleStressMultiplier(away.id, date, priorResults);

    const homeRoll = rollInjuries(homeAllPlayers, state.injuries, date, homeMult, state.seed, home.rotation.minuteTargets, state.recoveries, injuryRng);
    const awayRoll = rollInjuries(awayAllPlayers, state.injuries, date, awayMult, state.seed, away.rotation.minuteTargets, state.recoveries, injuryRng);

    // A player who (re-)injures is no longer just "recovering" — close their
    // vulnerability window; a fresh one opens when this new injury heals.
    const reinjured = new Set(
      [...homeRoll.preGame, ...awayRoll.preGame, ...homeRoll.inGame, ...awayRoll.inGame]
        .map((x) => ('injury' in x ? x.injury.playerId : x.playerId)),
    );
    if (reinjured.size > 0) state.recoveries = state.recoveries.filter((r) => !reinjured.has(r.playerId));

    // Pre-game injuries (illness, soreness) take effect now — the player sits the
    // whole game. In-game injuries take effect after the game (handled below).
    state.injuries = [...state.injuries, ...homeRoll.preGame, ...awayRoll.preGame];

    // 3. Build the available rosters (injured players sit out).
    const homePlayers = getHealthyPlayers(homeAllPlayers, state.injuries);
    const awayPlayers = getHealthyPlayers(awayAllPlayers, state.injuries);
    if (homePlayers.length < 5 || awayPlayers.length < 5) {
      if (isPlayoff) throw new Error(`playoff invariant: scheduled game ${sg.id} cannot field five healthy players per team`);
      skipped.add(sg.id);
      continue;
    }

    // 4. Adjust each rotation so injured starters are actually benched — the
    //    starting five comes from team.rotation.starters, not the players array.
    const homeForGame = { ...home, rotation: adjustRotation(home.rotation, new Set(homePlayers.map((p) => p.id))) };
    const awayForGame = { ...away, rotation: adjustRotation(away.rotation, new Set(awayPlayers.map((p) => p.id))) };

    // 5. In-game injuries: the player takes the floor and is pulled mid-game at
    //    their drawn exit time, then is out starting next game.
    const inGameExits = new Map<string, number>();
    for (const e of [...homeRoll.inGame, ...awayRoll.inGame]) inGameExits.set(e.injury.playerId, e.exitSeconds);

    const sim = simulateGame(
      homeForGame, awayForGame, homePlayers, awayPlayers,
      sg.id, state.seasonId, date, deterministicSeed(state.seed, sg.id), inGameExits,
    );

    // The in-game injuries are now active for subsequent games.
    state.injuries = [
      ...state.injuries,
      ...homeRoll.inGame.map((e) => e.injury),
      ...awayRoll.inGame.map((e) => e.injury),
    ];

    // Append immutable onset evidence only after the game result exists. The
    // missed-game count is derived later from this unified result ledger.
    state.injuryHistory.push(
      ...[...homeRoll.preGame, ...awayRoll.preGame].map((injury) => ({
        id: `${injury.playerId}|${injury.startDate}`, season: state.seasonId, playerId: injury.playerId,
        teamId: injury.teamId, injuryType: injury.injuryType, region: injuryRegion(injury.injuryType),
        severity: injury.severity, startDate: injury.startDate, onsetGameId: sg.id, playedOnset: false,
        maxGamesMissed: injury.gamesRemaining,
      })),
      ...[...homeRoll.inGame, ...awayRoll.inGame].map((event) => ({
        id: `${event.injury.playerId}|${event.injury.startDate}`, season: state.seasonId, playerId: event.injury.playerId,
        teamId: event.injury.teamId, injuryType: event.injury.injuryType, region: injuryRegion(event.injury.injuryType),
        severity: event.injury.severity, startDate: event.injury.startDate, onsetGameId: sg.id, playedOnset: true,
        // The onset game was played. `tickInjuries` runs before the next team
        // game, so one remaining game clears without a missed appearance.
        maxGamesMissed: Math.max(0, event.injury.gamesRemaining - 1),
      })),
    );

    if (!isPlayoff) {
      recordResult(standings, home, away, sim.result.homeScore, sim.result.awayScore);
      accumulatePlayerStats(playerStats, sim.boxScore.homeTeam.players);
      accumulatePlayerStats(playerStats, sim.boxScore.awayTeam.players);
    } else {
      accumulatePlayerStats(playoffPlayerStats, sim.boxScore.homeTeam.players);
      accumulatePlayerStats(playoffPlayerStats, sim.boxScore.awayTeam.players);
    }

    const summary: GameSummary = {
      id: sg.id,
      date,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeScore: sim.result.homeScore,
      awayScore: sim.result.awayScore,
      overtimePeriods: sim.result.overtimePeriods,
      winnerId: sim.result.winnerId,
    };
    // Record into state.results immediately (not just at end of call) so the
    // schedule-stress multiplier sees games played earlier in this same advance —
    // otherwise back-to-back/dense-stretch risk would depend on how far the user
    // advances at once, breaking injury determinism.
    state.results.push(summary);
    if (!isPlayoff) {
      // The last regular result is the exact boundary where postseason state
      // becomes eligible; no standings or regular stats move after this point.
      state.gamesPlayed++;
      syncPlayoffs(state, teams);
    }
    syncPlayoffs(state, teams);
    completed.add(sg.id);
    played.push(summary);
  }

  // Monotonic: only ever move the clock forward. A backward target leaves the
  // season date (and everything else) untouched.
  const cursor = isSeasonComplete(state)
    ? (played.length > 0 ? played[played.length - 1].date : state.currentDate)
    : target;
  if (cursor > state.currentDate) state.currentDate = cursor;
  return played;
}

/** Stable per-game seed so re-runs are reproducible. */
function deterministicSeed(base: number, id: string): number {
  let h = base >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (h % 2_000_000_000) + 1;
}

function recordResult(
  standings: Map<string, TeamStanding>,
  home: Team,
  away: Team,
  homeScore: number,
  awayScore: number,
): void {
  const hs = standings.get(home.id)!;
  const as = standings.get(away.id)!;
  const homeWon = homeScore > awayScore;

  hs.pointsFor += homeScore;
  hs.pointsAgainst += awayScore;
  as.pointsFor += awayScore;
  as.pointsAgainst += homeScore;

  const sameConf = home.conference === away.conference;
  const sameDiv = sameConf && home.division === away.division;

  if (homeWon) {
    hs.wins++; hs.homeWins++;
    as.losses++; as.awayLosses++;
    if (sameConf) { hs.confWins++; as.confLosses++; }
    if (sameDiv) { hs.divWins++; as.divLosses++; }
    updateStreak(hs, true);
    updateStreak(as, false);
  } else {
    as.wins++; as.awayWins++;
    hs.losses++; hs.homeLosses++;
    if (sameConf) { as.confWins++; hs.confLosses++; }
    if (sameDiv) { as.divWins++; hs.divLosses++; }
    updateStreak(as, true);
    updateStreak(hs, false);
  }
}

function updateStreak(s: TeamStanding, won: boolean): void {
  if (won) s.streak = s.streak >= 0 ? s.streak + 1 : 1;
  else s.streak = s.streak <= 0 ? s.streak - 1 : -1;
  s.lastTen.push(won ? 'W' : 'L');
  if (s.lastTen.length > 10) s.lastTen.shift();
}

function accumulatePlayerStats(
  playerStats: Map<string, PlayerSeasonStats>,
  lines: { playerId: string; starter: boolean; minutes: number; stats: StatLine }[],
): void {
  for (const line of lines) {
    if (line.minutes <= 0 && line.stats.points === 0 && line.stats.fieldGoalsAttempted === 0) {
      continue; // did not actually play
    }
    const agg = playerStats.get(line.playerId);
    if (!agg) continue;
    agg.gamesPlayed++;
    if (line.starter) agg.gamesStarted++;
    agg.minutes += line.minutes;
    addStatLine(agg.totals, line.stats);
  }
}

function addStatLine(target: StatLine, src: StatLine): void {
  target.points += src.points;
  target.fieldGoalsMade += src.fieldGoalsMade;
  target.fieldGoalsAttempted += src.fieldGoalsAttempted;
  target.threePointersMade += src.threePointersMade;
  target.threePointersAttempted += src.threePointersAttempted;
  target.freeThrowsMade += src.freeThrowsMade;
  target.freeThrowsAttempted += src.freeThrowsAttempted;
  target.offensiveRebounds += src.offensiveRebounds;
  target.defensiveRebounds += src.defensiveRebounds;
  target.rebounds += src.rebounds;
  target.assists += src.assists;
  target.steals += src.steals;
  target.blocks += src.blocks;
  target.turnovers += src.turnovers;
  target.personalFouls += src.personalFouls;
  target.plusMinus += src.plusMinus;
}
