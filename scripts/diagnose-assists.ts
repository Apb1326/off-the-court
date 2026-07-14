/** Production-path assist measurement. Strict chain credit remains unchanged;
 * the scorekeeper proxy is observational only and consumes no RNG. */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { ShotZone } from '../src/models/game';
import { SeededRNG } from '../src/lib/rng';
import { simulateGame } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';
import { createAssistMeasurements } from './assist-measurement';

const ZONES: ShotZone[] = ['rim', 'short_midrange', 'long_midrange', 'corner_three', 'above_break_three', 'deep_three'];
function arg(name: string): string | undefined { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3); }

async function main(): Promise<void> {
  if (process.argv.slice(2).some((value) => !/^--(games|seed)=/.test(value))) throw new Error('Usage: diagnose-assists.ts [--games=N] [--seed=N]');
  const seed = Number(arg('seed') ?? '2026');
  const cap = Number(arg('games') ?? Infinity);
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 2_000_000_000) throw new Error('--seed must be an integer in 1..2000000000');
  if (!(cap > 0)) throw new Error('--games must be positive');
  const data = path.join(process.cwd(), 'data');
  const teams = JSON.parse(await readFile(path.join(data, 'teams.json'), 'utf8')) as Team[];
  const players = JSON.parse(await readFile(path.join(data, 'players.json'), 'utf8')) as Player[];
  const byTeam = new Map<string, Player[]>(teams.map((team) => [team.id, []]));
  for (const player of players) if (player.teamId && byTeam.has(player.teamId)) byTeam.get(player.teamId)!.push(player);
  const byId = new Map(teams.map((team) => [team.id, team]));
  const measurements = createAssistMeasurements();
  const rng = new SeededRNG(seed);
  let games = 0;
  for (const game of generateSchedule(teams, rng)) {
    const home = byId.get(game.homeTeamId); const away = byId.get(game.awayTeamId);
    const hp = home ? byTeam.get(home.id) ?? [] : []; const ap = away ? byTeam.get(away.id) ?? [] : [];
    if (!home || !away || hp.length < 5 || ap.length < 5 || games >= cap) continue;
    games++;
    simulateGame(home, away, hp, ap, game.id, 'assist-measurement', `day-${game.day}`, rng.nextInt(1, 2_000_000_000), new Map(), { onShot: measurements.record });
  }
  console.log(`=== Production assisted-zone measurement — ${games} games, seed ${seed} ===`);
  console.log('Zone'.padEnd(20) + 'strict'.padStart(10) + 'proxy'.padStart(10) + 'zero-pass'.padStart(12));
  for (const zone of ZONES) {
    const row = measurements.byZone.get(zone)!;
    console.log(`${zone.padEnd(20)}${(100 * row.strict / row.made).toFixed(1).padStart(10)}${(100 * row.proxy / row.made).toFixed(1).padStart(10)}${(100 * row.zeroPassAttempts / row.attempts).toFixed(1).padStart(12)}`);
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
