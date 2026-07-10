/**
 * S2a/S2b — validation + determinism harness for the league candidate.
 *
 * The app's JSON loader only parses and casts, so a "round-trip through the
 * load path" proves nothing. This harness performs EXPLICIT runtime assertions
 * on the emitted candidate, then verifies byte-idempotence:
 *   build -> hash candidate plus both generated reports -> rebuild -> hashes identical -> `--check` exits 0.
 *
 * It shells out to the builder with `node --import tsx` (the same node binary,
 * PATH-independent) so it exercises the real CLI. It introduces no randomness.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Player, Position, PerGameStats, SeasonStats } from '../src/models/player';
import { Team } from '../src/models/team';
import { FREE_AGENT_TEAM_ID, ROSTER_MIN, ROSTER_MAX } from '../src/transactions/constants';
import {
  blendScore,
  FREE_THROW_MEAN_TOLERANCE,
  FREE_THROW_TARGET_SD,
  freeThrowPctFromRating,
  freeThrowRatingFromPct,
  PERIMETER_INTERIOR_DEFENSE_R_MAX,
  RATING_KEYS,
  RATING_MEAN_TOLERANCE,
  RATING_SD_TOLERANCE,
} from '../src/ratings/nba-derivation';
import { ratingToModifier } from '../src/engine/shot';

const ROOT = process.cwd();
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-league.ts');
const TEAMS_PATH = path.join(ROOT, 'data', 'league-candidate', 'teams.json');
const PLAYERS_PATH = path.join(ROOT, 'data', 'league-candidate', 'players.json');
const COVERAGE_PATH = path.join(ROOT, 'docs', 'S2A_LEAGUE_COVERAGE.md');
const RATINGS_CONTRACT_PATH = path.join(ROOT, 'docs', 'S2B_RATINGS_CONTRACT.md');
const ALL_FILES = [TEAMS_PATH, PLAYERS_PATH, COVERAGE_PATH, RATINGS_CONTRACT_PATH];

const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const CONTRACT_TYPES = new Set(['rookie_scale', 'veteran', 'max', 'minimum', 'two_way']);
const MIN_ENGINE_ROSTER = ROSTER_MIN; // engine/roster floor

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const avg = average(values);
  return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
}

function pearson(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const ma = average(a); const mb = average(b);
  let numerator = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma; const db = b[i] - mb;
    numerator += da * db; aa += da * da; bb += db * db;
  }
  return aa > 0 && bb > 0 ? numerator / Math.sqrt(aa * bb) : 0;
}

function runBuilder(args: string[]): number {
  try {
    execFileSync(process.execPath, ['--import', 'tsx', BUILD_SCRIPT, ...args], { stdio: 'pipe', encoding: 'utf-8' });
    return 0;
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    if (typeof err.status === 'number') {
      process.stderr.write(String(err.stdout ?? ''));
      process.stderr.write(String(err.stderr ?? ''));
      return err.status;
    }
    throw e;
  }
}

function hashFile(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const PER_GAME_FIELDS: (keyof PerGameStats)[] = [
  'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'fieldGoalPct',
  'threePointersMade', 'threePointersAttempted', 'threePointPct',
  'freeThrowsMade', 'freeThrowsAttempted', 'freeThrowPct',
  'offensiveRebounds', 'defensiveRebounds', 'rebounds', 'assists',
  'steals', 'blocks', 'turnovers', 'personalFouls',
];

function assertCareerStats(p: Player): void {
  check(Array.isArray(p.careerStats), `player ${p.id}: careerStats not an array`);
  if (!Array.isArray(p.careerStats)) return;
  check(p.careerStats.length >= 1, `player ${p.id}: zero careerStats rows (must have >=1 box season)`);
  for (const row of p.careerStats as SeasonStats[]) {
    check(typeof row.season === 'string' && row.season.length > 0, `player ${p.id}: careerStats.season invalid`);
    check(typeof row.teamId === 'string', `player ${p.id}: careerStats.teamId not a string`);
    check(isFiniteNum(row.gamesPlayed), `player ${p.id}: careerStats.gamesPlayed not finite (${row.season})`);
    check(row.gamesStarted === 0, `player ${p.id}: careerStats.gamesStarted must be 0 structural fallback (${row.season})`);
    check(isFiniteNum(row.minutesPerGame), `player ${p.id}: careerStats.minutesPerGame not finite (${row.season})`);
    check(row.stats !== null && typeof row.stats === 'object', `player ${p.id}: careerStats.stats missing (${row.season})`);
    if (row.stats) {
      for (const f of PER_GAME_FIELDS) {
        check(isFiniteNum(row.stats[f]), `player ${p.id}: careerStats.stats.${f} not finite (${row.season})`);
      }
    }
  }
}

function assertPlayerShape(p: Player, rostered: boolean): void {
  check(typeof p.id === 'string' && p.id.startsWith('nba_'), `player ${p.id}: id shape`);
  check(typeof p.firstName === 'string', `player ${p.id}: firstName`);
  check(typeof p.lastName === 'string', `player ${p.id}: lastName`);
  check(POSITIONS.includes(p.position), `player ${p.id}: position "${p.position}"`);
  if (p.secondaryPosition !== undefined) {
    check(POSITIONS.includes(p.secondaryPosition), `player ${p.id}: secondaryPosition "${p.secondaryPosition}"`);
  }
  check(isFiniteNum(p.height) && p.height >= 0, `player ${p.id}: height`);
  check(isFiniteNum(p.weight) && p.weight >= 0, `player ${p.id}: weight`);
  check(isFiniteNum(p.age), `player ${p.id}: age`);
  check(isFiniteNum(p.experience) && p.experience >= 0, `player ${p.id}: experience`);
  check(typeof p.teamId === 'string', `player ${p.id}: teamId`);
  check(isFiniteNum(p.jerseyNumber), `player ${p.id}: jerseyNumber`);
  check(isFiniteNum(p.scoutingAccuracy), `player ${p.id}: scoutingAccuracy`);

  // Ratings & potential in 1..80; all finite.
  for (const k of RATING_KEYS) {
    const v = p.ratings?.[k];
    check(isFiniteNum(v) && Number.isInteger(v) && v >= 1 && v <= 80, `player ${p.id}: rating ${k}=${v} must be an integer in [1,80]`);
  }
  for (const [k, v] of Object.entries(p.potential ?? {})) {
    check(isFiniteNum(v) && v >= 1 && v <= 80, `player ${p.id}: potential ${k}=${v} out of [1,80]`);
  }
  for (const [k, v] of Object.entries(p.tendencies ?? {})) {
    check(isFiniteNum(v), `player ${p.id}: tendency ${k} not finite`);
  }

  // Contract.
  const c = p.contract;
  check(!!c && CONTRACT_TYPES.has(c.type), `player ${p.id}: contract.type "${c?.type}"`);
  check(Array.isArray(c?.salarySchedule) && c.salarySchedule.length >= 1 && c.salarySchedule.length <= 5,
    `player ${p.id}: contract.salarySchedule length`);
  if (Array.isArray(c?.salarySchedule)) {
    for (const sal of c.salarySchedule) {
      check(isFiniteNum(sal) && sal >= 0 && sal < 100, `player ${p.id}: contract salary ${sal} out of range`);
    }
  }
  check(typeof c?.noTradeClause === 'boolean', `player ${p.id}: contract.noTradeClause`);

  // Ownership consistency: rostered => no desiredContract; FA => desiredContract present.
  if (rostered) {
    check(p.teamId !== FREE_AGENT_TEAM_ID, `player ${p.id}: rostered but teamId is FA sentinel`);
    check(p.desiredContract === undefined, `player ${p.id}: rostered player must not carry desiredContract`);
  } else {
    check(p.teamId === FREE_AGENT_TEAM_ID, `player ${p.id}: unrostered player teamId must be FA sentinel`);
    check(!!p.desiredContract, `player ${p.id}: FA must carry desiredContract`);
    if (p.desiredContract) {
      check(CONTRACT_TYPES.has(p.desiredContract.type), `player ${p.id}: desiredContract.type`);
      check(isFiniteNum(p.desiredContract.desiredSalary) && p.desiredContract.desiredSalary >= 0,
        `player ${p.id}: desiredContract.desiredSalary`);
      check(isFiniteNum(p.desiredContract.desiredYears) && p.desiredContract.desiredYears >= 1
        && p.desiredContract.desiredYears <= 5, `player ${p.id}: desiredContract.desiredYears`);
    }
  }

  assertCareerStats(p);
}

function assertTeamShape(t: Team, playersById: Map<string, Player>): void {
  check(typeof t.id === 'string' && t.id.startsWith('nba_team_'), `team ${t.id}: id shape`);
  check(typeof t.name === 'string' && t.name.length > 0, `team ${t.id}: name`);
  check(typeof t.city === 'string' && t.city.length > 0, `team ${t.id}: city`);
  check(typeof t.fullName === 'string' && t.fullName.length > 0, `team ${t.id}: fullName`);
  check(typeof t.abbreviation === 'string' && t.abbreviation.length > 0, `team ${t.id}: abbreviation`);
  check(t.conference === 'East' || t.conference === 'West', `team ${t.id}: conference`);
  check(typeof t.division === 'string' && t.division.length > 0, `team ${t.id}: division`);

  // Roster bounds and resolution.
  check(t.roster.length >= MIN_ENGINE_ROSTER && t.roster.length <= ROSTER_MAX,
    `team ${t.id}: roster size ${t.roster.length} not in [${MIN_ENGINE_ROSTER}, ${ROSTER_MAX}]`);
  for (const pid of t.roster) {
    const pl = playersById.get(pid);
    check(!!pl, `team ${t.id}: roster references missing player ${pid}`);
    if (pl) check(pl.teamId === t.id, `team ${t.id}: roster member ${pid} teamId=${pl.teamId} != ${t.id}`);
  }

  // Rotation validity.
  const r = t.rotation;
  check(Array.isArray(r.starters) && r.starters.length === 5, `team ${t.id}: starters length`);
  const rosterSet = new Set(t.roster);
  for (const s of r.starters) {
    check(typeof s === 'string' && s.length > 0, `team ${t.id}: empty starter slot`);
    check(rosterSet.has(s), `team ${t.id}: starter ${s} not on roster`);
  }
  for (const s of r.rotationOrder) {
    check(rosterSet.has(s), `team ${t.id}: rotationOrder ref ${s} not on roster`);
  }
  for (const [pid, mins] of Object.entries(r.minuteTargets)) {
    check(rosterSet.has(pid), `team ${t.id}: minuteTarget ref ${pid} not on roster`);
    check(isFiniteNum(mins), `team ${t.id}: minuteTarget for ${pid} not finite`);
  }
}

function runAssertions(): { players: Player[]; ownerByPlayer: Map<string, string> } {
  const teams: Team[] = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf-8'));
  const players: Player[] = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'));

  check(teams.length === 30, `expected 30 teams, got ${teams.length}`);

  // No player id appears twice.
  const playersById = new Map<string, Player>();
  for (const p of players) {
    check(!playersById.has(p.id), `duplicate player id ${p.id}`);
    playersById.set(p.id, p);
  }

  // Unique roster ownership; build rostered set.
  const ownerByPlayer = new Map<string, string>();
  for (const t of teams) {
    for (const pid of t.roster) {
      const existing = ownerByPlayer.get(pid);
      check(!existing, `player ${pid} appears on multiple rosters (${existing}, ${t.id})`);
      ownerByPlayer.set(pid, t.id);
    }
  }

  for (const t of teams) assertTeamShape(t, playersById);
  for (const p of players) assertPlayerShape(p, ownerByPlayer.has(p.id));

  // Every rostered id resolves to a real player (covered above via playersById lookup).
  for (const [pid, teamId] of ownerByPlayer) {
    check(playersById.has(pid), `roster of ${teamId} references non-existent player ${pid}`);
  }

  console.log(`Assertions: ${teams.length} teams, ${players.length} players, ${ownerByPlayer.size} rostered.`);
  return { players, ownerByPlayer };
}

function assertS2bStatisticalContract(players: Player[], ownerByPlayer: Map<string, string>): void {
  const rostered = players.filter((player) => ownerByPlayer.has(player.id));
  const active: Player[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf-8'));
  for (const rating of RATING_KEYS) {
    const values = rostered.map((player) => player.ratings[rating]);
    const targetSd = rating === 'freeThrowShooting'
      ? FREE_THROW_TARGET_SD
      : standardDeviation(active.map((player) => player.ratings[rating]));
    const meanTolerance = rating === 'freeThrowShooting' ? FREE_THROW_MEAN_TOLERANCE : RATING_MEAN_TOLERANCE;
    check(Math.abs(average(values) - 40) <= meanTolerance,
      `${rating}: rostered mean ${average(values).toFixed(3)} outside 40 ± ${meanTolerance}`);
    check(Math.abs(standardDeviation(values) - targetSd) <= RATING_SD_TOLERANCE,
      `${rating}: rostered SD ${standardDeviation(values).toFixed(3)} outside target ${targetSd.toFixed(3)} ± ${RATING_SD_TOLERANCE}`);
  }

  // Continuous FT inverse closure and the <= half-rating-step post-rounding bound.
  // Values are inside the representable 1..80 inverse range; lower engine
  // clamps cannot round-trip through a rating below the model's floor.
  for (const pct of [0.55, 0.60, 0.663, 0.781, 0.842, 0.95]) {
    const continuous = freeThrowRatingFromPct(pct);
    check(Math.abs(freeThrowPctFromRating(continuous) - pct) < 1e-12,
      `FT continuous inverse failed at ${pct}`);
    const quantized = Math.max(1, Math.min(80, Math.round(continuous)));
    check(Math.abs(freeThrowPctFromRating(quantized) - pct) <= 0.003125 + 1e-12,
      `FT post-quantization closure exceeds half step at ${pct}`);
  }

  // The report consumes the engine implementation directly; these values guard
  // the export against accidental formula drift.
  const expectedModifier: Record<number, number> = { 1: -0.10307578125, 40: 0, 80: 0.10625 };
  for (const rating of [1, 40, 80]) {
    check(Math.abs(ratingToModifier(rating) - expectedModifier[rating]) < 1e-12,
      `ratingToModifier(${rating}) no longer matches the declared engine value`);
  }

  const isolateMetric = (target: string) => (id: string): number => id === target ? 1 : 0;
  check(blendScore('ballHandling', isolateMetric('handling.turnoverRatio')) === -0.55,
    'ballHandling blend no longer consumes handling.turnoverRatio at weight -0.55');
  check(blendScore('offensiveIQ', isolateMetric('iq.turnoverRatio')) === -0.35,
    'offensiveIQ blend no longer consumes iq.turnoverRatio at weight -0.35');

  const defenseR = pearson(
    rostered.map((player) => player.ratings.perimeterDefense),
    rostered.map((player) => player.ratings.interiorDefense),
  );
  check(defenseR <= PERIMETER_INTERIOR_DEFENSE_R_MAX,
    `perimeterDefense/interiorDefense r=${defenseR.toFixed(3)} exceeds ceiling ${PERIMETER_INTERIOR_DEFENSE_R_MAX}`);
  const report = fs.readFileSync(RATINGS_CONTRACT_PATH, 'utf-8');
  for (const field of ['strength.strength.bmi', 'strength.strength.wingspanRatio', 'athleticism.athleticism.wingspanRatio']) {
    check(!report.includes(`| ${field} |`), `measured biometric metric ${field} appeared in shrinkage fallback log`);
  }
}

function main(): void {
  console.log('== build (emit candidate) ==');
  const buildStatus = runBuilder([]);
  if (buildStatus !== 0) {
    console.error(`FAIL: builder exited ${buildStatus} on initial build.`);
    process.exit(1);
  }
  for (const f of ALL_FILES) {
    if (!fs.existsSync(f)) {
      console.error(`FAIL: expected output missing: ${f}`);
      process.exit(1);
    }
  }

  console.log('== runtime assertions ==');
  const assertionData = runAssertions();
  assertS2bStatisticalContract(assertionData.players, assertionData.ownerByPlayer);

  console.log('== determinism: hash -> rebuild -> hash ==');
  const h1 = ALL_FILES.map(hashFile);
  const rebuildStatus = runBuilder([]);
  check(rebuildStatus === 0, `rebuild exited ${rebuildStatus}`);
  const h2 = ALL_FILES.map(hashFile);
  for (let i = 0; i < ALL_FILES.length; i++) {
    check(h1[i] === h2[i], `non-deterministic output: ${path.basename(ALL_FILES[i])} (${h1[i]} != ${h2[i]})`);
  }

  console.log('== determinism: --check exits 0 ==');
  const checkStatus = runBuilder(['--check']);
  check(checkStatus === 0, `build-league --check exited ${checkStatus} (expected 0)`);

  if (failures.length > 0) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures.slice(0, 50)) console.error(`  - ${f}`);
    if (failures.length > 50) console.error(`  ... and ${failures.length - 50} more`);
    process.exit(1);
  }
  console.log('\nAll build-league assertions and determinism checks passed.');
}

main();
