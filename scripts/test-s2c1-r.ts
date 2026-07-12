/** Focused S2c1-R selector, determinism, and no-drift checks. */
import assert from 'assert';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Player } from '../src/models/player';
import { PlayType } from '../src/models/game';
import { simulateGame } from '../src/engine';
import {
  CANDIDATE_PLAY_TYPE_SELECTION,
  LEGACY_PLAY_TYPE_SELECTION,
  checkTransitionOpportunity,
  explainCandidatePlayTypeSelection,
} from '../src/engine/play-types';
import { PLAY_TYPE_SHOT_ZONES, PLAY_TYPE_SHOT_ZONES_REAL } from '../src/engine/constants';
import { generateSchedule } from '../src/engine/schedule';
import { SeededRNG } from '../src/lib/rng';
import { loadLeaguePool } from './league-pool';

const PLAY_TYPES: PlayType[] = ['isolation', 'pick_and_roll', 'post_up', 'spot_up', 'transition', 'cut', 'off_screen', 'handoff'];
const TARGETS: Record<PlayType, number> = { isolation: .0819, pick_and_roll: .254, post_up: .0424, spot_up: .2561, transition: .1966, cut: .0732, off_screen: .0408, handoff: .055, putback: 0 };
const TERMINAL = new Set(['made_shot', 'missed_shot', 'and_one', 'turnover']);
const SEEDS = [2026, 7, 42]; // predeclared before candidate acceptance runs
const BASELINES = {
  profileStdout: '7482a68d7859ff8c8f962832ff4978ba32621c700594fd4deae785e82759e95a',
  profileStderr: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  calibrateStdout: 'a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4',
  calibrateStderr: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function assertFinite(value: unknown, label: string): void { assert.equal(typeof value, 'number', `${label} must be numeric`); assert(Number.isFinite(value), `${label} must be finite`); }

async function main(): Promise<void> {
  // S2c2 dual-table invariants. weightedChoice self-normalizes, so these are
  // semantic-share invariants: the table weights are documented and reported
  // as per-type diet shares, and a silent sum drift would rescale that
  // reading. The reference-identity check pins the AGENTS.md guard that the
  // seven unshaded diets are structurally shared and cannot drift apart.
  const S2C2_OVERRIDDEN = new Set<string>(['cut', 'spot_up']);
  for (const [tableName, table] of [['PLAY_TYPE_SHOT_ZONES', PLAY_TYPE_SHOT_ZONES], ['PLAY_TYPE_SHOT_ZONES_REAL', PLAY_TYPE_SHOT_ZONES_REAL]] as const) {
    for (const [playType, zones] of Object.entries(table)) {
      const sum = zones.reduce((acc, zone) => acc + zone.weight, 0);
      assert(Math.abs(sum - 1) <= 5e-4, `${tableName}.${playType} weights sum to ${sum.toFixed(6)}, expected 1 ± 0.0005`);
    }
  }
  for (const playType of Object.keys(PLAY_TYPE_SHOT_ZONES) as (keyof typeof PLAY_TYPE_SHOT_ZONES)[]) {
    if (S2C2_OVERRIDDEN.has(playType)) {
      assert.notStrictEqual(PLAY_TYPE_SHOT_ZONES_REAL[playType], PLAY_TYPE_SHOT_ZONES[playType], `${playType} must carry a distinct real diet`);
    } else {
      assert.strictEqual(PLAY_TYPE_SHOT_ZONES_REAL[playType], PLAY_TYPE_SHOT_ZONES[playType], `${playType} must be structurally shared between the tables`);
    }
  }
  console.log('S2c2 dual-table invariants: OK');

  const candidate = await loadLeaguePool(['--league-dir', 'data/league-candidate']);
  const active = await loadLeaguePool([]);
  const teamById = new Map(candidate.teams.map((team) => [team.id, team]));
  const playersByTeam = new Map<string, Player[]>();
  for (const team of candidate.teams) playersByTeam.set(team.id, []);
  for (const player of candidate.players) if (playersByTeam.has(player.teamId)) playersByTeam.get(player.teamId)!.push(player);

  const season = (seed: number): { shares: Record<PlayType, number>; output: string; teamShares: Map<string, Record<PlayType, number>> } => {
    const rng = new SeededRNG(seed);
    const schedule = generateSchedule(candidate.teams, rng);
    const counts = new Map<PlayType, number>();
    const teamCounts = new Map<string, Map<PlayType, number>>();
    let total = 0;
    for (const game of schedule) {
      const home = teamById.get(game.homeTeamId)!;
      const away = teamById.get(game.awayTeamId)!;
      const hp = playersByTeam.get(home.id)!;
      const ap = playersByTeam.get(away.id)!;
      const gameSeed = rng.nextInt(1, 2_000_000_000);
      const result = simulateGame(home, away, hp, ap, game.id, 's2c1-r-test', `day-${game.day}`, gameSeed, new Map(), undefined, CANDIDATE_PLAY_TYPE_SELECTION);
      for (const event of result.playByPlay) {
        if (!TERMINAL.has(event.outcome)) continue;
        total++;
        counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
        const row = teamCounts.get(event.possessionTeamId) ?? new Map<PlayType, number>();
        row.set(event.type, (row.get(event.type) ?? 0) + 1);
        teamCounts.set(event.possessionTeamId, row);
      }
    }
    const shares = Object.fromEntries(PLAY_TYPES.map((type) => [type, (counts.get(type) ?? 0) / total])) as Record<PlayType, number>;
    const teamShares = new Map([...teamCounts].map(([teamId, row]) => {
      const teamTotal = [...row.values()].reduce((a, b) => a + b, 0);
      return [teamId, Object.fromEntries(PLAY_TYPES.map((type) => [type, (row.get(type) ?? 0) / teamTotal])) as Record<PlayType, number>];
    }));
    return { shares, output: JSON.stringify({ counts: Object.fromEntries(counts), shares }), teamShares };
  };

  for (const [index, seed] of SEEDS.entries()) {
    const run = season(seed);
    const absoluteError = PLAY_TYPES.reduce((sum, type) => sum + Math.abs(run.shares[type] - TARGETS[type]), 0);
    assert(absoluteError <= 0.10, `${seed}: total absolute error ${(absoluteError * 100).toFixed(2)}pp exceeds 10pp`);
    for (const type of PLAY_TYPES) {
      const limit = type === 'transition' ? 0.03 : 0.02;
      const extraSeedLimit = index === 0 ? limit : limit + 0.01;
      assert(Math.abs(run.shares[type] - TARGETS[type]) <= extraSeedLimit, `${seed}: ${type} ${(run.shares[type] * 100).toFixed(2)}% outside ${(extraSeedLimit * 100).toFixed(1)}pp band`);
    }
    const variation = PLAY_TYPES.map((type) => [...run.teamShares.values()].map((row) => row[type])).reduce((sum, values) => sum + Math.sqrt(values.reduce((acc, value) => acc + (value - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) / values.length), 0);
    assert(variation > 0.01, `${seed}: team-level play-type variation collapsed`);
    console.log(`seed ${seed}: ${PLAY_TYPES.map((type) => `${type} ${(run.shares[type] * 100).toFixed(1)}%`).join(' ')}; total abs ${(absoluteError * 100).toFixed(1)}pp`);
    if (index === 0) {
      const repeat = season(seed);
      assert.equal(repeat.output, run.output, 'same seed + candidate config must be byte-identical');
    }
  }

  const source = active.players[0];
  const synthetic = JSON.parse(JSON.stringify(source)) as Player;
  synthetic.tendencies = { ...synthetic.tendencies, isolationFreq: 0, pickAndRollBallHandlerFreq: 0.2, pickAndRollScreenerFreq: 0.1, postUpFreq: 0.3, spotUpFreq: 0.4, transitionFreq: 0.5, cutFreq: 0.6, offScreenFreq: 0.7, handoffFreq: 0.8, usageRate: 0.2 };
  const factors = explainCandidatePlayTypeSelection([synthetic], active.teams[0].offensiveSystem, { scoreDiff: 0, gameClock: 1000, quarter: 1 });
  for (const factor of factors) {
    assertFinite(factor.tendency, `${factor.playType} tendency`);
    assertFinite(factor.finalWeight, `${factor.playType} weight`);
    assert(factor.finalWeight >= 0, `${factor.playType} weight must be non-negative`);
  }
  const zero = JSON.parse(JSON.stringify(synthetic)) as Player;
  zero.tendencies = Object.fromEntries(Object.keys(zero.tendencies).map((key) => [key, 0])) as unknown as Player['tendencies'];
  for (const factor of explainCandidatePlayTypeSelection([zero], active.teams[0].offensiveSystem, { scoreDiff: 0, gameClock: 1000, quarter: 1 })) assertFinite(factor.finalWeight, 'zero-vector weight');

  const transitionPlayers = [synthetic, synthetic, synthetic, synthetic, synthetic];
  const rngA = new SeededRNG(1234);
  assert.equal(checkTransitionOpportunity(transitionPlayers, false, false, rngA, CANDIDATE_PLAY_TYPE_SELECTION), false, 'candidate transition must require existing precursor');
  assert.equal(rngA.next(), new SeededRNG(1234).next(), 'no transition precursor must not consume RNG');

  const activeHome = active.teams[0];
  const activeAway = active.teams[1];
  const activePlayersById = new Map(active.players.map((player) => [player.id, player]));
  const activeHomePlayers = activeHome.roster.map((id) => activePlayersById.get(id)!).filter(Boolean);
  const activeAwayPlayers = activeAway.roster.map((id) => activePlayersById.get(id)!).filter(Boolean);
  const legacyA = simulateGame(activeHome, activeAway, activeHomePlayers, activeAwayPlayers, 's2c1-default', 'test', '2025-01-01', 9876);
  const legacyB = simulateGame(activeHome, activeAway, activeHomePlayers, activeAwayPlayers, 's2c1-default', 'test', '2025-01-01', 9876, new Map(), undefined, LEGACY_PLAY_TYPE_SELECTION);
  assert.equal(JSON.stringify(legacyA), JSON.stringify(legacyB), 'explicit legacy config must preserve default result');
  const observed = simulateGame(activeHome, activeAway, activeHomePlayers, activeAwayPlayers, 's2c1-diag', 'test', '2025-01-01', 9876, new Map(), { onEvent: () => undefined });
  const plain = simulateGame(activeHome, activeAway, activeHomePlayers, activeAwayPlayers, 's2c1-diag', 'test', '2025-01-01', 9876);
  assert.equal(JSON.stringify(observed), JSON.stringify(plain), 'diagnostic observer must not change result');

  const runCommand = (script: string): { stdout: Buffer; stderr: Buffer; status: number } => {
    try {
      return { stdout: execFileSync(process.execPath, ['--import', 'tsx', script], { encoding: 'buffer' }), stderr: Buffer.alloc(0), status: 0 };
    } catch (error) {
      const err = error as { stdout?: Buffer; stderr?: Buffer; status?: number };
      return { stdout: err.stdout ?? Buffer.alloc(0), stderr: err.stderr ?? Buffer.alloc(0), status: err.status ?? 1 };
    }
  };
  const profile = runCommand('scripts/profile-engine.ts');
  assert.equal(profile.status, 0, 'default profile must pass');
  // S2c2 appends a provenance-observer informational table. The S2c1-R
  // legacy contract remains the pre-existing output, which must stay bytewise
  // identical once that explicitly permitted appendix is removed.
  const legacyProfile = profile.stdout.toString('utf-8').replace(
    /\nScorekeeper-aligned assisted proxy by zone \[S2c2; INFORMATIONAL\][\s\S]*?Proxy corner-three highest: (?:true|false)\n/,
    '',
  );
  assert.equal(hash(Buffer.from(legacyProfile)), BASELINES.profileStdout, 'default legacy profile stdout drifted');
  assert.equal(hash(profile.stderr), BASELINES.profileStderr, 'default profile stderr drifted');

  const benchmarkPath = 'data/history/benchmarks.json';
  const benchmark = existsSync(benchmarkPath) ? readFileSync(benchmarkPath) : undefined;
  const calibrate = runCommand('scripts/calibrate-history.ts');
  if (benchmark) writeFileSync(benchmarkPath, benchmark);
  assert.equal(calibrate.status, 0, 'default calibrate must pass');
  assert.equal(hash(calibrate.stdout), BASELINES.calibrateStdout, 'default calibrate stdout drifted');
  assert.equal(hash(calibrate.stderr), BASELINES.calibrateStderr, 'default calibrate stderr drifted');
  console.log('default legacy output hashes and focused invariants: OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
