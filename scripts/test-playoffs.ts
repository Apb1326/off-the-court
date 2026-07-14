/** F2 acceptance harness: ledger-derived playoffs and regular-season compatibility. */
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { createSeasonState, advanceSeason, seasonRestTarget } from '../src/engine/season';
import { addDays } from '../src/engine/calendar';
import { deriveChampion, derivePlayoffSeries, derivePlayoffStatus, nextSeasonGameDate, rankConference } from '../src/engine/playoffs';
import { injuryGamesMissed } from '../src/engine/injury';
import { PLAYOFF_MAX_CALENDAR_DAYS } from '../src/engine/constants';
import { derivePhase } from '../src/models/save';
import { Team } from '../src/models/team';
import { Player } from '../src/models/player';
import { GameSummary, TeamStanding, emptyStanding } from '../src/models/season';

let failures = 0;
const PRE_F2_REGULAR_PROJECTION_SHA256 = '715ba6504be40472df855565061703710a4186a656a81354fdb02c06397d5800';
function check(label: string, ok: boolean): void {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

function regularProjection(state: ReturnType<typeof createSeasonState>): string {
  return JSON.stringify({ currentDate: state.currentDate, gamesPlayed: state.gamesPlayed, results: state.results,
    standings: state.standings, playerStats: state.playerStats, injuries: state.injuries, recoveries: state.recoveries });
}
function frozenRegularContent(state: ReturnType<typeof createSeasonState>): string {
  return JSON.stringify({ gamesPlayed: state.gamesPlayed, results: state.results.filter((result) => !result.id.startsWith('PO-')),
    standings: state.standings, playerStats: state.playerStats });
}
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function playoffFingerprint(state: ReturnType<typeof createSeasonState>): string {
  return JSON.stringify({ currentDate: state.currentDate, results: state.results, playoffs: state.playoffs,
    playoffPlayerStats: state.playoffPlayerStats, injuries: state.injuries, recoveries: state.recoveries,
    injuryHistory: state.injuryHistory.map((entry) => ({ ...entry, gamesMissed: injuryGamesMissed(entry, state.results) })) });
}
function finishPostseason(state: ReturnType<typeof createSeasonState>, teams: Team[], players: Player[]): void {
  advanceSeason(state, addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS), teams, players);
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf8'));
  const players: Player[] = JSON.parse(await readFile(path.join(dataDir, 'players.json'), 'utf8'));

  const trio = teams.filter((team) => team.conference === 'East' && team.division === 'Atlantic').slice(0, 3);
  const standings: TeamStanding[] = trio.map((team) => ({ ...emptyStanding(team.id), wins: 50, losses: 32,
    confWins: 30, confLosses: 22, pointsFor: 9000, pointsAgainst: 8800 }));
  const h2h: GameSummary[] = [{ id: 'tie', date: '2025-01-01', homeTeamId: trio[0].id, awayTeamId: trio[1].id,
    homeScore: 100, awayScore: 90, overtimePeriods: 0, winnerId: trio[0].id }];
  check('tie group uses head-to-head before stable id', rankConference('East', standings, h2h, trio)[0].teamId === trio[0].id);
  check('fully tied group has a stable deterministic order', rankConference('East', standings, [], trio).map((s) => s.teamId).join('|') === trio.map((t) => t.id).sort().join('|'));
  check('one-game in-game injury misses no later team game', injuryGamesMissed({
    id: 'in-game', season: 'test', playerId: 'p', teamId: trio[0].id, injuryType: 'test', region: 'test',
    severity: 'day_to_day', startDate: '2025-01-01', onsetGameId: 'tie', playedOnset: true, maxGamesMissed: 0,
  }, h2h) === 0);

  const order = createSeasonState(teams, players, { seed: 2026 });
  const openingDate = order.schedule[0].date!;
  check('seed-2026 opening-night schedule order is preserved', order.schedule.filter((game) => game.date === openingDate).map((game) => game.id).join(' ') === 'g0 g2 g4 g6 g8 g16 g20 g24');

  const invalidRegular = createSeasonState(teams, players, { seed: 2026 });
  const regularGame = invalidRegular.schedule[0];
  const truncated = players.filter((player) => player.teamId !== regularGame.homeTeamId).concat(players.filter((player) => player.teamId === regularGame.homeTeamId).slice(0, 4));
  advanceSeason(invalidRegular, regularGame.date!, teams, truncated);
  check('invalid regular roster retains compatibility skip behavior', !invalidRegular.results.some((result) => result.id === regularGame.id) && invalidRegular.currentDate === regularGame.date!);

  const first = createSeasonState(teams, players, { seed: 2026 });
  check('regular rest target stops at the regular-season boundary', seasonRestTarget(first) === first.endDate);
  advanceSeason(first, seasonRestTarget(first), teams, players);
  check('regular slate completes before postseason', first.gamesPlayed === first.totalGames);
  check('regular boundary materializes but does not play the bracket', derivePhase(first) === 'playoffs' && first.results.every((r) => !r.id.startsWith('PO-')));
  check('play-in opens with four deterministic games', first.playoffs.schedule.length === 4 && first.playoffs.schedule.every((g) => /^PO-[EW]-PI-(78|910)-G1$/.test(g.id)));
  const regularProjectionHash = sha256(regularProjection(first));
  check('full pre-F2 regular-season projection is byte-identical', regularProjectionHash === PRE_F2_REGULAR_PROJECTION_SHA256);
  check('postseason rest target extends through the deterministic playoff horizon', seasonRestTarget(first) === first.playoffs.endDate);
  const frozenRegular = frozenRegularContent(first);

  const invalidPlayoff = createSeasonState(teams, players, { seed: 2026 });
  advanceSeason(invalidPlayoff, invalidPlayoff.endDate, teams, players);
  const playoffGame = invalidPlayoff.playoffs.schedule[0];
  const broken = players.filter((player) => player.teamId !== playoffGame.homeTeamId).concat(players.filter((player) => player.teamId === playoffGame.homeTeamId).slice(0, 4));
  const before = JSON.stringify(invalidPlayoff);
  let threw = false;
  try { advanceSeason(invalidPlayoff, playoffGame.date!, teams, broken); } catch (error) { threw = error instanceof Error && error.message.includes('playoff invariant'); }
  check('invalid playoff roster throws descriptively and atomically', threw && JSON.stringify(invalidPlayoff) === before);
  advanceSeason(invalidPlayoff, playoffGame.date!, teams, players);
  check('playoff retry after roster repair advances exactly once', invalidPlayoff.results.filter((r) => r.id === playoffGame.id).length === 1);

  finishPostseason(first, teams, players);
  const champion = deriveChampion(first);
  const derived = derivePlayoffSeries(first);
  check('full postseason completes with a derived champion', derivePlayoffStatus(first) === 'complete' && !!champion && derivePhase(first) === 'offseason');
  check('regular standings, stats, and regular results freeze through playoffs', frozenRegularContent(first) === frozenRegular);
  check('only the unified results ledger stores playoff results', first.results.some((result) => result.id.startsWith('PO-')) && first.playoffPlayerStats.some((stat) => stat.gamesPlayed > 0));
  check('every completed series stops at its clinching game', derived.every((series) => !!series.winnerTeamId && series.gameIds.length <= series.winsRequired * 2 - 1));
  check('injury history stores immutable onset evidence', first.injuryHistory.every((entry) => typeof entry.gamesMissed === 'number' || !!entry.onsetGameId));

  const beforeReplay = playoffFingerprint(first);
  finishPostseason(first, teams, players);
  check('re-advancing a completed postseason is idempotent', playoffFingerprint(first) === beforeReplay);

  const second = createSeasonState(teams, players, { seed: 2026 });
  finishPostseason(second, teams, players);
  check('same seed produces byte-identical postseason state', playoffFingerprint(second) === playoffFingerprint(first));

  const chunked = createSeasonState(teams, players, { seed: 2026 });
  advanceSeason(chunked, chunked.endDate, teams, players);
  while (derivePlayoffStatus(chunked) === 'in_progress') {
    const next = nextSeasonGameDate(chunked);
    if (!next) throw new Error('active postseason has no next game');
    advanceSeason(chunked, next, teams, players);
  }
  check('one-shot and day-by-day postseason advancement are byte-identical', playoffFingerprint(chunked) === playoffFingerprint(first));

  // This value is captured by the repair acceptance command against 349575c;
  // the projection intentionally excludes F2-only playoff and injury-history fields.
  console.log(`REGULAR_PROJECTION_SHA256 ${regularProjectionHash}`);
  console.log(`\n${failures === 0 ? 'PASS — all F2 playoff checks green' : `FAIL — ${failures} F2 check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
