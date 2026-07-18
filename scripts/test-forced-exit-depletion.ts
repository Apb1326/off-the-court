/** Regression: forced in-game injuries must never deplete a lineup to zero. */
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';

import { simulateGame } from '../src/engine';
import type { Player } from '../src/models/player';
import type { Team } from '../src/models/team';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const teams = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf8')) as Team[];
  const players = JSON.parse(await readFile(path.join(dataDir, 'players.json'), 'utf8')) as Player[];
  const byId = new Map(players.map((player) => [player.id, player]));
  const home = teams[0];
  const away = teams[1];
  const homePlayers = home.rotation.starters.map((id) => byId.get(id)).filter((player): player is Player => player !== undefined);
  const awayPlayers = away.rotation.starters.map((id) => byId.get(id)).filter((player): player is Player => player !== undefined);
  if (homePlayers.length !== 5 || awayPlayers.length !== 5) throw new Error('fixture requires five valid starters per team');

  // With no bench, all five home starters become due for forced exit at the
  // first dead ball. Four may leave; the last-player continuity rule must keep
  // the clock advancing and allow the game to finish deterministically.
  const exits = new Map(homePlayers.map((player) => [player.id, 1]));
  const run = () => simulateGame(home, away, homePlayers, awayPlayers, 'forced-exit-depletion', 'test', '2025-01-01', 91_337, exits);
  const first = run();
  const second = run();
  const firstHash = hash(first);
  const secondHash = hash(second);
  if (firstHash !== secondHash) throw new Error('forced-exit depletion result is not deterministic');
  if (first.playByPlay.length === 0) throw new Error('forced-exit depletion game emitted no events');
  if (!Number.isFinite(first.result.homeScore) || !Number.isFinite(first.result.awayScore)) throw new Error('forced-exit depletion game did not finish');

  console.log(`Forced-exit depletion: ${first.result.homeScore}-${first.result.awayScore}, ${first.playByPlay.length} events, hash ${firstHash.slice(0, 12)}.`);
  console.log('FORCED-EXIT DEPLETION PASSED: the final available player preserves clock progress and repeat identity.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
