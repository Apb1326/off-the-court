import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateSeason } from '../src/engine/season';

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  console.log('Simulating full season...');
  const start = Date.now();
  const result = simulateSeason(teams, players, { seed: 2026 });
  const elapsed = (Date.now() - start) / 1000;

  console.log(`\nSimulated ${result.gamesPlayed} games in ${elapsed.toFixed(1)}s`);
  console.log(`(${(result.gamesPlayed / elapsed).toFixed(0)} games/sec)`);

  const teamName = (id: string) => {
    const t = teams.find((tt) => tt.id === id)!;
    return `${t.city} ${t.name}`;
  };

  // Standings sorted by win pct
  const sorted = [...result.standings].sort((a, b) => {
    const aPct = a.wins / Math.max(1, a.wins + a.losses);
    const bPct = b.wins / Math.max(1, b.wins + b.losses);
    return bPct - aPct;
  });

  console.log('\n=== STANDINGS (top 10) ===');
  console.log('Team                        W   L    PCT   PF/g  PA/g  Strk');
  for (const s of sorted.slice(0, 10)) {
    const gp = s.wins + s.losses;
    const pct = (s.wins / Math.max(1, gp)).toFixed(3);
    const pfg = (s.pointsFor / Math.max(1, gp)).toFixed(1);
    const pag = (s.pointsAgainst / Math.max(1, gp)).toFixed(1);
    const strk = s.streak > 0 ? `W${s.streak}` : `L${-s.streak}`;
    console.log(`${teamName(s.teamId).padEnd(26)} ${String(s.wins).padStart(2)}  ${String(s.losses).padStart(2)}  ${pct}  ${pfg}  ${pag}  ${strk}`);
  }

  // Scoring leaders
  const playerName = (id: string) => {
    const p = players.find((pp) => pp.id === id)!;
    return `${p.firstName} ${p.lastName}`;
  };

  const withPpg = result.playerStats.map((s) => ({
    name: playerName(s.playerId),
    ppg: s.totals.points / s.gamesPlayed,
    rpg: s.totals.rebounds / s.gamesPlayed,
    apg: s.totals.assists / s.gamesPlayed,
    fgPct: s.totals.fieldGoalsMade / Math.max(1, s.totals.fieldGoalsAttempted),
    tpPct: s.totals.threePointersMade / Math.max(1, s.totals.threePointersAttempted),
    gp: s.gamesPlayed,
    mpg: s.minutes / s.gamesPlayed,
  }));

  console.log('\n=== SCORING LEADERS ===');
  console.log('Player                  GP   MPG   PPG   RPG   APG   FG%   3P%');
  for (const p of withPpg.sort((a, b) => b.ppg - a.ppg).slice(0, 15)) {
    console.log(`${p.name.padEnd(22)} ${String(p.gp).padStart(2)}  ${p.mpg.toFixed(1).padStart(4)}  ${p.ppg.toFixed(1).padStart(4)}  ${p.rpg.toFixed(1).padStart(4)}  ${p.apg.toFixed(1).padStart(4)}  ${(p.fgPct * 100).toFixed(1)}  ${(p.tpPct * 100).toFixed(1)}`);
  }

  // League-wide calibration check
  let totPts = 0, totFgm = 0, totFga = 0, totTpm = 0, totTpa = 0, totReb = 0, totAst = 0, totTo = 0;
  for (const s of result.playerStats) {
    totPts += s.totals.points;
    totFgm += s.totals.fieldGoalsMade;
    totFga += s.totals.fieldGoalsAttempted;
    totTpm += s.totals.threePointersMade;
    totTpa += s.totals.threePointersAttempted;
    totReb += s.totals.rebounds;
    totAst += s.totals.assists;
    totTo += s.totals.turnovers;
  }
  const teamGames = result.gamesPlayed * 2; // each game = 2 team-games
  console.log('\n=== LEAGUE AVERAGES (per team per game) ===');
  console.log(`PPG:  ${(totPts / teamGames).toFixed(1)}  (NBA ~114)`);
  console.log(`FG%:  ${(totFgm / totFga * 100).toFixed(1)}  (NBA ~47.5)`);
  console.log(`3P%:  ${(totTpm / totTpa * 100).toFixed(1)}  (NBA ~36.5)`);
  console.log(`3PA:  ${(totTpa / teamGames).toFixed(1)}  (NBA ~35)`);
  console.log(`REB:  ${(totReb / teamGames).toFixed(1)}  (NBA ~43)`);
  console.log(`AST:  ${(totAst / teamGames).toFixed(1)}  (NBA ~27)`);
  console.log(`TO:   ${(totTo / teamGames).toFixed(1)}  (NBA ~14)`);
}

main().catch(console.error);
