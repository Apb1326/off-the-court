/**
 * Reads the downloaded historical datasets and derives real league benchmarks
 * (scoring level, scoring variance, home-court win %, margin spread) by era,
 * then runs the current engine and prints a side-by-side comparison so the
 * simulation can be tuned against six decades of real games.
 *
 * Run `npm run download-history` first to fetch the source CSVs.
 */
import { readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Team } from '../src/models/team';
import { Player } from '../src/models/player';
import { simulateGame } from '../src/engine';
import { SeededRNG } from '../src/lib/rng';
import { loadActivationContext, printActivationContextBanner } from './s2d-activation-context';

// Fixed seed for matchup selection so the engine benchmark is reproducible
// run-to-run and comparable across engine changes.
const CALIBRATION_SEED = 0x0ca11b;

const HISTORY_DIR = path.join(process.cwd(), 'data', 'history');
const DATA_DIR = path.join(process.cwd(), 'data');

// ---- tiny CSV reader (these files have no quoted/embedded commas) ----
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    rows.push(lines[i].split(','));
  }
  return { header, rows };
}

interface Stats { n: number; mean: number; sd: number; }
function summarize(values: number[]): Stats {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { n, mean, sd: Math.sqrt(variance) };
}

interface EraBenchmark {
  label: string;
  games: number;
  ptsPerTeam: Stats;       // points scored by a team in a game
  margin: Stats;           // absolute final margin
  homeWinPct: number;      // share of games won by the home team
  homeScoreAdv: number;    // mean(home pts) - mean(away pts)
}

function analyzeGames(): { eras: EraBenchmark[]; raw: { header: string[]; rows: string[][] } } {
  const text = readFileSync(path.join(HISTORY_DIR, 'nbaallelo.csv'), 'utf-8');
  const { header, rows } = parseCsv(text);
  const idx = (name: string) => header.indexOf(name);
  const iCopy = idx('_iscopy');
  const iYear = idx('year_id');
  const iPts = idx('pts');
  const iOpp = idx('opp_pts');
  const iLoc = idx('game_location');
  const iRes = idx('game_result');
  const iPlayoff = idx('is_playoffs');

  // Era buckets (regular season only). One non-copy row per game.
  const eras: { label: string; min: number; max: number }[] = [
    { label: 'All-time (1947-2015)', min: 0, max: 9999 },
    { label: '1980s', min: 1980, max: 1989 },
    { label: '1990s', min: 1990, max: 1999 },
    { label: '2000s', min: 2000, max: 2009 },
    { label: '2010-2015', min: 2010, max: 2015 },
  ];

  const acc = eras.map(() => ({
    teamPts: [] as number[],
    margins: [] as number[],
    homeWins: 0,
    homeGames: 0,
    homePtsSum: 0,
    awayPtsSum: 0,
  }));

  for (const r of rows) {
    if (r[iCopy] !== '0') continue;          // dedupe: one row per game
    if (r[iPlayoff] !== '0') continue;        // regular season only
    const year = parseInt(r[iYear], 10);
    const pts = parseInt(r[iPts], 10);
    const opp = parseInt(r[iOpp], 10);
    const loc = r[iLoc];
    const res = r[iRes];
    if (!Number.isFinite(pts) || !Number.isFinite(opp)) continue;

    for (let e = 0; e < eras.length; e++) {
      if (year < eras[e].min || year > eras[e].max) continue;
      const a = acc[e];
      // Both teams' point totals contribute to scoring distribution
      a.teamPts.push(pts, opp);
      a.margins.push(Math.abs(pts - opp));
      // Home/away split only when this non-copy row is a home or away game
      if (loc === 'H') {
        a.homeGames++;
        if (res === 'W') a.homeWins++;
        a.homePtsSum += pts;
        a.awayPtsSum += opp;
      } else if (loc === 'A') {
        a.homeGames++;
        if (res === 'L') a.homeWins++; // opponent (home) won
        a.homePtsSum += opp;
        a.awayPtsSum += pts;
      }
    }
  }

  const out: EraBenchmark[] = eras.map((era, e) => {
    const a = acc[e];
    return {
      label: era.label,
      games: a.margins.length,
      ptsPerTeam: summarize(a.teamPts),
      margin: summarize(a.margins),
      homeWinPct: a.homeGames > 0 ? a.homeWins / a.homeGames : 0,
      homeScoreAdv: a.homeGames > 0 ? (a.homePtsSum - a.awayPtsSum) / a.homeGames : 0,
    };
  });

  return { eras: out, raw: { header, rows } };
}

function analyzeRaptor() {
  const file = path.join(HISTORY_DIR, 'historical_RAPTOR_by_player.csv');
  const text = readFileSync(file, 'utf-8');
  const { header, rows } = parseCsv(text);
  const idx = (n: string) => header.indexOf(n);
  const iSeason = idx('season');
  const iTotal = idx('raptor_total');
  const iWar = idx('war_total');

  const seasons = new Set<number>();
  const totals: number[] = [];
  let starSeasons = 0; // raptor_total >= +5 (All-NBA-ish)
  for (const r of rows) {
    const s = parseInt(r[iSeason], 10);
    const t = parseFloat(r[iTotal]);
    if (Number.isFinite(s)) seasons.add(s);
    if (Number.isFinite(t)) {
      totals.push(t);
      if (t >= 5) starSeasons++;
    }
  }
  const sorted = [...totals].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;
  return {
    playerSeasons: rows.length,
    seasonRange: [Math.min(...seasons), Math.max(...seasons)] as [number, number],
    raptorTotal: { p10: pct(0.10), median: pct(0.5), p90: pct(0.9), p99: pct(0.99) },
    starSeasons,
  };
}

async function simBenchmark(teams: Team[], players: Player[]): Promise<EraBenchmark> {
  const byTeam = new Map<string, Player[]>();
  for (const t of teams) byTeam.set(t.id, []);
  for (const p of players) if (p.teamId && byTeam.has(p.teamId)) byTeam.get(p.teamId)!.push(p);

  const teamPts: number[] = [];
  const margins: number[] = [];
  let homeWins = 0;
  let homePtsSum = 0;
  let awayPtsSum = 0;
  const N = 400;
  const rng = new SeededRNG(CALIBRATION_SEED);

  for (let i = 0; i < N; i++) {
    const a = teams[Math.floor(rng.next() * teams.length)];
    let b = teams[Math.floor(rng.next() * teams.length)];
    while (b.id === a.id) b = teams[Math.floor(rng.next() * teams.length)];
    const ap = byTeam.get(a.id)!;
    const bp = byTeam.get(b.id)!;
    if (ap.length < 5 || bp.length < 5) continue;
    const r = simulateGame(a, b, ap, bp, `cal${i}`, 'cal', '2025-01-01', i + 1);
    teamPts.push(r.result.homeScore, r.result.awayScore);
    margins.push(Math.abs(r.result.homeScore - r.result.awayScore));
    if (r.result.homeScore > r.result.awayScore) homeWins++;
    homePtsSum += r.result.homeScore;
    awayPtsSum += r.result.awayScore;
  }

  return {
    label: `Engine (sim, ${margins.length} games)`,
    games: margins.length,
    ptsPerTeam: summarize(teamPts),
    margin: summarize(margins),
    homeWinPct: homeWins / margins.length,
    homeScoreAdv: (homePtsSum - awayPtsSum) / margins.length,
  };
}

function row(b: EraBenchmark): string {
  return [
    b.label.padEnd(24),
    String(b.games).padStart(6),
    b.ptsPerTeam.mean.toFixed(1).padStart(7),
    b.ptsPerTeam.sd.toFixed(1).padStart(6),
    b.margin.mean.toFixed(1).padStart(7),
    (b.homeWinPct * 100).toFixed(1).padStart(7),
    b.homeScoreAdv.toFixed(1).padStart(8),
  ].join(' ');
}

async function main() {
  if (process.argv.length > 2) throw new Error(`Unknown argument: ${process.argv[2]}`);
  // Same activation-context gate as profile: calibrate persists benchmark
  // artifacts, so it too must prove which pool/selector/table produced them.
  const pool = await loadActivationContext();
  printActivationContextBanner(pool);
  if (!existsSync(path.join(HISTORY_DIR, 'nbaallelo.csv'))) {
    console.error('Missing data/history/nbaallelo.csv. Run: npm run download-history');
    process.exit(1);
  }

  console.log('Analyzing real historical games...\n');
  const { eras } = analyzeGames();
  const raptor = analyzeRaptor();

  const header = [
    'Era'.padEnd(24), 'Games'.padStart(6), 'PTS/tm'.padStart(7),
    'SD'.padStart(6), 'Margin'.padStart(7), 'Home%'.padStart(7), 'HomeAdv'.padStart(8),
  ].join(' ');

  console.log('=== REAL NBA BENCHMARKS (regular season) ===');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const e of eras) console.log(row(e));

  console.log('\n=== PLAYER QUALITY (historical RAPTOR 1977-2022) ===');
  console.log(`  ${raptor.playerSeasons.toLocaleString()} player-seasons, ${raptor.seasonRange[0]}-${raptor.seasonRange[1]}`);
  console.log(`  RAPTOR total: p10 ${raptor.raptorTotal.p10.toFixed(1)} | median ${raptor.raptorTotal.median.toFixed(1)} | p90 ${raptor.raptorTotal.p90.toFixed(1)} | p99 ${raptor.raptorTotal.p99.toFixed(1)}`);
  console.log(`  Star-level seasons (RAPTOR ≥ +5): ${raptor.starSeasons}`);

  console.log('\nRunning engine for comparison...');
  const sim = await simBenchmark(pool.teams, pool.players);
  const modern = eras.find((e) => e.label === '2010-2015')!;

  console.log('\n=== ENGINE vs REAL (2010-2015 era) ===');
  console.log(header);
  console.log('-'.repeat(header.length));
  console.log(row(modern));
  console.log(row(sim));

  // Persist benchmarks so they can serve as calibration targets.
  const benchmarks = {
    source: 'FiveThirtyeight open data (CC BY 4.0)',
    generatedAt: new Date().toISOString(),
    eras,
    raptor,
    engineSample: sim,
  };
  await writeFile(
    path.join(HISTORY_DIR, 'benchmarks.json'),
    JSON.stringify(benchmarks, null, 2),
  );
  console.log('\nSaved data/history/benchmarks.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
