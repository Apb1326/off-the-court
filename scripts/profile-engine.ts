/**
 * Simulates a full season and prints the engine's per-team-per-game statistical
 * profile next to real modern-NBA rates, with deltas — the calibration
 * dashboard for tuning pace, shot mix, rebounding, etc.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateSeason } from '../src/engine/season';

// Real modern NBA (~2023-24) per-team-per-game targets.
const REAL: Record<string, number> = {
  pace: 99.0, pts: 114.0, fga: 88.5, fgPct: 0.475, tpa: 35.1, tpPct: 0.366,
  fta: 21.8, ftPct: 0.785, orb: 10.2, drb: 33.1, reb: 43.3, ast: 26.9,
  stl: 7.4, blk: 5.1, tov: 13.9, ppp: 1.150,
};

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const r = simulateSeason(teams, players, { seed: 2026 });
  const tg = r.gamesPlayed * 2; // team-games

  let pts = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0;
  let orb = 0, drb = 0, reb = 0, ast = 0, stl = 0, blk = 0, tov = 0;
  for (const s of r.playerStats) {
    const t = s.totals;
    pts += t.points; fgm += t.fieldGoalsMade; fga += t.fieldGoalsAttempted;
    tpm += t.threePointersMade; tpa += t.threePointersAttempted;
    ftm += t.freeThrowsMade; fta += t.freeThrowsAttempted;
    orb += t.offensiveRebounds; drb += t.defensiveRebounds; reb += t.rebounds;
    ast += t.assists; stl += t.steals; blk += t.blocks; tov += t.turnovers;
  }

  const per = (x: number) => x / tg;
  const possessions = per(fga) + 0.44 * per(fta) + per(tov) - per(orb);

  const eng: Record<string, number> = {
    pace: possessions, pts: per(pts), fga: per(fga), fgPct: fgm / fga,
    tpa: per(tpa), tpPct: tpm / tpa, fta: per(fta), ftPct: ftm / fta,
    orb: per(orb), drb: per(drb), reb: per(reb), ast: per(ast),
    stl: per(stl), blk: per(blk), tov: per(tov), ppp: per(pts) / possessions,
  };

  const rows: [string, string][] = [
    ['Pace (poss)', 'pace'], ['Points', 'pts'], ['PPP', 'ppp'],
    ['FGA', 'fga'], ['FG%', 'fgPct'], ['3PA', 'tpa'], ['3P%', 'tpPct'],
    ['FTA', 'fta'], ['FT%', 'ftPct'], ['OREB', 'orb'], ['DREB', 'drb'],
    ['REB', 'reb'], ['AST', 'ast'], ['STL', 'stl'], ['BLK', 'blk'], ['TOV', 'tov'],
  ];
  const pctKeys = new Set(['fgPct', 'tpPct', 'ftPct', 'ppp']);

  const fmt = (k: string, v: number) =>
    pctKeys.has(k) ? (k === 'ppp' ? v.toFixed(3) : (v * 100).toFixed(1)) : v.toFixed(1);

  console.log(`Engine profile vs real NBA (${r.gamesPlayed} games)\n`);
  console.log('Stat'.padEnd(13) + 'Engine'.padStart(8) + 'Real'.padStart(8) + 'Delta'.padStart(8) + '  Flag');
  console.log('-'.repeat(46));
  for (const [label, key] of rows) {
    const e = eng[key], real = REAL[key];
    const delta = e - real;
    const relPct = Math.abs(delta) / real;
    const flag = relPct > 0.10 ? '⚠️' : relPct > 0.05 ? '·' : '';
    const d = pctKeys.has(key)
      ? (key === 'ppp' ? delta.toFixed(3) : (delta * 100).toFixed(1))
      : delta.toFixed(1);
    console.log(
      label.padEnd(13) +
      fmt(key, e).padStart(8) +
      fmt(key, real).padStart(8) +
      (delta >= 0 ? '+' + d : d).padStart(8) +
      '  ' + flag
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
