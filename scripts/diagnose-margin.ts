/**
 * S1-Rb margin decomposition — deterministic diagnostic instrument.
 *
 * Simulates the same fixed-seed 1,290-game season the profile uses (seed 2026,
 * identical schedule + per-game seed sequence) and decomposes WHY the average
 * absolute final margin exceeds the 12.87 ± 1.0 target:
 *
 *   1. Final-margin distribution — sim vs the real 2023-24..2025-26 pooled
 *      `games` contract (3,690 games). Separate populations, not pairs.
 *      Quantile convention (documented, applied to BOTH samples): linear
 *      interpolation between order statistics (R type 7).
 *   2. Margin trajectory — abs margin at each regulation quarter end, growth,
 *      lead expand/contract categories (predeclared: same leader & larger abs
 *      lead = expands; same leader & smaller = contracts; ties and lead
 *      changes counted separately), garbage-time eligibility onset (first
 *      dead ball with quarter >= 4, clock <= 5:00, margin >= 20) vs first
 *      actual starter-out substitution at such a dead ball, and margin drift
 *      from GT onset to final.
 *   3. Team-strength relationship — two-fold cross-fitted net-rating estimate
 *      (strength from one schedule half, evaluated on the other; the game
 *      being evaluated never feeds its own prediction). Signed gap = home
 *      minus away. Blowout predeclared as abs margin >= 20. Home-win
 *      probability from predeclared strength-gap bins.
 *   4. Form and momentum — pregame home-minus-away form differential
 *      (rotation-minute-target-weighted mean of the drawn forms),
 *      possession-weighted and peak momentum differential (home-minus-away,
 *      descriptive only — momentum is endogenous to outcomes), clamp-hit
 *      frequencies. Causal conclusions come from the one-factor experiments
 *      run via constant edits, not from these correlations.
 *
 * Uses the TEMPORARY GameDiagObserver hook in src/engine/index.ts (read-only,
 * consumes no randomness). Both are removed before the final S1-Rb commit.
 *
 * Usage: node --import tsx scripts/diagnose-margin.ts [--games=N] [--label=x]
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SeededRNG } from '../src/lib/rng';
import { simulateGame } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';
import { loadGames } from '../src/data/nba/load';

const SEASONS = ['2023-24', '2024-25', '2025-26'];
const BLOWOUT = 20; // predeclared blowout threshold (abs final margin >= 20)

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p?.split('=')[1];
}

// R type-7 quantile (linear interpolation), shared by both populations.
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let c = 0, vx = 0, vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    c += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  const d = Math.sqrt(vx * vy);
  return d === 0 ? NaN : c / d;
}
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Array<number>(xs.length);
  for (let s = 0; s < idx.length;) {
    let e = s + 1;
    while (e < idx.length && idx[e].v === idx[s].v) e++;
    const r = (s + 1 + e) / 2;
    for (let i = s; i < e; i++) out[idx[i].i] = r;
    s = e;
  }
  return out;
}
function spearman(xs: number[], ys: number[]): number {
  return pearson(ranks(xs), ranks(ys));
}

function distReport(label: string, margins: number[]): void {
  const s = [...margins].sort((a, b) => a - b);
  const shares = [10, 15, 20, 25, 30].map(
    (t) => `>=${t}: ${((s.filter((m) => m >= t).length / s.length) * 100).toFixed(1)}%`,
  );
  console.log(
    `${label.padEnd(26)} n=${s.length}  mean=${mean(s).toFixed(2)}  sd=${sd(s).toFixed(2)}  ` +
    `median=${quantile(s, 0.5).toFixed(1)}  p75=${quantile(s, 0.75).toFixed(1)}  ` +
    `p90=${quantile(s, 0.9).toFixed(1)}  p95=${quantile(s, 0.95).toFixed(1)}  max=${s[s.length - 1]} (descriptive only)`,
  );
  console.log(''.padEnd(26) + shares.join('  '));
}

interface GameRecord {
  homeId: string;
  awayId: string;
  signedMargin: number; // home - away
  absMargin: number;
  homeWin: boolean;
  qMargins: number[];       // abs margin at end of Q1..Q4
  qSigned: number[];        // signed margin at end of Q1..Q4
  gtEligibleAtSec: number | null;  // elapsed game seconds of first GT-eligible dead ball
  gtEligibleMargin: number | null;
  gtSubAtSec: number | null;       // first starter-out sub at a GT-eligible dead ball
  gtSubMargin: number | null;
  formDiff: number;         // home - away, minute-target-weighted
  formClampHits: number;
  formCount: number;
  momMeanDiff: number;      // possession-weighted mean (home - away)
  momPeakAbsDiff: number;
  momClampHits: number;
  momCount: number;
}

async function main() {
  const gamesCap = arg('games') ? parseInt(arg('games')!, 10) : Infinity;
  const label = arg('label') ?? 'baseline';

  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const rng = new SeededRNG(2026);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) {
    if (p.teamId && playersByTeam.has(p.teamId)) playersByTeam.get(p.teamId)!.push(p);
  }
  const schedule = generateSchedule(teams, rng);

  const records: GameRecord[] = [];

  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;
    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;

    // Keep the seed sequence identical to the profile even past the cap.
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    if (records.length >= gamesCap) continue;

    const rec: Partial<GameRecord> = {
      homeId: home.id, awayId: away.id,
      gtEligibleAtSec: null, gtEligibleMargin: null, gtSubAtSec: null, gtSubMargin: null,
      formClampHits: 0, formCount: 0, momClampHits: 0, momCount: 0, momPeakAbsDiff: 0,
    };
    let momSum = 0;

    const homeIds = new Set(homePlayers.map((p) => p.id));
    const wSum = { home: 0, away: 0 };
    const wForm = { home: 0, away: 0 };

    const sim = simulateGame(home, away, homePlayers, awayPlayers, sg.id, 'diag', `day-${sg.day}`, gameSeed, new Map(), {
      onForms: (forms) => {
        for (const [pid, f] of forms) {
          rec.formCount!++;
          if (Math.abs(f) >= 0.13) rec.formClampHits!++;
          const side = homeIds.has(pid) ? 'home' : 'away';
          const team = side === 'home' ? home : away;
          const w = team.rotation.minuteTargets[pid] ?? 0;
          wSum[side] += w;
          wForm[side] += w * f;
        }
      },
      onPossession: (hm, am) => {
        const d = hm - am;
        momSum += d;
        rec.momCount!++;
        if (Math.abs(d) > rec.momPeakAbsDiff!) rec.momPeakAbsDiff = Math.abs(d);
        if (Math.abs(hm) >= 0.02 || Math.abs(am) >= 0.02) rec.momClampHits!++;
      },
      onDeadBall: (quarter, gameClock, margin, starterOutSubs) => {
        const eligible = quarter >= 4 && gameClock / 60 <= 5 && margin >= 20;
        if (!eligible) return;
        const elapsed = (quarter - 1) * 720 + (720 - gameClock);
        if (rec.gtEligibleAtSec === null) {
          rec.gtEligibleAtSec = elapsed;
          rec.gtEligibleMargin = margin;
        }
        if (starterOutSubs > 0 && rec.gtSubAtSec === null) {
          rec.gtSubAtSec = elapsed;
          rec.gtSubMargin = margin;
        }
      },
    });

    // End-of-quarter margins from the event stream's recorded scores.
    const qSigned = [0, 0, 0, 0];
    for (const e of sim.playByPlay) {
      if (e.quarter >= 1 && e.quarter <= 4) qSigned[e.quarter - 1] = e.homeScore - e.awayScore;
    }
    // Quarters with no events inherit the previous quarter's score.
    for (let q = 1; q < 4; q++) if (qSigned[q] === 0 && sim.playByPlay.every((e) => e.quarter !== q + 1)) qSigned[q] = qSigned[q - 1];

    rec.signedMargin = sim.result.homeScore - sim.result.awayScore;
    rec.absMargin = Math.abs(rec.signedMargin);
    rec.homeWin = rec.signedMargin > 0;
    rec.qSigned = qSigned;
    rec.qMargins = qSigned.map(Math.abs);
    rec.formDiff = wForm.home / Math.max(1e-9, wSum.home) - wForm.away / Math.max(1e-9, wSum.away);
    rec.momMeanDiff = momSum / Math.max(1, rec.momCount!);
    records.push(rec as GameRecord);
  }

  console.log(`\n=== S1-Rb margin decomposition [${label}] — ${records.length} games, seed 2026 ===`);

  // ---- 1. Final-margin distribution ---------------------------------------
  console.log('\n--- 1. Final-margin distribution (abs margins; separate populations; R type-7 quantiles) ---');
  distReport(`sim [${label}]`, records.map((r) => r.absMargin));
  try {
    const real: number[] = [];
    for (const season of SEASONS) {
      for (const row of loadGames(season).rows) {
        const [a, b] = row.participants;
        if (a.score === null || b.score === null) continue;
        real.push(Math.abs(a.score - b.score));
      }
    }
    distReport('real 2023-24..2025-26', real);
  } catch (e) {
    console.log(`(real games contract unavailable: ${e})`);
  }

  // ---- 2. Margin trajectory ------------------------------------------------
  console.log('\n--- 2. Margin trajectory (abs margin at end of each regulation quarter) ---');
  for (let q = 0; q < 4; q++) {
    const m = records.map((r) => r.qMargins[q]).sort((a, b) => a - b);
    console.log(`after Q${q + 1}: mean=${mean(m).toFixed(2)}  p75=${quantile(m, 0.75).toFixed(1)}  p90=${quantile(m, 0.9).toFixed(1)}  p95=${quantile(m, 0.95).toFixed(1)}`);
  }
  const growth = [1, 2, 3].map((q) => mean(records.map((r) => r.qMargins[q] - r.qMargins[q - 1])));
  console.log(`mean quarter-to-quarter growth: Q1->Q2 ${growth[0].toFixed(2)}, Q2->Q3 ${growth[1].toFixed(2)}, Q3->Q4 ${growth[2].toFixed(2)}`);

  for (let q = 1; q < 4; q++) {
    let expands = 0, contracts = 0, ties = 0, leadChanges = 0, fromTie = 0;
    for (const r of records) {
      const prev = r.qSigned[q - 1], cur = r.qSigned[q];
      if (prev === 0) { fromTie++; continue; }
      if (cur === 0) { ties++; continue; }
      if (Math.sign(prev) !== Math.sign(cur)) { leadChanges++; continue; }
      if (Math.abs(cur) > Math.abs(prev)) expands++;
      else if (Math.abs(cur) < Math.abs(prev)) contracts++;
      else ties++; // unchanged abs lead counted with ties (rare)
    }
    const n = records.length;
    console.log(`Q${q}->Q${q + 1}: expands ${(expands / n * 100).toFixed(1)}%  contracts ${(contracts / n * 100).toFixed(1)}%  leadChange ${(leadChanges / n * 100).toFixed(1)}%  tie/unchanged ${(ties / n * 100).toFixed(1)}%  wasTied ${(fromTie / n * 100).toFixed(1)}%`);
  }

  const gtEligible = records.filter((r) => r.gtEligibleAtSec !== null);
  const gtSubbed = records.filter((r) => r.gtSubAtSec !== null);
  console.log(`\ngarbage time: eligible in ${gtEligible.length}/${records.length} games (${(gtEligible.length / records.length * 100).toFixed(1)}%); ` +
    `actual starter-out sub in ${gtSubbed.length} (${(gtSubbed.length / records.length * 100).toFixed(1)}%)`);
  if (gtEligible.length) {
    console.log(`  first eligibility: mean elapsed ${(mean(gtEligible.map((r) => r.gtEligibleAtSec!)) / 60).toFixed(1)} min, mean margin then ${mean(gtEligible.map((r) => r.gtEligibleMargin!)).toFixed(1)}`);
    console.log(`  margin drift eligibility->final: mean ${mean(gtEligible.map((r) => r.absMargin - r.gtEligibleMargin!)).toFixed(2)}`);
  }
  if (gtSubbed.length) {
    console.log(`  margin drift first-GT-sub->final: mean ${mean(gtSubbed.map((r) => r.absMargin - r.gtSubMargin!)).toFixed(2)}`);
  }
  const blowouts = records.filter((r) => r.absMargin >= BLOWOUT);
  console.log(`  final blowouts (>=${BLOWOUT}): ${blowouts.length} (${(blowouts.length / records.length * 100).toFixed(1)}%); of those, GT-eligible before end: ${blowouts.filter((r) => r.gtEligibleAtSec !== null).length}`);

  // ---- 3. Team-strength relationship (two-fold cross-fit) ------------------
  console.log('\n--- 3. Team strength (two-fold cross-fitted net rating; signed gap = home - away) ---');
  const foldOf = (i: number) => i % 2;
  const strength: Array<Map<string, number>> = [new Map(), new Map()];
  for (const f of [0, 1]) {
    const sum = new Map<string, number>(), cnt = new Map<string, number>();
    records.forEach((r, i) => {
      if (foldOf(i) !== f) return;
      sum.set(r.homeId, (sum.get(r.homeId) ?? 0) + r.signedMargin);
      cnt.set(r.homeId, (cnt.get(r.homeId) ?? 0) + 1);
      sum.set(r.awayId, (sum.get(r.awayId) ?? 0) - r.signedMargin);
      cnt.set(r.awayId, (cnt.get(r.awayId) ?? 0) + 1);
    });
    for (const [id, s] of sum) strength[f].set(id, s / cnt.get(id)!);
  }
  // Evaluate each game with the OTHER fold's estimates.
  const gaps: number[] = [], signedMs: number[] = [], homeWins: number[] = [];
  records.forEach((r, i) => {
    const est = strength[1 - foldOf(i)];
    const gap = (est.get(r.homeId) ?? 0) - (est.get(r.awayId) ?? 0);
    gaps.push(gap);
    signedMs.push(r.signedMargin);
    homeWins.push(r.homeWin ? 1 : 0);
  });
  const absGaps = gaps.map(Math.abs);
  const absMs = records.map((r) => r.absMargin);
  const blows = records.map((r) => (r.absMargin >= BLOWOUT ? 1 : 0));
  console.log(`signed gap vs signed margin: pearson ${pearson(gaps, signedMs).toFixed(3)}  spearman ${spearman(gaps, signedMs).toFixed(3)}`);
  console.log(`abs gap vs abs margin:       pearson ${pearson(absGaps, absMs).toFixed(3)}  spearman ${spearman(absGaps, absMs).toFixed(3)}`);
  console.log(`abs gap vs blowout(>=${BLOWOUT}):   pearson ${pearson(absGaps, blows).toFixed(3)}`);
  console.log(`slope margin-per-unit-gap:   ${(pearson(gaps, signedMs) * sd(signedMs) / sd(gaps)).toFixed(3)} (OLS)`);
  // Predeclared strength-gap bins for home-win probability.
  const bins: Array<[number, number]> = [[-99, -8], [-8, -4], [-4, 0], [0, 4], [4, 8], [8, 99]];
  console.log('home-win rate by signed strength-gap bin:');
  for (const [lo, hi] of bins) {
    const inBin = records.filter((_, i) => gaps[i] >= lo && gaps[i] < hi);
    const wins = inBin.filter((r) => r.homeWin).length;
    const blowN = inBin.filter((r) => r.absMargin >= BLOWOUT).length;
    console.log(`  [${String(lo).padStart(3)}, ${String(hi).padStart(3)}): n=${String(inBin.length).padStart(4)}  homeWin=${inBin.length ? (wins / inBin.length * 100).toFixed(1) : '-'}%  blowout=${inBin.length ? (blowN / inBin.length * 100).toFixed(1) : '-'}%`);
  }

  // ---- 4. Form & momentum (descriptive; causal via one-factor experiments) --
  console.log('\n--- 4. Form & momentum (home-minus-away orientation throughout) ---');
  const formDiffs = records.map((r) => r.formDiff);
  console.log(`pregame form diff: mean ${mean(formDiffs).toFixed(4)}  sd ${sd(formDiffs).toFixed(4)}`);
  console.log(`  vs signed margin: pearson ${pearson(formDiffs, signedMs).toFixed(3)}`);
  console.log(`  |form diff| vs abs margin: pearson ${pearson(formDiffs.map(Math.abs), absMs).toFixed(3)}  vs blowout: ${pearson(formDiffs.map(Math.abs), blows).toFixed(3)}`);
  const clampRate = records.reduce((a, r) => a + r.formClampHits, 0) / records.reduce((a, r) => a + r.formCount, 0);
  console.log(`  form clamp (|f|>=0.13) hit rate: ${(clampRate * 100).toFixed(2)}% of player-games`);
  const momMeans = records.map((r) => r.momMeanDiff);
  console.log(`momentum (descriptive, endogenous — NOT causal evidence):`);
  console.log(`  possession-weighted mean diff vs signed margin: pearson ${pearson(momMeans, signedMs).toFixed(3)}`);
  console.log(`  peak |diff|: mean ${mean(records.map((r) => r.momPeakAbsDiff)).toFixed(4)}  vs abs margin: pearson ${pearson(records.map((r) => r.momPeakAbsDiff), absMs).toFixed(3)}`);
  const momClampRate = records.reduce((a, r) => a + r.momClampHits, 0) / records.reduce((a, r) => a + r.momCount, 0);
  console.log(`  momentum clamp (either side at |0.02|) share of possessions: ${(momClampRate * 100).toFixed(2)}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
