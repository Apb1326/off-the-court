import { Team } from '@/models/team';
import {
  GameSummary,
  PlayoffConference,
  PlayoffRound,
  PlayoffSeries,
  PlayoffSeed,
  SeasonState,
  TeamStanding,
} from '@/models/season';
import { addDays, daysBetween } from './calendar';
import {
  PLAY_IN_ENABLED,
  PLAY_IN_WINS_REQUIRED,
  PLAYOFF_GAME_INTERVAL_DAYS,
  PLAYOFF_HOME_COURT_PATTERN,
  PLAYOFF_MAX_CALENDAR_DAYS,
  PLAYOFF_ROUND_REST_DAYS,
  PLAYOFF_SERIES_WINS_REQUIRED,
  PLAYOFF_START_REST_DAYS,
} from './constants';

const CONFERENCES: readonly PlayoffConference[] = ['East', 'West'];

function pct(wins: number, losses: number): number {
  return wins / Math.max(1, wins + losses);
}

function pointDifferential(s: TeamStanding): number {
  return s.pointsFor - s.pointsAgainst;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic simplified NBA tiebreaker.
 *
 * Equal-record teams are ranked as one tie group, which keeps the comparison
 * transitive for three-team ties: head-to-head mini-league percentage, division
 * leader, conference percentage, point differential, then stable team id.
 */
export function rankConference(
  conference: PlayoffConference,
  standings: TeamStanding[],
  results: GameSummary[],
  teams: Team[],
): TeamStanding[] {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const eligible = standings.filter((s) => teamById.get(s.teamId)?.conference === conference);

  const divisionLeaders = new Set<string>();
  const divisions = new Map<string, TeamStanding[]>();
  for (const standing of eligible) {
    const division = teamById.get(standing.teamId)!.division;
    const group = divisions.get(division) ?? [];
    group.push(standing);
    divisions.set(division, group);
  }
  for (const group of divisions.values()) {
    const bestRecord = Math.max(...group.map((standing) => pct(standing.wins, standing.losses)));
    const tied = group.filter((standing) => pct(standing.wins, standing.losses) === bestRecord);
    const tiedIds = new Set(tied.map((standing) => standing.teamId));
    const h2h = new Map(tied.map((standing) => [standing.teamId, { wins: 0, losses: 0 }]));
    for (const game of results) {
      if (!tiedIds.has(game.homeTeamId) || !tiedIds.has(game.awayTeamId)) continue;
      const loserId = game.winnerId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
      h2h.get(game.winnerId)!.wins++;
      h2h.get(loserId)!.losses++;
    }
    tied.sort((a, b) => {
      const ah = h2h.get(a.teamId)!;
      const bh = h2h.get(b.teamId)!;
      return pct(bh.wins, bh.losses) - pct(ah.wins, ah.losses) ||
        pct(b.confWins, b.confLosses) - pct(a.confWins, a.confLosses) ||
        pointDifferential(b) - pointDifferential(a) ||
        compareIds(a.teamId, b.teamId);
    });
    if (tied[0]) divisionLeaders.add(tied[0].teamId);
  }

  const byRecord = [...eligible].sort((a, b) =>
    pct(b.wins, b.losses) - pct(a.wins, a.losses) || compareIds(a.teamId, b.teamId));
  const ranked: TeamStanding[] = [];

  for (let i = 0; i < byRecord.length;) {
    const record = pct(byRecord[i].wins, byRecord[i].losses);
    let end = i + 1;
    while (end < byRecord.length && pct(byRecord[end].wins, byRecord[end].losses) === record) end++;
    const tied = byRecord.slice(i, end);
    const tiedIds = new Set(tied.map((s) => s.teamId));
    const headToHead = new Map<string, { wins: number; losses: number }>(
      tied.map((s) => [s.teamId, { wins: 0, losses: 0 }]),
    );
    for (const game of results) {
      if (!tiedIds.has(game.homeTeamId) || !tiedIds.has(game.awayTeamId)) continue;
      const winner = headToHead.get(game.winnerId)!;
      const loserId = game.winnerId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
      winner.wins++;
      headToHead.get(loserId)!.losses++;
    }
    tied.sort((a, b) => {
      const ah = headToHead.get(a.teamId)!;
      const bh = headToHead.get(b.teamId)!;
      return pct(bh.wins, bh.losses) - pct(ah.wins, ah.losses) ||
        Number(divisionLeaders.has(b.teamId)) - Number(divisionLeaders.has(a.teamId)) ||
        pct(b.confWins, b.confLosses) - pct(a.confWins, a.confLosses) ||
        pointDifferential(b) - pointDifferential(a) ||
        compareIds(a.teamId, b.teamId);
    });
    ranked.push(...tied);
    i = end;
  }
  return ranked;
}

function seriesId(
  conference: PlayoffConference | null,
  round: PlayoffRound,
  position: string,
): string {
  const conf = conference ? conference[0] : 'F';
  const roundCode: Record<PlayoffRound, string> = {
    play_in: 'PI',
    first_round: 'R1',
    conference_semifinals: 'R2',
    conference_finals: 'CF',
    finals: 'F',
  };
  return round === 'finals' ? 'PO-F' : `PO-${conf}-${roundCode[round]}-${position}`;
}

function makeSeries(args: {
  conference: PlayoffConference | null;
  round: PlayoffRound;
  position: string;
  teamAId: string;
  teamBId: string;
  teamASeed: number;
  teamBSeed: number;
  homeCourtTeamId: string;
  startDate: string;
  winsRequired?: number;
}): PlayoffSeries {
  return {
    id: seriesId(args.conference, args.round, args.position),
    round: args.round,
    conference: args.conference,
    bracketPosition: args.position,
    teamAId: args.teamAId,
    teamBId: args.teamBId,
    teamASeed: args.teamASeed,
    teamBSeed: args.teamBSeed,
    homeCourtTeamId: args.homeCourtTeamId,
    teamAWins: 0,
    teamBWins: 0,
    winsRequired: args.winsRequired ?? PLAYOFF_SERIES_WINS_REQUIRED,
    startDate: args.startDate,
    gameIds: [],
    winnerTeamId: null,
  };
}

function loser(series: PlayoffSeries): string {
  if (!series.winnerTeamId) throw new Error(`series ${series.id} has no winner`);
  return series.winnerTeamId === series.teamAId ? series.teamBId : series.teamAId;
}

function seedFor(state: SeasonState, teamId: string): number {
  return state.playoffs.seeds.find((seed) => seed.teamId === teamId)?.seed ?? 99;
}

function latestResultDate(state: SeasonState, series: PlayoffSeries[]): string {
  const ids = new Set(series.flatMap((s) => s.gameIds));
  return state.playoffs.results
    .filter((result) => ids.has(result.id))
    .reduce((latest, result) => result.date > latest ? result.date : latest, state.endDate);
}

function addConferenceFirstRound(state: SeasonState, conference: PlayoffConference, startDate: string): void {
  if (state.playoffs.series.some((s) => s.conference === conference && s.round === 'first_round')) return;
  const seeds = new Map(
    state.playoffs.seeds.filter((s) => s.conference === conference).map((s) => [s.seed, s.teamId]),
  );
  const matchups: readonly [string, number, number][] = [
    ['S1', 1, 8], ['S2', 4, 5], ['S3', 3, 6], ['S4', 2, 7],
  ];
  for (const [position, highSeed, lowSeed] of matchups) {
    const high = seeds.get(highSeed);
    const low = seeds.get(lowSeed);
    if (!high || !low) throw new Error(`${conference} playoff seed ${highSeed}/${lowSeed} missing`);
    state.playoffs.series.push(makeSeries({
      conference,
      round: 'first_round',
      position,
      teamAId: high,
      teamBId: low,
      teamASeed: highSeed,
      teamBSeed: lowSeed,
      homeCourtTeamId: high,
      startDate,
    }));
  }
}

function initializePlayoffs(state: SeasonState, teams: Team[]): void {
  if (state.playoffs.status !== 'pending' || state.gamesPlayed < state.totalGames) return;
  const startDate = addDays(state.endDate, PLAYOFF_START_REST_DAYS);
  const pendingInjuryHistory = state.playoffs.pendingInjuryHistory;
  state.playoffs = {
    status: 'in_progress',
    playInEnabled: PLAY_IN_ENABLED,
    startDate,
    endDate: addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS),
    seeds: [],
    series: [],
    schedule: [],
    results: [],
    pendingInjuryHistory,
    championTeamId: null,
  };

  for (const conference of CONFERENCES) {
    const ranked = rankConference(conference, state.standings, state.results, teams);
    state.playoffs.seeds.push(...ranked.slice(0, PLAY_IN_ENABLED ? 10 : 8).map((standing, index) => ({
      conference,
      seed: index + 1,
      teamId: standing.teamId,
    } satisfies PlayoffSeed)));
    if (!PLAY_IN_ENABLED) {
      addConferenceFirstRound(state, conference, startDate);
      continue;
    }
    const bySeed = new Map(
      state.playoffs.seeds.filter((s) => s.conference === conference).map((s) => [s.seed, s.teamId]),
    );
    for (const [position, a, b] of [['78', 7, 8], ['910', 9, 10]] as const) {
      state.playoffs.series.push(makeSeries({
        conference,
        round: 'play_in',
        position,
        teamAId: bySeed.get(a)!,
        teamBId: bySeed.get(b)!,
        teamASeed: a,
        teamBSeed: b,
        homeCourtTeamId: bySeed.get(a)!,
        startDate,
        winsRequired: PLAY_IN_WINS_REQUIRED,
      }));
    }
  }
}

function advanceBracket(state: SeasonState): void {
  for (const conference of CONFERENCES) {
    const confSeries = state.playoffs.series.filter((s) => s.conference === conference);
    if (state.playoffs.playInEnabled) {
      const s78 = confSeries.find((s) => s.round === 'play_in' && s.bracketPosition === '78');
      const s910 = confSeries.find((s) => s.round === 'play_in' && s.bracketPosition === '910');
      let final = confSeries.find((s) => s.round === 'play_in' && s.bracketPosition === '8');
      if (s78?.winnerTeamId && s910?.winnerTeamId && !final) {
        const teamA = loser(s78);
        const teamB = s910.winnerTeamId;
        final = makeSeries({
          conference,
          round: 'play_in',
          position: '8',
          teamAId: teamA,
          teamBId: teamB,
          teamASeed: seedFor(state, teamA),
          teamBSeed: seedFor(state, teamB),
          homeCourtTeamId: teamA,
          startDate: addDays(latestResultDate(state, [s78, s910]), PLAYOFF_GAME_INTERVAL_DAYS),
          winsRequired: PLAY_IN_WINS_REQUIRED,
        });
        state.playoffs.series.push(final);
      }
      if (s78?.winnerTeamId && final?.winnerTeamId) {
        state.playoffs.seeds = state.playoffs.seeds
          .filter((seed) => seed.conference !== conference || seed.seed <= 8)
          .map((seed) => seed.conference !== conference ? seed :
            seed.seed === 7 ? { ...seed, teamId: s78.winnerTeamId! } :
            seed.seed === 8 ? { ...seed, teamId: final.winnerTeamId! } : seed);
        addConferenceFirstRound(
          state,
          conference,
          addDays(latestResultDate(state, [final]), PLAYOFF_ROUND_REST_DAYS),
        );
      }
    }

    const first = state.playoffs.series.filter((s) => s.conference === conference && s.round === 'first_round');
    if (first.length === 4 && first.every((s) => s.winnerTeamId)) {
      const existing = state.playoffs.series.some((s) => s.conference === conference && s.round === 'conference_semifinals');
      if (!existing) {
        const pairs: readonly [string, string, string][] = [['S1', 'S1', 'S2'], ['S2', 'S3', 'S4']];
        const startDate = addDays(latestResultDate(state, first), PLAYOFF_ROUND_REST_DAYS);
        for (const [position, aPos, bPos] of pairs) {
          const a = first.find((s) => s.bracketPosition === aPos)!.winnerTeamId!;
          const b = first.find((s) => s.bracketPosition === bPos)!.winnerTeamId!;
          const aSeed = seedFor(state, a);
          const bSeed = seedFor(state, b);
          const home = aSeed < bSeed ? a : b;
          state.playoffs.series.push(makeSeries({ conference, round: 'conference_semifinals', position,
            teamAId: a, teamBId: b, teamASeed: aSeed, teamBSeed: bSeed, homeCourtTeamId: home, startDate }));
        }
      }
    }

    const semis = state.playoffs.series.filter((s) => s.conference === conference && s.round === 'conference_semifinals');
    if (semis.length === 2 && semis.every((s) => s.winnerTeamId)) {
      const existing = state.playoffs.series.some((s) => s.conference === conference && s.round === 'conference_finals');
      if (!existing) {
        const a = semis.find((s) => s.bracketPosition === 'S1')!.winnerTeamId!;
        const b = semis.find((s) => s.bracketPosition === 'S2')!.winnerTeamId!;
        const aSeed = seedFor(state, a);
        const bSeed = seedFor(state, b);
        state.playoffs.series.push(makeSeries({ conference, round: 'conference_finals', position: 'S1',
          teamAId: a, teamBId: b, teamASeed: aSeed, teamBSeed: bSeed,
          homeCourtTeamId: aSeed < bSeed ? a : b,
          startDate: addDays(latestResultDate(state, semis), PLAYOFF_ROUND_REST_DAYS) }));
      }
    }
  }

  const conferenceFinals = state.playoffs.series.filter((s) => s.round === 'conference_finals');
  if (conferenceFinals.length === 2 && conferenceFinals.every((s) => s.winnerTeamId) &&
      !state.playoffs.series.some((s) => s.round === 'finals')) {
    const east = conferenceFinals.find((s) => s.conference === 'East')!.winnerTeamId!;
    const west = conferenceFinals.find((s) => s.conference === 'West')!.winnerTeamId!;
    const standing = new Map(state.standings.map((s) => [s.teamId, s]));
    const es = standing.get(east)!;
    const ws = standing.get(west)!;
    const finalsHeadToHead = state.results.filter((game) =>
      (game.homeTeamId === east && game.awayTeamId === west) ||
      (game.homeTeamId === west && game.awayTeamId === east));
    const eastH2hWins = finalsHeadToHead.filter((game) => game.winnerId === east).length;
    const westH2hWins = finalsHeadToHead.length - eastH2hWins;
    const eastBetter = pct(es.wins, es.losses) > pct(ws.wins, ws.losses) ||
      (pct(es.wins, es.losses) === pct(ws.wins, ws.losses) &&
        (eastH2hWins > westH2hWins ||
          (eastH2hWins === westH2hWins &&
            (pointDifferential(es) > pointDifferential(ws) ||
              (pointDifferential(es) === pointDifferential(ws) && east < west)))));
    state.playoffs.series.push(makeSeries({
      conference: null,
      round: 'finals',
      position: 'S1',
      teamAId: east,
      teamBId: west,
      teamASeed: seedFor(state, east),
      teamBSeed: seedFor(state, west),
      homeCourtTeamId: eastBetter ? east : west,
      startDate: addDays(latestResultDate(state, conferenceFinals), PLAYOFF_ROUND_REST_DAYS),
    }));
  }

  const finals = state.playoffs.series.find((s) => s.round === 'finals');
  if (finals?.winnerTeamId) {
    state.playoffs.status = 'complete';
    state.playoffs.championTeamId = finals.winnerTeamId;
  }
}

function scheduleNextGames(state: SeasonState): void {
  const completed = new Set(state.playoffs.results.map((result) => result.id));
  for (const series of state.playoffs.series) {
    if (series.winnerTeamId) continue;
    const outstanding = state.playoffs.schedule.some((game) =>
      game.id.startsWith(`${series.id}-G`) && !completed.has(game.id));
    if (outstanding) continue;
    const gameNumber = series.gameIds.length + 1;
    const id = `${series.id}-G${gameNumber}`;
    const higherHome = series.winsRequired === 1 || PLAYOFF_HOME_COURT_PATTERN[gameNumber - 1] === 'higher';
    const homeTeamId = higherHome
      ? series.homeCourtTeamId
      : series.homeCourtTeamId === series.teamAId ? series.teamBId : series.teamAId;
    const awayTeamId = homeTeamId === series.teamAId ? series.teamBId : series.teamAId;
    const previous = series.gameIds.length
      ? state.playoffs.results.find((result) => result.id === series.gameIds[series.gameIds.length - 1])
      : null;
    const date = previous ? addDays(previous.date, PLAYOFF_GAME_INTERVAL_DAYS) : series.startDate;
    state.playoffs.schedule.push({
      id,
      homeTeamId,
      awayTeamId,
      day: daysBetween(state.startDate, date),
      date,
    });
  }
  state.playoffs.schedule.sort((a, b) => a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : compareIds(a.id, b.id));
}

/** Pure bracket construction plus deterministic schedule materialization; no RNG. */
export function syncPlayoffs(state: SeasonState, teams: Team[]): void {
  if (state.playoffs.status === 'complete' || state.playoffs.status === 'grandfathered_complete') return;
  initializePlayoffs(state, teams);
  if (state.playoffs.status !== 'in_progress') return;
  advanceBracket(state);
  if (state.playoffs.status === 'in_progress') scheduleNextGames(state);
}

export function recordPlayoffResult(state: SeasonState, summary: GameSummary): void {
  const series = state.playoffs.series.find((candidate) => summary.id.startsWith(`${candidate.id}-G`));
  if (!series) throw new Error(`playoff game ${summary.id} has no bracket series`);
  if (series.gameIds.includes(summary.id)) return;
  series.gameIds.push(summary.id);
  if (summary.winnerId === series.teamAId) series.teamAWins++;
  else if (summary.winnerId === series.teamBId) series.teamBWins++;
  else throw new Error(`playoff game ${summary.id} winner is outside its series`);
  if (series.teamAWins >= series.winsRequired) series.winnerTeamId = series.teamAId;
  if (series.teamBWins >= series.winsRequired) series.winnerTeamId = series.teamBId;
}

export function allSeasonResults(state: SeasonState): GameSummary[] {
  return [...state.results, ...state.playoffs.results];
}

export function nextSeasonGameDate(state: SeasonState): string | null {
  const completed = new Set(allSeasonResults(state).map((result) => result.id));
  let next: string | null = null;
  for (const game of [...state.schedule, ...state.playoffs.schedule]) {
    if (completed.has(game.id) || game.date! <= state.currentDate) continue;
    if (next === null || game.date! < next) next = game.date!;
  }
  return next;
}

export function isSeasonComplete(state: SeasonState): boolean {
  return state.playoffs.status === 'complete' || state.playoffs.status === 'grandfathered_complete';
}

export function isTeamEliminated(state: SeasonState, teamId: string): boolean {
  if (state.playoffs.status === 'complete') return teamId !== state.playoffs.championTeamId;
  if (state.playoffs.status === 'in_progress' &&
      !state.playoffs.seeds.some((seed) => seed.teamId === teamId)) return true;
  for (const series of state.playoffs.series) {
    if (!series.winnerTeamId || (series.teamAId !== teamId && series.teamBId !== teamId)) continue;
    if (series.winnerTeamId === teamId) continue;
    // The 7/8 loser gets a second play-in game for seed 8.
    if (series.round === 'play_in' && series.bracketPosition === '78') continue;
    return true;
  }
  return false;
}
