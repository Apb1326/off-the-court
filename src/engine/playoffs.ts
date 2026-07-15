import { Team } from '@/models/team';
import {
  DerivedPlayoffSeries,
  GameSummary,
  PlayoffConference,
  PlayoffRound,
  PlayoffSeries,
  PlayoffSeed,
  PlayoffStatus,
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

type HeadToHead = Map<string, { wins: number; losses: number }>;
type TiebreakClause = (a: TeamStanding, b: TeamStanding) => number;

function buildH2h(tied: TeamStanding[], results: GameSummary[]): HeadToHead {
  const ids = new Set(tied.map((standing) => standing.teamId));
  const h2h: HeadToHead = new Map(tied.map((standing) => [standing.teamId, { wins: 0, losses: 0 }]));
  for (const game of results) {
    if (!ids.has(game.homeTeamId) || !ids.has(game.awayTeamId)) continue;
    const loser = game.winnerId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    h2h.get(game.winnerId)!.wins++;
    h2h.get(loser)!.losses++;
  }
  return h2h;
}

function tiebreakComparator(h2h: HeadToHead, extra?: TiebreakClause): TiebreakClause {
  return (a, b) => {
    const ah = h2h.get(a.teamId)!;
    const bh = h2h.get(b.teamId)!;
    return pct(bh.wins, bh.losses) - pct(ah.wins, ah.losses) ||
      (extra?.(a, b) ?? 0) ||
      pct(b.confWins, b.confLosses) - pct(a.confWins, a.confLosses) ||
      pointDifferential(b) - pointDifferential(a) || compareIds(a.teamId, b.teamId);
  };
}

/** Deterministic simplified NBA tiebreaker. */
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
    tied.sort(tiebreakComparator(buildH2h(tied, results)));
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
    tied.sort(tiebreakComparator(
      buildH2h(tied, results),
      (a, b) => Number(divisionLeaders.has(b.teamId)) - Number(divisionLeaders.has(a.teamId)),
    ));
    ranked.push(...tied);
    i = end;
  }
  return ranked;
}

function seriesId(conference: PlayoffConference | null, round: PlayoffRound, position: string): string {
  const conf = conference ? conference[0] : 'F';
  const code: Record<PlayoffRound, string> = {
    play_in: 'PI', first_round: 'R1', conference_semifinals: 'R2', conference_finals: 'CF', finals: 'F',
  };
  return round === 'finals' ? 'PO-F' : `PO-${conf}-${code[round]}-${position}`;
}

function makeSeries(args: {
  conference: PlayoffConference | null; round: PlayoffRound; position: string;
  teamAId: string; teamBId: string; teamASeed: number; teamBSeed: number;
  homeCourtTeamId: string; startDate: string; winsRequired?: number;
}): PlayoffSeries {
  return {
    id: seriesId(args.conference, args.round, args.position), round: args.round,
    conference: args.conference, bracketPosition: args.position, teamAId: args.teamAId,
    teamBId: args.teamBId, teamASeed: args.teamASeed, teamBSeed: args.teamBSeed,
    homeCourtTeamId: args.homeCourtTeamId, winsRequired: args.winsRequired ?? PLAYOFF_SERIES_WINS_REQUIRED,
    startDate: args.startDate,
  };
}

function seedFor(state: SeasonState, teamId: string): number {
  return state.playoffs.seeds.find((seed) => seed.teamId === teamId)?.seed ?? 99;
}

function expectedGame(series: PlayoffSeries, number: number, previous: GameSummary | undefined) {
  const higherHome = series.winsRequired === 1 || PLAYOFF_HOME_COURT_PATTERN[number - 1] === 'higher';
  const homeTeamId = higherHome ? series.homeCourtTeamId :
    (series.homeCourtTeamId === series.teamAId ? series.teamBId : series.teamAId);
  return {
    id: `${series.id}-G${number}`,
    homeTeamId,
    awayTeamId: homeTeamId === series.teamAId ? series.teamBId : series.teamAId,
    date: previous ? addDays(previous.date, PLAYOFF_GAME_INTERVAL_DAYS) : series.startDate,
  };
}

/**
 * Derive one series solely from the append-only `state.results` ledger. The
 * checks deliberately reject impossible evidence instead of guessing which
 * mutable mirror was meant to win.
 */
function deriveSeries(series: PlayoffSeries, results: GameSummary[]): DerivedPlayoffSeries {
  const prefix = `${series.id}-G`;
  const games = results.filter((result) => result.id.startsWith(prefix));
  let teamAWins = 0;
  let teamBWins = 0;
  let previous: GameSummary | undefined;
  const gameIds: string[] = [];
  for (let index = 0; index < games.length; index++) {
    const game = games[index];
    const expected = expectedGame(series, index + 1, previous);
    if (game.id !== expected.id) throw new Error(`playoff result ${game.id} skips or reorders a game in ${series.id}`);
    if (game.homeTeamId !== expected.homeTeamId || game.awayTeamId !== expected.awayTeamId) {
      throw new Error(`playoff result ${game.id} does not match its bracket slot`);
    }
    if (game.date !== expected.date) throw new Error(`playoff result ${game.id} has a non-canonical date`);
    if (game.winnerId !== series.teamAId && game.winnerId !== series.teamBId) {
      throw new Error(`playoff result ${game.id} winner is outside ${series.id}`);
    }
    if (teamAWins >= series.winsRequired || teamBWins >= series.winsRequired) {
      throw new Error(`playoff result ${game.id} was recorded after ${series.id} clinched`);
    }
    if (game.winnerId === series.teamAId) teamAWins++; else teamBWins++;
    gameIds.push(game.id);
    previous = game;
  }
  return {
    ...series, teamAWins, teamBWins, gameIds,
    winnerTeamId: teamAWins >= series.winsRequired ? series.teamAId :
      (teamBWins >= series.winsRequired ? series.teamBId : null),
  };
}

/** Attach result records internally without persisting another source of truth. */
type SeriesWithResults = DerivedPlayoffSeries & { _results?: GameSummary[] };
function derived(series: PlayoffSeries, state: SeasonState): SeriesWithResults {
  const d = deriveSeries(series, state.results);
  return { ...d, _results: state.results.filter((r) => d.gameIds.includes(r.id)) };
}

function winner(series: SeriesWithResults): string {
  if (!series.winnerTeamId) throw new Error(`series ${series.id} has no winner`);
  return series.winnerTeamId;
}
function loser(series: SeriesWithResults): string {
  return winner(series) === series.teamAId ? series.teamBId : series.teamAId;
}
function seriesDate(series: SeriesWithResults[], fallback: string): string {
  return series.flatMap((s) => s._results ?? []).reduce((latest, result) =>
    result.date > latest ? result.date : latest, fallback);
}

function addFirstRound(series: PlayoffSeries[], conference: PlayoffConference, seeds: Map<number, string>, startDate: string): void {
  if (series.some((s) => s.conference === conference && s.round === 'first_round')) return;
  for (const [position, high, low] of [['S1', 1, 8], ['S2', 4, 5], ['S3', 3, 6], ['S4', 2, 7]] as const) {
    const highTeam = seeds.get(high); const lowTeam = seeds.get(low);
    if (!highTeam || !lowTeam) throw new Error(`${conference} playoff seed ${high}/${low} missing`);
    series.push(makeSeries({ conference, round: 'first_round', position, teamAId: highTeam, teamBId: lowTeam,
      teamASeed: high, teamBSeed: low, homeCourtTeamId: highTeam, startDate }));
  }
}

function initializeSeeds(state: SeasonState, teams: Team[]): void {
  if (state.gamesPlayed < state.totalGames || state.playoffs.grandfatheredComplete || state.playoffs.seeds.length) return;
  state.playoffs.startDate = addDays(state.endDate, PLAYOFF_START_REST_DAYS);
  state.playoffs.endDate = addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS);
  state.playoffs.playInEnabled = PLAY_IN_ENABLED;
  state.playoffs.seeds = CONFERENCES.flatMap((conference) =>
    rankConference(conference, state.standings, state.results, teams)
      .slice(0, PLAY_IN_ENABLED ? 10 : 8)
      .map((standing, index) => ({ conference, seed: index + 1, teamId: standing.teamId } satisfies PlayoffSeed)));
}

/** Reconstruct all materialized bracket slots from seeds plus result evidence. */
function buildBracket(state: SeasonState): PlayoffSeries[] {
  if (!state.playoffs.startDate) return [];
  const series: PlayoffSeries[] = [];
  const start = state.playoffs.startDate;
  for (const conference of CONFERENCES) {
    const seeds = new Map(state.playoffs.seeds.filter((s) => s.conference === conference).map((s) => [s.seed, s.teamId]));
    if (state.playoffs.playInEnabled) {
      for (const [position, a, b] of [['78', 7, 8], ['910', 9, 10]] as const) {
        const teamA = seeds.get(a); const teamB = seeds.get(b);
        if (!teamA || !teamB) throw new Error(`${conference} play-in seed ${a}/${b} missing`);
        series.push(makeSeries({ conference, round: 'play_in', position, teamAId: teamA, teamBId: teamB,
          teamASeed: a, teamBSeed: b, homeCourtTeamId: teamA, startDate: start, winsRequired: PLAY_IN_WINS_REQUIRED }));
      }
    } else addFirstRound(series, conference, seeds, start);
  }

  for (const conference of CONFERENCES) {
    if (state.playoffs.playInEnabled) {
      const s78 = derived(series.find((s) => s.conference === conference && s.bracketPosition === '78')!, state);
      const s910 = derived(series.find((s) => s.conference === conference && s.bracketPosition === '910')!, state);
      if (s78.winnerTeamId && s910.winnerTeamId) {
        const teamA = loser(s78); const teamB = winner(s910);
        const final = makeSeries({ conference, round: 'play_in', position: '8', teamAId: teamA, teamBId: teamB,
          teamASeed: seedFor(state, teamA), teamBSeed: seedFor(state, teamB), homeCourtTeamId: teamA,
          startDate: addDays(seriesDate([s78, s910], state.endDate), PLAYOFF_GAME_INTERVAL_DAYS), winsRequired: PLAY_IN_WINS_REQUIRED });
        series.push(final);
        const finalD = derived(final, state);
        if (finalD.winnerTeamId) {
          const qualified = new Map(state.playoffs.seeds.filter((seed) => seed.conference === conference).map((seed) => [seed.seed, seed.teamId]));
          qualified.set(7, winner(s78));
          qualified.set(8, winner(finalD));
          addFirstRound(series, conference, qualified, addDays(seriesDate([finalD], state.endDate), PLAYOFF_ROUND_REST_DAYS));
        }
      }
    }

    const first = series.filter((s) => s.conference === conference && s.round === 'first_round').map((s) => derived(s, state));
    if (first.length === 4 && first.every((s) => s.winnerTeamId)) {
      const startDate = addDays(seriesDate(first, state.endDate), PLAYOFF_ROUND_REST_DAYS);
      for (const [position, aPos, bPos] of [['S1', 'S1', 'S2'], ['S2', 'S3', 'S4']] as const) {
        const a = winner(first.find((s) => s.bracketPosition === aPos)!);
        const b = winner(first.find((s) => s.bracketPosition === bPos)!);
        const aSeed = seedFor(state, a); const bSeed = seedFor(state, b);
        series.push(makeSeries({ conference, round: 'conference_semifinals', position, teamAId: a, teamBId: b,
          teamASeed: aSeed, teamBSeed: bSeed, homeCourtTeamId: aSeed < bSeed ? a : b, startDate }));
      }
    }

    const semis = series.filter((s) => s.conference === conference && s.round === 'conference_semifinals').map((s) => derived(s, state));
    if (semis.length === 2 && semis.every((s) => s.winnerTeamId)) {
      const a = winner(semis.find((s) => s.bracketPosition === 'S1')!);
      const b = winner(semis.find((s) => s.bracketPosition === 'S2')!);
      const aSeed = seedFor(state, a); const bSeed = seedFor(state, b);
      series.push(makeSeries({ conference, round: 'conference_finals', position: 'S1', teamAId: a, teamBId: b,
        teamASeed: aSeed, teamBSeed: bSeed, homeCourtTeamId: aSeed < bSeed ? a : b,
        startDate: addDays(seriesDate(semis, state.endDate), PLAYOFF_ROUND_REST_DAYS) }));
    }
  }

  const finals = series.filter((s) => s.round === 'conference_finals').map((s) => derived(s, state));
  if (finals.length === 2 && finals.every((s) => s.winnerTeamId)) {
    const east = winner(finals.find((s) => s.conference === 'East')!);
    const west = winner(finals.find((s) => s.conference === 'West')!);
    const standings = new Map(state.standings.map((s) => [s.teamId, s]));
    const es = standings.get(east)!; const ws = standings.get(west)!;
    const h2h = state.results.filter((g) => (g.homeTeamId === east && g.awayTeamId === west) || (g.homeTeamId === west && g.awayTeamId === east));
    const eastWins = h2h.filter((g) => g.winnerId === east).length;
    const eastBetter = pct(es.wins, es.losses) > pct(ws.wins, ws.losses) ||
      (pct(es.wins, es.losses) === pct(ws.wins, ws.losses) && (eastWins > h2h.length - eastWins ||
        (eastWins === h2h.length - eastWins && (pointDifferential(es) > pointDifferential(ws) ||
          (pointDifferential(es) === pointDifferential(ws) && east < west)))));
    series.push(makeSeries({ conference: null, round: 'finals', position: 'S1', teamAId: east, teamBId: west,
      teamASeed: seedFor(state, east), teamBSeed: seedFor(state, west), homeCourtTeamId: eastBetter ? east : west,
      startDate: addDays(seriesDate(finals, state.endDate), PLAYOFF_ROUND_REST_DAYS) }));
  }
  return series;
}

function validateLedgerIds(results: GameSummary[]): void {
  const seen = new Map<string, GameSummary>();
  for (const result of results) {
    const previous = seen.get(result.id);
    if (previous) throw new Error(JSON.stringify(previous) === JSON.stringify(result)
      ? `duplicate completed result id ${result.id}` : `conflicting completed result id ${result.id}`);
    seen.set(result.id, result);
  }
}

/** Rebuild construction and upcoming slots. Results stay untouched and authoritative. */
export function syncPlayoffs(state: SeasonState, teams: Team[]): void {
  validateLedgerIds(state.results);
  if (state.playoffs.grandfatheredComplete) return;
  initializeSeeds(state, teams);
  if (!state.playoffs.seeds.length) return;
  const series = buildBracket(state);
  const derivedSeries = series.map((s) => derived(s, state));
  const known = new Set(derivedSeries.flatMap((s) => s.gameIds));
  for (const result of state.results.filter((r) => r.id.startsWith('PO-'))) {
    if (!known.has(result.id)) throw new Error(`playoff result ${result.id} does not belong to the reconstructed bracket`);
  }
  state.playoffs.series = series;
  state.playoffs.schedule = derivedSeries
    .filter((series) => !series.winnerTeamId)
    .map((series) => {
      const previous = series._results?.[series._results.length - 1];
      const game = expectedGame(series, series.gameIds.length + 1, previous);
      return { ...game, day: daysBetween(state.startDate, game.date) };
    })
    .sort((a, b) => a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : compareIds(a.id, b.id));
}

export function derivePlayoffSeries(state: SeasonState): DerivedPlayoffSeries[] {
  return state.playoffs.series.map((series) => deriveSeries(series, state.results));
}

export function deriveChampion(state: SeasonState): string | null {
  if (state.playoffs.grandfatheredComplete) return null;
  return derivePlayoffSeries(state).find((series) => series.round === 'finals')?.winnerTeamId ?? null;
}

export function derivePlayoffStatus(state: SeasonState): PlayoffStatus {
  if (state.playoffs.grandfatheredComplete) return 'grandfathered_complete';
  if (state.gamesPlayed < state.totalGames) return 'pending';
  return deriveChampion(state) ? 'complete' : 'in_progress';
}

/** The unified append-only results ledger is the sole completed-game source. */
export function allSeasonResults(state: SeasonState): GameSummary[] {
  return state.results;
}

export function nextSeasonGameDate(state: SeasonState): string | null {
  const completed = new Set(state.results.map((result) => result.id));
  let next: string | null = null;
  for (const game of [...state.schedule, ...state.playoffs.schedule]) {
    if (completed.has(game.id) || game.date! <= state.currentDate) continue;
    if (next === null || game.date! < next) next = game.date!;
  }
  return next;
}

export function isSeasonComplete(state: SeasonState): boolean {
  return derivePlayoffStatus(state) === 'complete' || derivePlayoffStatus(state) === 'grandfathered_complete';
}

export function isTeamEliminated(state: SeasonState, teamId: string): boolean {
  if (isSeasonComplete(state)) return teamId !== deriveChampion(state);
  if (derivePlayoffStatus(state) !== 'in_progress') return false;
  if (!state.playoffs.seeds.some((seed) => seed.teamId === teamId)) return true;
  for (const series of derivePlayoffSeries(state)) {
    if (!series.winnerTeamId || (series.teamAId !== teamId && series.teamBId !== teamId)) continue;
    if (series.winnerTeamId === teamId) continue;
    if (series.round === 'play_in' && series.bracketPosition === '78') continue;
    return true;
  }
  return false;
}
