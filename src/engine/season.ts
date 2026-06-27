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
  InjuryHistoryEntry,
  emptyStanding,
} from '@/models/season';
import { SeededRNG } from '@/lib/rng';
import { simulateGame } from './index';
import { generateSchedule } from './schedule';
import { buildCalendar, addDays, DEFAULT_SEASON_START } from './calendar';
import { rollInjuries, tickInjuries, tickRecoveries, startRecoveries, getHealthyPlayers, scheduleStressMultiplier, adjustRotation, injuryRegion } from './injury';

export interface SimulateSeasonOptions {
  seasonId?: string;
  seed?: number;
  schedule?: ScheduledGame[];
}

export function simulateSeason(
  teams: Team[],
  players: Player[],
  options: SimulateSeasonOptions = {},
): SeasonResult {
  const seasonId = options.seasonId ?? 'season-1';
  const rng = new SeededRNG(options.seed ?? Date.now());

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
  seed?: number;
  startDate?: string;
}

/**
 * Builds a fresh, unplayed season: a dated schedule, calendar markers, and
 * empty standings/stats. `currentDate` sits one day before tip-off so the first
 * advance plays opening night.
 */
export function createSeasonState(
  teams: Team[],
  players: Player[],
  options: CreateSeasonOptions = {},
): SeasonState {
  const seasonId = options.seasonId ?? 'season-1';
  const seed = options.seed ?? Math.floor(Math.random() * 2_000_000_000);
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
    results: [],
    injuries: [],
    recoveries: [],
    injuryHistory: [],
    freeAgentPool: [],
    transactionLog: [],
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
  const target = targetDate > state.endDate ? state.endDate : targetDate;

  // Second line of defense against replay: the set of already-recorded game IDs.
  // A game in here is never simulated again, regardless of dates.
  const completed = new Set(state.results.map((r) => r.id));

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

  // Every team's scheduled game dates, for finalizing games-missed on each injury.
  const teamDates = new Map<string, string[]>();
  for (const sg of state.schedule) {
    for (const tid of [sg.homeTeamId, sg.awayTeamId]) {
      const arr = teamDates.get(tid);
      if (arr) arr.push(sg.date!);
      else teamDates.set(tid, [sg.date!]);
    }
  }

  // Finalized games an injury keeps a player out: their team's games during the
  // recovery window (from the injury date), capped by the projected recovery. An
  // in-game injury is logged after the player has played the onset game, so it
  // counts only games strictly after the start date.
  const historyEntry = (inj: PlayerInjury, playedOnset: boolean): InjuryHistoryEntry => {
    const dates = teamDates.get(inj.teamId) ?? [];
    const window = dates.filter((d) => (playedOnset ? d > inj.startDate : d >= inj.startDate)).length;
    return {
      id: `${inj.playerId}|${inj.startDate}`,
      season: state.seasonId,
      playerId: inj.playerId,
      teamId: inj.teamId,
      injuryType: inj.injuryType,
      region: injuryRegion(inj.injuryType),
      severity: inj.severity,
      startDate: inj.startDate,
      gamesMissed: Math.min(inj.gamesRemaining, window),
    };
  };

  const played: GameSummary[] = [];

  for (const sg of state.schedule) {
    const date = sg.date!;
    if (date <= state.currentDate || date > target) continue;
    // Idempotency: never replay a game we've already recorded, even if the date
    // window above would otherwise admit it (e.g. a rewound currentDate).
    if (completed.has(sg.id)) continue;

    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;

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
    const homeAllPlayers = playersByTeam.get(home.id) ?? [];
    const awayAllPlayers = playersByTeam.get(away.id) ?? [];

    // Schedule-stress multiplier folds in the back-to-back and dense-stretch risk.
    const homeMult = scheduleStressMultiplier(home.id, date, state.results);
    const awayMult = scheduleStressMultiplier(away.id, date, state.results);

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
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;

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

    // Log every injury from this game to the season's append-only history.
    for (const inj of [...homeRoll.preGame, ...awayRoll.preGame]) state.injuryHistory.push(historyEntry(inj, false));
    for (const e of [...homeRoll.inGame, ...awayRoll.inGame]) state.injuryHistory.push(historyEntry(e.injury, true));

    recordResult(standings, home, away, sim.result.homeScore, sim.result.awayScore);
    accumulatePlayerStats(playerStats, sim.boxScore.homeTeam.players);
    accumulatePlayerStats(playerStats, sim.boxScore.awayTeam.players);

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
    completed.add(sg.id);
    played.push(summary);
  }

  state.gamesPlayed += played.length;
  // Monotonic: only ever move the clock forward. A backward target leaves the
  // season date (and everything else) untouched.
  if (target > state.currentDate) state.currentDate = target;
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
