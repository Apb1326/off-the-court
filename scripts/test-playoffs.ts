/** F2 deterministic playoff/bracket regression harness. */
import { readFile } from 'fs/promises';
import path from 'path';
import { createSeasonState, advanceSeason } from '../src/engine/season';
import { addDays } from '../src/engine/calendar';
import { nextSeasonGameDate, rankConference } from '../src/engine/playoffs';
import { PLAYOFF_HOME_COURT_PATTERN, PLAYOFF_MAX_CALENDAR_DAYS } from '../src/engine/constants';
import { derivePhase } from '../src/models/save';
import { Team } from '../src/models/team';
import { Player } from '../src/models/player';
import { GameSummary, TeamStanding, emptyStanding } from '../src/models/season';

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

function regularFingerprint(state: ReturnType<typeof createSeasonState>): string {
  return JSON.stringify({
    schedule: state.schedule,
    standings: state.standings,
    playerStats: state.playerStats,
    results: state.results,
    gamesPlayed: state.gamesPlayed,
    totalGames: state.totalGames,
  });
}

function playoffFingerprint(state: ReturnType<typeof createSeasonState>): string {
  return JSON.stringify({
    currentDate: state.currentDate,
    playoffs: state.playoffs,
    playoffPlayerStats: state.playoffPlayerStats,
    injuries: state.injuries,
    recoveries: state.recoveries,
    injuryHistory: state.injuryHistory,
  });
}

function finishPostseason(state: ReturnType<typeof createSeasonState>, teams: Team[], players: Player[]): void {
  advanceSeason(state, addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS), teams, players);
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf8'));
  const players: Player[] = JSON.parse(await readFile(path.join(dataDir, 'players.json'), 'utf8'));

  // Tie-group ranking is transitive and deterministic: an H2H mini-league win
  // outranks otherwise-identical same-division teams, then stable id decides.
  const trio = teams.filter((team) => team.conference === 'East' && team.division === 'Atlantic').slice(0, 3);
  const standings: TeamStanding[] = trio.map((team) => ({ ...emptyStanding(team.id), wins: 50, losses: 32,
    confWins: 30, confLosses: 22, pointsFor: 9000, pointsAgainst: 8800 }));
  const h2h: GameSummary[] = [{ id: 'tie', date: '2025-01-01', homeTeamId: trio[0].id,
    awayTeamId: trio[1].id, homeScore: 100, awayScore: 90, overtimePeriods: 0, winnerId: trio[0].id }];
  const ranked = rankConference('East', standings, h2h, trio);
  check('tie group uses head-to-head before stable id', ranked[0].teamId === trio[0].id);
  const stable = rankConference('East', standings, [], trio).map((s) => s.teamId);
  check('fully tied group has a stable deterministic order', stable.join('|') === [...stable].sort().join('|'));
  const conferenceTie = standings.map((standing, index) => ({
    ...standing,
    confWins: 28 + index,
    confLosses: 24 - index,
  }));
  check('conference record resolves a tie after head-to-head/division status',
    rankConference('East', conferenceTie, [], trio)[0].teamId === trio[2].id);
  const differentialTie = standings.map((standing, index) => ({
    ...standing,
    pointsFor: standing.pointsFor + index * 25,
  }));
  check('point differential resolves a tie before stable id',
    rankConference('East', differentialTie, [], trio)[0].teamId === trio[2].id);

  const first = createSeasonState(teams, players, { seed: 2026 });
  advanceSeason(first, first.endDate, teams, players);
  check('regular slate completes before postseason', first.gamesPlayed === first.totalGames);
  check('phase transitions to playoffs', derivePhase(first) === 'playoffs');
  check('play-in opens with four deterministic conference games',
    first.playoffs.series.filter((s) => s.round === 'play_in').length === 4 && first.playoffs.schedule.length === 4);
  check('playoff IDs depend on bracket slots, not team ids',
    first.playoffs.schedule.every((g) => /^PO-[EW]-PI-(78|910)-G1$/.test(g.id)));

  const frozenRegular = regularFingerprint(first);
  finishPostseason(first, teams, players);
  check('full postseason completes with a champion',
    first.playoffs.status === 'complete' && !!first.playoffs.championTeamId);
  check('completed postseason derives offseason', derivePhase(first) === 'offseason');
  check('regular standings, stats, results, and counters freeze', regularFingerprint(first) === frozenRegular);
  check('playoff games accumulate only in playoff stats/results',
    first.playoffs.results.length > 0 && first.playoffPlayerStats.some((s) => s.gamesPlayed > 0));
  const playoffInjuries = first.injuryHistory.filter((injury) => injury.startDate > first.endDate);
  check('playoff injury histories finalize from actual missed games',
    first.playoffs.pendingInjuryHistory.length === 0 &&
    playoffInjuries.some((injury) => injury.severity === 'out' && injury.gamesMissed > 0));
  const ids = first.playoffs.results.map((result) => result.id);
  check('every playoff game id is unique', ids.length === new Set(ids).size);
  check('every completed series stops at its clinching game', first.playoffs.series.every((series) =>
    !!series.winnerTeamId && series.gameIds.length <= series.winsRequired * 2 - 1));
  check('2-2-1-1-1 home pattern is honored', first.playoffs.series.every((series) =>
    series.gameIds.every((id, index) => {
      const game = first.playoffs.schedule.find((scheduled) => scheduled.id === id)!;
      const higherHome = series.winsRequired === 1 || PLAYOFF_HOME_COURT_PATTERN[index] === 'higher';
      return higherHome === (game.homeTeamId === series.homeCourtTeamId);
    })));

  const beforeReplay = playoffFingerprint(first);
  finishPostseason(first, teams, players);
  check('re-advancing a completed postseason is idempotent', playoffFingerprint(first) === beforeReplay);

  const second = createSeasonState(teams, players, { seed: 2026 });
  finishPostseason(second, teams, players);
  check('same seed produces the same champion', second.playoffs.championTeamId === first.playoffs.championTeamId);
  check('same seed produces byte-identical postseason state', playoffFingerprint(second) === playoffFingerprint(first));

  const chunked = createSeasonState(teams, players, { seed: 2026 });
  advanceSeason(chunked, chunked.endDate, teams, players);
  const playoffTeamIds = new Set(chunked.playoffs.seeds.map((seed) => seed.teamId));
  const carryover = chunked.injuries.find((injury) => playoffTeamIds.has(injury.teamId));
  let expectedCarryoverMissed = carryover
    ? chunked.playoffs.pendingInjuryHistory.find((pending) =>
        pending.injury.playerId === carryover.playerId && pending.injury.startDate === carryover.startDate)?.gamesMissed ?? 0
    : 0;
  while (chunked.playoffs.status === 'in_progress') {
    const next = nextSeasonGameDate(chunked);
    if (!next) throw new Error('active postseason has no next game');
    if (carryover) {
      const active = chunked.injuries.find((injury) =>
        injury.playerId === carryover.playerId && injury.startDate === carryover.startDate);
      const teamPlays = chunked.playoffs.schedule.some((game) =>
        game.date === next && (game.homeTeamId === carryover.teamId || game.awayTeamId === carryover.teamId));
      if (active && teamPlays && active.gamesRemaining > 1) expectedCarryoverMissed++;
    }
    advanceSeason(chunked, next, teams, players);
  }
  check('day-by-day postseason has the same champion', chunked.playoffs.championTeamId === first.playoffs.championTeamId);
  check('day-by-day postseason is byte-identical to one-shot advancement',
    playoffFingerprint(chunked) === playoffFingerprint(first));
  const finalizedCarryover = carryover ? chunked.injuryHistory.find((injury) =>
    injury.id === `${carryover.playerId}|${carryover.startDate}`) : null;
  check(`regular-onset injury carries its exact missed-game count through playoffs (${carryover?.playerId ?? 'none'} ${carryover?.startDate ?? ''}: ${finalizedCarryover?.gamesMissed ?? 'missing'}/${expectedCarryoverMissed})`,
    !!carryover && finalizedCarryover?.gamesMissed === expectedCarryoverMissed);

  console.log(`\n${failures === 0 ? 'PASS — all F2 playoff checks green' : `FAIL — ${failures} F2 check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
