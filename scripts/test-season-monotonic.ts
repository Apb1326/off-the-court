/**
 * Regression test for monotonic + idempotent season advancement.
 *
 * Proves the replay bug is fixed:
 *   1. Advancing to a later date creates results.
 *   2. Attempting to advance to an earlier date does not alter state.
 *   3. Advancing again forward does not duplicate game IDs, standings, or
 *      player totals — even when currentDate has been forced backward to
 *      simulate inconsistent persisted state.
 *
 * Standalone (no Next runtime). Run with:
 *   node_modules/.bin/tsx scripts/test-season-monotonic.ts
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SeasonState } from '../src/models/season';
import { createSeasonState, advanceSeason } from '../src/engine/season';
import { addDays } from '../src/engine/calendar';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

/** A cheap structural fingerprint of everything an advance should be able to change. */
function snapshot(state: SeasonState) {
  return JSON.stringify({
    currentDate: state.currentDate,
    gamesPlayed: state.gamesPlayed,
    results: state.results.map((r) => `${r.id}:${r.homeScore}-${r.awayScore}`),
    standings: state.standings.map((s) => `${s.teamId}:${s.wins}-${s.losses}:${s.pointsFor}/${s.pointsAgainst}`),
    playerTotals: state.playerStats.map((s) => `${s.playerId}:${s.gamesPlayed}:${s.totals.points}:${s.minutes}`),
  });
}

function gameIds(state: SeasonState): string[] {
  return state.results.map((r) => r.id);
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const state = createSeasonState(teams, players, { seed: 2026 });
  const startDate = state.startDate;

  // 1. Advance to a later date — results should be created.
  const target1 = addDays(startDate, 14);
  const played1 = advanceSeason(state, target1, teams, players);
  check('forward advance creates results', played1.length > 0 && state.results.length === played1.length);
  check('currentDate moved to target', state.currentDate === target1);
  check('gamesPlayed matches recorded results', state.gamesPlayed === state.results.length);

  const afterForward = snapshot(state);
  const idsAfterForward = gameIds(state);

  // 2. Attempt to advance to an EARLIER date — must be a no-op.
  const earlier = addDays(startDate, 5);
  const playedBack = advanceSeason(state, earlier, teams, players);
  check('backward advance plays no games', playedBack.length === 0);
  check('backward advance leaves currentDate forward', state.currentDate === target1);
  check('backward advance does not alter state', snapshot(state) === afterForward);

  // 3a. Re-advance to the SAME forward target — idempotent, no replay.
  const playedSame = advanceSeason(state, target1, teams, players);
  check('re-advance to same date plays no games', playedSame.length === 0);
  check('re-advance to same date does not alter state', snapshot(state) === afterForward);

  // 3b. Worst case: persisted state is inconsistent — currentDate rewound by hand
  //     (what a malicious "advance backward then forward" sequence would leave).
  //     The completed-ID set must still prevent any replay of finished games.
  state.currentDate = addDays(startDate, 3);
  const playedReplayAttempt = advanceSeason(state, target1, teams, players);
  check('rewound-clock advance replays nothing', playedReplayAttempt.length === 0);
  const idsAfterReplay = gameIds(state);
  check('no duplicate game IDs after replay attempt', idsAfterReplay.length === new Set(idsAfterReplay).size);
  check('game ID set unchanged by replay attempt',
    idsAfterReplay.length === idsAfterForward.length &&
    idsAfterReplay.every((id, i) => id === idsAfterForward[i]));

  // Restore the clock and advance genuinely forward — new games, still no dups.
  state.currentDate = target1;
  const target2 = addDays(startDate, 28);
  const played2 = advanceSeason(state, target2, teams, players);
  check('further forward advance creates new games', played2.length > 0);
  const allIds = gameIds(state);
  check('all recorded game IDs are unique', allIds.length === new Set(allIds).size);
  check('gamesPlayed still matches recorded results', state.gamesPlayed === state.results.length);

  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
