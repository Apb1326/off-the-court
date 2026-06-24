import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateGame } from '../src/engine';

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  // Find Lakers and Nuggets
  const lakers = teams.find(t => t.abbreviation === 'LAL')!;
  const nuggets = teams.find(t => t.abbreviation === 'DEN')!;
  const lakersPlayers = players.filter(p => p.teamId === lakers.id);
  const nuggetsPlayers = players.filter(p => p.teamId === nuggets.id);

  console.log(`Lakers (${lakers.id}): ${lakersPlayers.length} players`);
  console.log(`  Starters: ${lakers.rotation.starters.map(id => {
    const p = lakersPlayers.find(pp => pp.id === id);
    return p ? `${p.firstName} ${p.lastName} (${p.position})` : `MISSING:${id}`;
  }).join(', ')}`);
  console.log(`Nuggets (${nuggets.id}): ${nuggetsPlayers.length} players`);
  console.log(`  Starters: ${nuggets.rotation.starters.map(id => {
    const p = nuggetsPlayers.find(pp => pp.id === id);
    return p ? `${p.firstName} ${p.lastName} (${p.position})` : `MISSING:${id}`;
  }).join(', ')}`);

  // Run multiple sims with different seeds
  const seedScores: { seed: number; home: number; away: number }[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const r = simulateGame(lakers, nuggets, lakersPlayers, nuggetsPlayers, `test${seed}`, 'test', '2025-01-01', seed);
    seedScores.push({ seed, home: r.result.homeScore, away: r.result.awayScore });
  }
  console.log('\n20-game sample (LAL vs DEN):');
  for (const s of seedScores) {
    console.log(`  Seed ${String(s.seed).padStart(2)}: LAL ${String(s.home).padStart(3)} - DEN ${String(s.away).padStart(3)}  ${s.home > s.away ? 'LAL' : 'DEN'}`);
  }
  const avgHome = seedScores.reduce((s, g) => s + g.home, 0) / seedScores.length;
  const avgAway = seedScores.reduce((s, g) => s + g.away, 0) / seedScores.length;
  const homeWins = seedScores.filter((s) => s.home > s.away).length;
  console.log(`  Avg: LAL ${avgHome.toFixed(1)} - DEN ${avgAway.toFixed(1)} | LAL wins: ${homeWins}/20`);

  console.log('\nSimulating game (seed 42)...');
  const result = simulateGame(lakers, nuggets, lakersPlayers, nuggetsPlayers, 'test1', 'test', '2025-01-01', 42);

  console.log(`\nFinal Score: LAL ${result.result.homeScore} - DEN ${result.result.awayScore}`);
  console.log(`OT periods: ${result.result.overtimePeriods}`);
  console.log(`Play-by-play events: ${result.playByPlay.length}`);

  // Count events by type
  const counts: Record<string, number> = {};
  for (const e of result.playByPlay) {
    counts[e.outcome] = (counts[e.outcome] ?? 0) + 1;
  }
  console.log('\nEvent counts:', counts);

  // Show first 20 play-by-play events
  console.log('\nFirst 20 plays:');
  for (const e of result.playByPlay.slice(0, 20)) {
    console.log(`  Q${e.quarter} ${Math.floor(e.gameClock / 60)}:${String(Math.floor(e.gameClock % 60)).padStart(2, '0')} | ${e.outcome.padEnd(12)} | ${e.description}`);
  }

  // Box score summary
  console.log('\n--- Box Score ---');
  for (const side of ['homeTeam', 'awayTeam'] as const) {
    const team = side === 'homeTeam' ? lakers : nuggets;
    console.log(`\n${team.city} ${team.name}:`);
    for (const pl of result.boxScore[side].players) {
      const p = players.find(pp => pp.id === pl.playerId);
      const name = p ? `${p.firstName} ${p.lastName}` : pl.playerId;
      const s = pl.stats;
      console.log(`  ${name.padEnd(20)} ${String(Math.round(pl.minutes)).padStart(3)} min | ${String(s.points).padStart(2)} pts | ${s.fieldGoalsMade}-${s.fieldGoalsAttempted} FG | ${s.rebounds} reb | ${s.assists} ast | ${s.steals} stl | ${s.blocks} blk | ${s.turnovers} to`);
    }
    console.log(`  ${'TOTALS'.padEnd(20)} ${' '.repeat(8)} ${String(result.boxScore[side].totals.points).padStart(2)} pts | ${result.boxScore[side].totals.fieldGoalsMade}-${result.boxScore[side].totals.fieldGoalsAttempted} FG | ${result.boxScore[side].totals.rebounds} reb | ${result.boxScore[side].totals.assists} ast`);
  }
}

main().catch(console.error);
