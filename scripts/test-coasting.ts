/**
 * Targeted regression harness for the S1-Rb effort/coasting mechanism
 * (COAST_LEAD_START / COAST_LEAD_FULL / COAST_SHOT_EFFORT_MAX): proves the
 * mechanism itself behaves — not merely that the profile passed.
 *
 * 1. UNIT — the effortMod term is live, additive, and correctly signed inside
 *    resolveShot: with identical seeds, effortMod -MAX vs +MAX must shift the
 *    realized make rate by ~2×MAX (within sampling tolerance), and effortMod 0
 *    must reproduce the no-arg baseline exactly (same seed → same outcomes).
 * 2. RAMP — the documented dead zone and cap: leads <= COAST_LEAD_START give
 *    zero modifier; leads >= COAST_LEAD_FULL give exactly ±MAX; the ramp is
 *    monotone and equal-and-opposite for leader and trailer.
 * 3. BEHAVIOR — on a fixed-seed slice of the profile schedule, big leads must
 *    stop compounding: mean margin drift from the first time a game reaches a
 *    20-point gap to the final buzzer must be <= +1.0 (pre-repair engine:
 *    leads kept growing), and the >= 30-point blowout share must stay under
 *    10% (pre-repair: ~14%). Deterministic: fixed seed, fixed thresholds.
 *
 * Run: node --import tsx scripts/test-coasting.ts
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SeededRNG } from '../src/lib/rng';
import { simulateGame } from '../src/engine';
import { resolveShot } from '../src/engine/shot';
import { generateSchedule } from '../src/engine/schedule';
import { COAST_LEAD_START, COAST_LEAD_FULL, COAST_SHOT_EFFORT_MAX } from '../src/engine/constants';

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures++;
}

// The same ramp the engine computes in possession.ts (offense-perspective
// scoreDiff -> additive make-prob modifier).
function coastMod(scoreDiff: number): number {
  const ramp = Math.min(1, Math.max(0,
    (Math.abs(scoreDiff) - COAST_LEAD_START) / (COAST_LEAD_FULL - COAST_LEAD_START)));
  return -Math.sign(scoreDiff) * COAST_SHOT_EFFORT_MAX * ramp;
}

function averagePlayer(id: string, teamId: string): Player {
  const ratings = {
    interiorScoring: 40, midrangeShooting: 40, outsideShooting: 40,
    freeThrowShooting: 40, ballHandling: 40, passing: 40, offensiveIQ: 40,
    interiorDefense: 40, perimeterDefense: 40, steal: 40, block: 40,
    defensiveIQ: 40, athleticism: 40, strength: 40, speed: 40,
    stamina: 40, durability: 40,
  };
  return {
    id, firstName: 'Avg', lastName: id, teamId, position: 'SF',
    age: 27, heightCm: 200, weightKg: 100,
    ratings,
    tendencies: {
      usageRate: 0.2, threePointRate: 0.3, midrangeRate: 0.3, rimRate: 0.4,
      isolationFreq: 0.1, pickAndRollBallHandlerFreq: 0.1, pickAndRollRollManFreq: 0.1,
      postUpFreq: 0.1, spotUpFreq: 0.1, transitionFreq: 0.1, cutFreq: 0.1,
      offScreenFreq: 0.1, handoffFreq: 0.1, drawFoulRate: 0.1,
    },
    careerStats: [],
  } as unknown as Player;
}

async function main() {
  // --- 1. UNIT: effortMod is live, additive, correctly signed ---------------
  const shooter = averagePlayer('S', 'A');
  const defender = averagePlayer('D', 'B');
  const N = 40_000;
  const makeRate = (effort: number | undefined): number => {
    const rng = new SeededRNG(777); // identical stream per arm
    let made = 0;
    for (let i = 0; i < N; i++) {
      const r = resolveShot(shooter, 0, defender, 0, 'short_midrange', 'isolation', rng, 0,
        effort === undefined ? {} : { effortMod: effort });
      if (!r.blocked && r.made) made++;
    }
    return made / N;
  };
  const base = makeRate(undefined);
  const zero = makeRate(0);
  const minus = makeRate(-COAST_SHOT_EFFORT_MAX);
  const plus = makeRate(+COAST_SHOT_EFFORT_MAX);
  check('unit: effortMod 0 == no-arg baseline', zero === base,
    `zero=${zero.toFixed(4)} base=${base.toFixed(4)}`);
  const shift = plus - minus;
  const expected = 2 * COAST_SHOT_EFFORT_MAX;
  check('unit: ±MAX shifts make rate by ~2×MAX', Math.abs(shift - expected) < 0.012,
    `observed ${shift.toFixed(4)} vs expected ${expected.toFixed(4)} (±0.012)`);
  check('unit: sign is coast-negative / press-positive', minus < base && plus > base,
    `minus=${minus.toFixed(4)} base=${base.toFixed(4)} plus=${plus.toFixed(4)}`);

  // --- 2. RAMP: dead zone, cap, symmetry ------------------------------------
  check('ramp: dead zone at/below START', coastMod(COAST_LEAD_START) === 0 && coastMod(5) === 0 && coastMod(-5) === 0,
    `mod(${COAST_LEAD_START})=${coastMod(COAST_LEAD_START)}`);
  check('ramp: cap at/above FULL', coastMod(COAST_LEAD_FULL) === -COAST_SHOT_EFFORT_MAX && coastMod(40) === -COAST_SHOT_EFFORT_MAX,
    `mod(${COAST_LEAD_FULL})=${coastMod(COAST_LEAD_FULL)}`);
  const mids = [10, 14, 18, 22];
  const monotone = mids.every((d, i) => i === 0 || coastMod(d) <= coastMod(mids[i - 1]));
  check('ramp: monotone between START and FULL', monotone,
    mids.map((d) => `${d}:${coastMod(d).toFixed(3)}`).join(' '));
  const symmetric = [12, 20, 30].every((d) => coastMod(d) === -coastMod(-d));
  check('ramp: equal-and-opposite for leader/trailer', symmetric,
    [12, 20, 30].map((d) => `${d}:${coastMod(d).toFixed(3)}/${coastMod(-d).toFixed(3)}`).join(' '));

  // --- 3. BEHAVIOR: big leads stop compounding ------------------------------
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

  const GAMES = 400;
  let played = 0;
  const drifts: number[] = [];
  let blow30 = 0;
  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;
    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    if (played >= GAMES) continue;
    played++;

    const sim = simulateGame(home, away, homePlayers, awayPlayers, sg.id, 'coast', `day-${sg.day}`, gameSeed);
    const finalMargin = Math.abs(sim.result.homeScore - sim.result.awayScore);
    if (finalMargin >= 30) blow30++;
    for (const e of sim.playByPlay) {
      const m = Math.abs(e.homeScore - e.awayScore);
      if (m >= 20) { drifts.push(finalMargin - m); break; }
    }
  }
  const meanDrift = drifts.reduce((a, b) => a + b, 0) / Math.max(1, drifts.length);
  check('behavior: 20-point leads stop compounding (mean drift <= +1.0)', meanDrift <= 1.0,
    `mean drift ${meanDrift.toFixed(2)} over ${drifts.length} games reaching 20 (of ${played})`);
  check('behavior: >=30-point blowout share < 10%', blow30 / played < 0.10,
    `${blow30}/${played} = ${((blow30 / played) * 100).toFixed(1)}% (pre-repair ~14%)`);

  console.log(failures === 0 ? '\nCOASTING HARNESS PASSED' : `\nCOASTING HARNESS FAILED (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
