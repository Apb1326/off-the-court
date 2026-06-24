import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { createSeasonState, advanceSeason } from '../src/engine/season';

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
  const teamName = (id: string) => teams.find((t) => t.id === id)?.abbreviation ?? id;

  const state = createSeasonState(teams, players, { seed: 7 });
  console.log(`Season ${state.startDate} → ${state.endDate}, ${state.totalGames} games`);
  console.log('Markers:');
  for (const m of state.markers) console.log(`  ${m.date}  ${m.label}`);

  const nextGameDate = () => {
    let min: string | null = null;
    for (const g of state.schedule) if (g.date! > state.currentDate && (!min || g.date! < min)) min = g.date!;
    return min;
  };

  console.log('\nFirst 3 game days:');
  for (let i = 0; i < 3; i++) {
    const d = nextGameDate();
    if (!d) break;
    const played = advanceSeason(state, d, teams, players);
    console.log(`  ${d}: ${played.length} games — e.g. ${played.slice(0, 3).map((g) => `${teamName(g.awayTeamId)} ${g.awayScore} @ ${teamName(g.homeTeamId)} ${g.homeScore}`).join(', ')}`);
  }

  // Jump to trade deadline
  const deadline = state.markers.find((m) => m.type === 'trade_deadline')!;
  advanceSeason(state, deadline.date, teams, players);
  console.log(`\nAt Trade Deadline (${deadline.date}): ${state.gamesPlayed}/${state.totalGames} games played`);

  // Finish the season
  advanceSeason(state, state.endDate, teams, players);
  console.log(`Season complete: ${state.gamesPlayed}/${state.totalGames} games, currentDate ${state.currentDate}`);

  const sorted = [...state.standings].sort((a, b) =>
    b.wins / Math.max(1, b.wins + b.losses) - a.wins / Math.max(1, a.wins + a.losses));
  console.log('\nTop 5:');
  for (const s of sorted.slice(0, 5)) {
    console.log(`  ${teamName(s.teamId).padEnd(4)} ${s.wins}-${s.losses}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
