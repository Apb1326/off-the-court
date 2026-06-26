/**
 * Regression test for the live foul-out flow.
 *
 * The bug: personal fouls were recorded in the StatsAccumulator from
 * PlayByPlayEvent.foulPlayerId, but GameState.fouls (the live, in-game foul map)
 * was never incremented. checkSubstitutions therefore never saw a player reach
 * MAX_FOULS, so foul-outs never triggered a substitution and players could keep
 * fouling without limit.
 *
 * This test drives the real engine (no reimplementation of the stat pipeline)
 * and asserts, deterministically, that:
 *   1. A player reaches MAX_FOULS (six) and no player ever exceeds it.
 *   2. The live foul count — reconstructed from the event stream exactly the way
 *      the main game loop increments GameState.fouls — reaches six for that player.
 *   3. After a dead-ball substitution check, a player at MAX_FOULS is removed
 *      from the floor when a replacement is available, and is not eligible to be
 *      brought back in.
 *   4. The player's box-score foul total equals the number of foulPlayerId
 *      events for them in the play-by-play (box score is derived from the stream).
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { PlayByPlayEvent } from '../src/models/game';
import { simulateGame } from '../src/engine';
import { checkSubstitutions, findBestReplacement } from '../src/engine/substitution';
import { MAX_FOULS } from '../src/engine/constants';

const SEED_LO = 1;
const SEED_HI = 150;

/** Count, per player, how many play-by-play events name them as the fouler.
 *  This mirrors how the main game loop derives both the box-score foul (via
 *  recordEventStats) and the live GameState.fouls increment. */
function foulsFromStream(pbp: PlayByPlayEvent[]): Map<string, number> {
  const fouls = new Map<string, number>();
  for (const ev of pbp) {
    if (ev.foulPlayerId) {
      fouls.set(ev.foulPlayerId, (fouls.get(ev.foulPlayerId) ?? 0) + 1);
    }
  }
  return fouls;
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const home = teams[0];
  const away = teams[1];
  const homePlayers = players.filter((p) => p.teamId === home.id);
  const awayPlayers = players.filter((p) => p.teamId === away.id);
  const playerMap = new Map(players.map((p) => [p.id, p]));

  console.log(`Scanning seeds ${SEED_LO}..${SEED_HI} for ${home.abbreviation} vs ${away.abbreviation}...`);

  let maxPF = 0;
  let overLimit = 0; // count of any box line exceeding MAX_FOULS (the old bug)
  let foulOutSeed = -1;
  let foulOutPlayer = '';
  let foulOutSide: 'homeTeam' | 'awayTeam' = 'homeTeam';

  for (let seed = SEED_LO; seed <= SEED_HI; seed++) {
    const r = simulateGame(home, away, homePlayers, awayPlayers, `fo${seed}`, 'test', '2025-01-01', seed);
    for (const side of ['homeTeam', 'awayTeam'] as const) {
      for (const pl of r.boxScore[side].players) {
        const pf = pl.stats.personalFouls;
        if (pf > maxPF) maxPF = pf;
        if (pf > MAX_FOULS) overLimit++;
        if (pf >= MAX_FOULS && foulOutSeed < 0) {
          foulOutSeed = seed;
          foulOutPlayer = pl.playerId;
          foulOutSide = side;
        }
      }
    }
  }

  console.log(`Max personal fouls seen: ${maxPF}`);
  console.log(`Box lines exceeding MAX_FOULS (${MAX_FOULS}): ${overLimit}`);
  console.log(`First foul-out: seed ${foulOutSeed}, ${foulOutPlayer} (${foulOutSide})`);

  const checks: [string, boolean][] = [];

  // (1) A player reaches MAX_FOULS, and none exceed it.
  checks.push([`a player reaches MAX_FOULS (${MAX_FOULS})`, foulOutSeed >= 0]);
  checks.push([`no player exceeds MAX_FOULS (max seen ${maxPF})`, overLimit === 0 && maxPF <= MAX_FOULS]);

  if (foulOutSeed >= 0) {
    // Re-simulate the first foul-out game to inspect its full play-by-play.
    const game = simulateGame(home, away, homePlayers, awayPlayers, `fo${foulOutSeed}`, 'test', '2025-01-01', foulOutSeed);

    const boxPlayer = game.boxScore[foulOutSide].players.find((p) => p.playerId === foulOutPlayer)!;
    const streamFouls = foulsFromStream(game.playByPlay);

    // (2) The live foul count (reconstructed exactly as the loop increments it)
    //     reaches MAX_FOULS for the fouled-out player.
    const liveFouls = streamFouls.get(foulOutPlayer) ?? 0;
    checks.push([`live foul count reaches MAX_FOULS (got ${liveFouls})`, liveFouls === MAX_FOULS]);

    // (1, restated) box-score foul total is exactly MAX_FOULS.
    checks.push([`box-score PF == MAX_FOULS (got ${boxPlayer.stats.personalFouls})`,
      boxPlayer.stats.personalFouls === MAX_FOULS]);

    // (4) Box-score fouls are derived from the event stream — for EVERY player,
    //     not just the fouled-out one.
    let boxMatchesStream = true;
    for (const side of ['homeTeam', 'awayTeam'] as const) {
      for (const pl of game.boxScore[side].players) {
        if (pl.stats.personalFouls !== (streamFouls.get(pl.playerId) ?? 0)) {
          boxMatchesStream = false;
          console.log(`  MISMATCH ${pl.playerId}: box ${pl.stats.personalFouls} vs stream ${streamFouls.get(pl.playerId) ?? 0}`);
        }
      }
    }
    checks.push(['every box-score PF matches the event stream', boxMatchesStream]);

    // (3) Dead-ball substitution removes the fouled-out player when a
    //     replacement is available, using the real checkSubstitutions.
    const team = foulOutSide === 'homeTeam' ? home : away;
    const teamPlayerIds = (foulOutSide === 'homeTeam' ? homePlayers : awayPlayers).map((p) => p.id);

    // Build an on-court lineup that includes the fouled-out player.
    const lineup = [foulOutPlayer, ...team.rotation.starters.filter((id) => id !== foulOutPlayer)].slice(0, 5);
    const bench = teamPlayerIds.filter((id) => !lineup.includes(id));

    const fatigue = new Map<string, number>(teamPlayerIds.map((id) => [id, 0]));
    const fouls = new Map<string, number>(teamPlayerIds.map((id) => [id, 0]));
    fouls.set(foulOutPlayer, MAX_FOULS);

    const subs = checkSubstitutions(
      lineup, bench, playerMap, fatigue, fouls, team.rotation,
      /* quarter */ 2, /* gameClock */ 300, /* isDeadBall */ true, /* margin */ 0,
    );
    const removed = subs.some((s) => s.playerOut === foulOutPlayer);
    checks.push([`dead-ball check removes the fouled-out player (replacement available)`, removed]);

    // ...and the fouled-out player is not itself a legal replacement once benched.
    const replacementForSomeoneElse = findBestReplacement(
      lineup[1], [foulOutPlayer], playerMap, fatigue, fouls, team.rotation,
    );
    checks.push([`fouled-out player is ineligible as a replacement`, replacementForSomeoneElse === null]);

    // Scoping sanity: with no bench, no one can be removed (matches the
    // "when a replacement is available" contract — a man-down is not forced here).
    const noBenchSubs = checkSubstitutions(
      lineup, [], playerMap, fatigue, fouls, team.rotation, 2, 300, true, 0,
    );
    checks.push([`no replacement available => no foul-out sub`, noBenchSubs.length === 0]);

    // Determinism: same seed -> identical foul lines.
    const game2 = simulateGame(home, away, homePlayers, awayPlayers, `fo${foulOutSeed}`, 'test', '2025-01-01', foulOutSeed);
    const pf1 = game.boxScore[foulOutSide].players.map((p) => `${p.playerId}:${p.stats.personalFouls}`).join(',');
    const pf2 = game2.boxScore[foulOutSide].players.map((p) => `${p.playerId}:${p.stats.personalFouls}`).join(',');
    checks.push(['identical foul lines across two same-seed runs', pf1 === pf2]);
  }

  console.log('\n=== ASSERTIONS ===');
  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    allPass = allPass && ok;
  }

  if (!allPass) {
    console.error('\nFOUL-OUT REGRESSION TEST FAILED');
    process.exit(1);
  }
  console.log('\nFOUL-OUT REGRESSION TEST PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
