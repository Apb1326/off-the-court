/**
 * Determinism check: the same seed must produce a byte-for-byte identical game.
 * Runs several matchups twice each and asserts the box score AND the full
 * play-by-play event stream hash identically. This must pass before any tuning
 * conclusion is trusted — spacing is pure arithmetic and routes no randomness,
 * so the change must not perturb the RNG stream.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateGame } from '../src/engine';

function hash(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
  const byTeam = (id: string) => players.filter((p) => p.teamId === id);

  const matchups: [string, string, number][] = [
    ['LAL', 'DEN', 42], ['BOS', 'MIL', 7], ['GSW', 'OKC', 123], ['CHA', 'DET', 2026],
  ];

  let allOk = true;
  for (const [homeAbbr, awayAbbr, seed] of matchups) {
    const home = teams.find((t) => t.abbreviation === homeAbbr)!;
    const away = teams.find((t) => t.abbreviation === awayAbbr)!;
    const hp = byTeam(home.id), ap = byTeam(away.id);

    const r1 = simulateGame(home, away, hp, ap, 'd1', 'det', '2025-01-01', seed);
    const r2 = simulateGame(home, away, hp, ap, 'd1', 'det', '2025-01-01', seed);

    const box1 = hash(r1.boxScore), box2 = hash(r2.boxScore);
    const pbp1 = hash(r1.playByPlay), pbp2 = hash(r2.playByPlay);
    const ok = box1 === box2 && pbp1 === pbp2 && r1.playByPlay.length === r2.playByPlay.length;
    allOk = allOk && ok;
    console.log(
      `${homeAbbr} vs ${awayAbbr} (seed ${seed}): ${r1.result.homeScore}-${r1.result.awayScore}, ` +
      `${r1.playByPlay.length} events | box ${box1.slice(0, 12)} | pbp ${pbp1.slice(0, 12)} | ${ok ? 'IDENTICAL' : 'MISMATCH'}`,
    );
  }

  if (!allOk) { console.error('\nDETERMINISM FAILED'); process.exit(1); }
  console.log('\nDETERMINISM PASSED: identical box score + event stream for every seed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
