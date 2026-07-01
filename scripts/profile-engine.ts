/**
 * Simulates a full season and prints the engine's per-team-per-game statistical
 * profile next to real modern-NBA rates, with deltas AND explicit tolerance
 * bands — the calibration dashboard for tuning pace, shot mix, rebounding, etc.
 *
 * It drives simulateGame directly over the same schedule + per-game seed
 * sequence simulateSeason uses, so the box-score aggregates are identical, but
 * it can additionally read the play-by-play stream for the rim/mid/three shot
 * mix and the per-game scoring margin — neither of which survives into
 * SeasonResult. Those two are binding constraints for the spacing work, so they
 * have to be visible here or "within tolerance" is unmeasurable.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { ShotZone } from '../src/models/game';
import { SeededRNG } from '../src/lib/rng';
import { simulateGame } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';
import { selectLatestCareerStats } from '../src/ratings/derivation';

// Real modern NBA (~2023-24) per-team-per-game targets, shown for context. The
// LEAGUE_AVG constant in engine/constants.ts is a coarser subset of these.
const REAL: Record<string, number> = {
  pace: 99.0, pts: 114.0, ppp: 1.150, fga: 88.5, fgPct: 0.475,
  tpa: 35.1, tpPct: 0.366, fta: 21.8, ftPct: 0.785,
  orb: 10.2, drb: 33.1, reb: 43.3, ast: 26.9, stl: 7.4, blk: 5.1, tov: 13.9,
  rimShare: 0.340, midShare: 0.250, threeShare: 0.397, margin: 11.0,
};

// Pre-change engine baseline, captured by running this profile on the
// unmodified engine (seed 2026, 1290 games), with a per-stat neutrality
// tolerance band. THIS is the pass/fail oracle for the spacing work: the whole
// point of the change is to create roster-to-roster *differences* without
// moving the league aggregate, so a stat is "in tolerance" iff it has not
// drifted from where the unmodified engine put it. (Three of these — rim share,
// mid share, avg margin — already sit outside the real-NBA bands on the
// unmodified engine; that is a pre-existing calibration state this task must
// not worsen, not something it introduced.)
// 2026-07-01 pre-task capture already drifted from this older oracle at Points
// 109.2, PPP 1.090, and mid share 0.241. This task judges neutrality against
// that fresh capture; the stale BASE values remain unchanged for a dedicated
// future recalibration.
const BASE: Record<string, { v: number; tol: number }> = {
  pace: { v: 101.0, tol: 1.5 }, pts: { v: 113.3, tol: 2.5 }, ppp: { v: 1.122, tol: 0.020 },
  fga: { v: 87.8, tol: 2.0 }, fgPct: { v: 0.472, tol: 0.008 },
  tpa: { v: 35.2, tol: 2.0 }, tpPct: { v: 0.376, tol: 0.010 },
  fta: { v: 21.8, tol: 2.0 }, ftPct: { v: 0.793, tol: 0.012 },
  orb: { v: 9.5, tol: 1.5 }, drb: { v: 33.6, tol: 1.5 }, reb: { v: 43.1, tol: 1.5 },
  ast: { v: 26.2, tol: 1.5 }, stl: { v: 7.0, tol: 1.0 }, blk: { v: 5.4, tol: 1.0 },
  tov: { v: 13.1, tol: 1.0 },
  // Shot mix as a share of FGA — the binding constraint on the shot-mix hook.
  rimShare: { v: 0.381, tol: 0.015 },
  midShare: { v: 0.218, tol: 0.015 },
  threeShare: { v: 0.401, tol: 0.015 },
  // Average absolute final margin (blowout control).
  margin: { v: 16.8, tol: 1.5 },
};

function zoneBucket(z: ShotZone): 'rim' | 'mid' | 'three' {
  if (z === 'rim') return 'rim';
  if (z === 'short_midrange' || z === 'long_midrange') return 'mid';
  return 'three';
}

interface PlayerProfileTotals {
  teamId: string;
  games: number;
  minutes: number;
  points: number;
  fga: number;
  ftm: number;
  fta: number;
}

function rank(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end++;
    const averageRank = (start + 1 + end) / 2;
    for (let i = start; i < end; i++) ranks[indexed[i].index] = averageRank;
    start = end;
  }
  return ranks;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return Number.NaN;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let covariance = 0, varianceX = 0, varianceY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator === 0 ? Number.NaN : covariance / denominator;
}

function spearman(xs: number[], ys: number[]): number {
  return pearson(rank(xs), rank(ys));
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  // Mirror simulateSeason's RNG/seed sequence so aggregates match `npm run
  // profile`-via-season exactly, while also exposing PBP-derived stats.
  const rng = new SeededRNG(2026);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) {
    if (p.teamId && playersByTeam.has(p.teamId)) playersByTeam.get(p.teamId)!.push(p);
  }
  const schedule = generateSchedule(teams, rng);

  let pts = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0;
  let orb = 0, drb = 0, reb = 0, ast = 0, stl = 0, blk = 0, tov = 0;
  let rimAtt = 0, midAtt = 0, threeAtt = 0;
  let marginSum = 0;
  let gamesPlayed = 0;
  const playerTotals = new Map<string, PlayerProfileTotals>();

  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;
    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;

    const gameSeed = rng.nextInt(1, 2_000_000_000);
    const sim = simulateGame(home, away, homePlayers, awayPlayers, sg.id, 'profile', `day-${sg.day}`, gameSeed);
    gamesPlayed++;

    for (const side of [sim.boxScore.homeTeam, sim.boxScore.awayTeam]) {
      const t = side.totals;
      pts += t.points; fgm += t.fieldGoalsMade; fga += t.fieldGoalsAttempted;
      tpm += t.threePointersMade; tpa += t.threePointersAttempted;
      ftm += t.freeThrowsMade; fta += t.freeThrowsAttempted;
      orb += t.offensiveRebounds; drb += t.defensiveRebounds; reb += t.rebounds;
      ast += t.assists; stl += t.steals; blk += t.blocks; tov += t.turnovers;

      for (const line of side.players) {
        const total = playerTotals.get(line.playerId) ?? {
          teamId: side.teamId,
          games: 0,
          minutes: 0,
          points: 0,
          fga: 0,
          ftm: 0,
          fta: 0,
        };
        total.games++;
        total.minutes += line.minutes;
        total.points += line.stats.points;
        total.fga += line.stats.fieldGoalsAttempted;
        total.ftm += line.stats.freeThrowsMade;
        total.fta += line.stats.freeThrowsAttempted;
        playerTotals.set(line.playerId, total);
      }
    }

    for (const e of sim.playByPlay) {
      if (!e.shotZone) continue;
      if (e.outcome !== 'made_shot' && e.outcome !== 'and_one' && e.outcome !== 'missed_shot') continue;
      const b = zoneBucket(e.shotZone);
      if (b === 'rim') rimAtt++; else if (b === 'mid') midAtt++; else threeAtt++;
    }

    marginSum += Math.abs(sim.result.homeScore - sim.result.awayScore);
  }

  const tg = gamesPlayed * 2; // team-games
  const per = (x: number) => x / tg;
  const possessions = per(fga) + 0.44 * per(fta) + per(tov) - per(orb);
  const totalAtt = rimAtt + midAtt + threeAtt;

  const eng: Record<string, number> = {
    pace: possessions, pts: per(pts), fgPct: fgm / fga, ppp: per(pts) / possessions,
    fga: per(fga), tpa: per(tpa), tpPct: tpm / tpa, fta: per(fta), ftPct: ftm / fta,
    orb: per(orb), drb: per(drb), reb: per(reb), ast: per(ast),
    stl: per(stl), blk: per(blk), tov: per(tov),
    rimShare: rimAtt / totalAtt, midShare: midAtt / totalAtt, threeShare: threeAtt / totalAtt,
    margin: marginSum / gamesPlayed,
  };

  const rows: [string, string][] = [
    ['Pace (poss)', 'pace'], ['Points', 'pts'], ['PPP', 'ppp'],
    ['FGA', 'fga'], ['FG%', 'fgPct'], ['3PA', 'tpa'], ['3P%', 'tpPct'],
    ['FTA', 'fta'], ['FT%', 'ftPct'], ['OREB', 'orb'], ['DREB', 'drb'],
    ['REB', 'reb'], ['AST', 'ast'], ['STL', 'stl'], ['BLK', 'blk'], ['TOV', 'tov'],
    ['Rim share %', 'rimShare'], ['Mid share %', 'midShare'], ['3PA share %', 'threeShare'],
    ['Avg margin', 'margin'],
  ];
  const pctKeys = new Set(['fgPct', 'tpPct', 'ftPct', 'rimShare', 'midShare', 'threeShare']);

  const fmt = (k: string, v: number) =>
    k === 'ppp' ? v.toFixed(3) : pctKeys.has(k) ? (v * 100).toFixed(1) : v.toFixed(1);

  let fails = 0;
  console.log(`Engine profile (${gamesPlayed} games). Pass/fail vs pre-change BASE; Real shown for context.\n`);
  console.log(
    'Stat'.padEnd(13) + 'Engine'.padStart(8) + 'Base'.padStart(8) +
    'ΔBase'.padStart(8) + 'Tol'.padStart(8) + 'Real'.padStart(8) + '  Flag');
  console.log('-'.repeat(62));
  for (const [label, key] of rows) {
    const e = eng[key], base = BASE[key].v, tol = BASE[key].tol, real = REAL[key];
    const delta = e - base;
    const within = Math.abs(delta) <= tol;
    if (!within) fails++;
    const d = key === 'ppp' ? delta.toFixed(3) : pctKeys.has(key) ? (delta * 100).toFixed(1) : delta.toFixed(1);
    const tolStr = key === 'ppp' ? tol.toFixed(3) : pctKeys.has(key) ? (tol * 100).toFixed(1) : tol.toFixed(1);
    console.log(
      label.padEnd(13) +
      fmt(key, e).padStart(8) +
      fmt(key, base).padStart(8) +
      (delta >= 0 ? '+' + d : d).padStart(8) +
      ('±' + tolStr).padStart(8) +
      fmt(key, real).padStart(8) +
      '  ' + (within ? 'OK' : '⚠️ OUT')
    );
  }
  console.log('-'.repeat(62));
  console.log(fails === 0 ? 'ALL WITHIN TOLERANCE (no drift from baseline)' : `${fails} stat(s) DRIFTED OUT OF TOLERANCE`);

  const playerById = new Map(players.map((player) => [player.id, player]));
  const usageQualified = [...playerTotals.entries()].filter(([, total]) => total.minutes >= 500);
  const usageSpearman = spearman(
    usageQualified.map(([playerId]) => playerById.get(playerId)!.tendencies.usageRate),
    usageQualified.map(([, total]) => total.fga / total.minutes),
  );

  const scoringQualified = [...playerTotals.entries()].flatMap(([playerId, total]) => {
    const raw = selectLatestCareerStats(playerById.get(playerId)?.careerStats ?? []);
    if (!raw || raw.minutesPerGame < 15 || total.minutes < 500 || total.games === 0) return [];
    return [{ simPpg: total.points / total.games, realPpg: raw.stats.points }];
  });
  const scoringPearson = pearson(
    scoringQualified.map((row) => row.simPpg),
    scoringQualified.map((row) => row.realPpg),
  );

  const teamPointTotals = new Map<string, number>();
  const teamLeaderPoints = new Map<string, number>();
  for (const total of playerTotals.values()) {
    teamPointTotals.set(total.teamId, (teamPointTotals.get(total.teamId) ?? 0) + total.points);
    teamLeaderPoints.set(total.teamId, Math.max(teamLeaderPoints.get(total.teamId) ?? 0, total.points));
  }
  const topScorerShares = [...teamPointTotals].map(([teamId, total]) =>
    total === 0 ? 0 : (teamLeaderPoints.get(teamId) ?? 0) / total);
  const topScorerShare = topScorerShares.reduce((sum, value) => sum + value, 0) / topScorerShares.length;

  const ftQualified = [...playerTotals.entries()].flatMap(([playerId, total]) => {
    const raw = selectLatestCareerStats(playerById.get(playerId)?.careerStats ?? []);
    if (!raw || raw.stats.freeThrowsAttempted < 2 || total.fta === 0) return [];
    return [{ total, raw }];
  });
  const simFtm = ftQualified.reduce((sum, row) => sum + row.total.ftm, 0);
  const simFta = ftQualified.reduce((sum, row) => sum + row.total.fta, 0);
  const realFtm = ftQualified.reduce(
    (sum, row) => sum + row.raw.stats.freeThrowPct * row.raw.stats.freeThrowsAttempted,
    0,
  );
  const realFta = ftQualified.reduce((sum, row) => sum + row.raw.stats.freeThrowsAttempted, 0);
  const simFtPcts = ftQualified.map((row) => row.total.ftm / row.total.fta);
  const usages = players.map((player) => player.tendencies.usageRate);
  const usageFloorCount = usages.filter((value) => value === 0.10).length;

  console.log('\nPlayer-level distribution');
  console.log('-'.repeat(72));
  console.log(`Usage rate roster min/mean/max: ${Math.min(...usages).toFixed(3)} / ${(usages.reduce((a, b) => a + b, 0) / usages.length).toFixed(3)} / ${Math.max(...usages).toFixed(3)} (${usageFloorCount} at 0.10 floor)`);
  console.log(`Usage vs sim FGA/min Spearman: ${usageSpearman.toFixed(3)} (n=${usageQualified.length}, min 500 sim minutes)`);
  console.log(`Sim PPG vs real PPG Pearson:   ${scoringPearson.toFixed(3)} (n=${scoringQualified.length}, real MPG >= 15, sim minutes >= 500)`);
  console.log(`Team top-scorer points share:  ${(topScorerShare * 100).toFixed(1)}% (real reference 19-22%)`);
  console.log(`Qualified FT% sim vs real:     ${(simFtm / simFta * 100).toFixed(1)}% vs ${(realFtm / realFta * 100).toFixed(1)}% (n=${ftQualified.length}, real FTA >= 2)`);
  console.log(`Qualified sim FT% min/max:     ${(Math.min(...simFtPcts) * 100).toFixed(1)}% / ${(Math.max(...simFtPcts) * 100).toFixed(1)}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
