/** S2d activation harness (keeps the historical filename for existing callers). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as constants from '../src/engine/constants';
import * as playTypes from '../src/engine/play-types';
import { simulateGame } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';
import { SeededRNG } from '../src/lib/rng';
import { Team } from '../src/models/team';
import { Player } from '../src/models/player';
import { migrateSaveFile } from '../src/data/saves/migrations';
import { FREE_AGENT_TEAM_ID } from '../src/transactions/constants';
import { loadActivationContext, printActivationContextBanner } from './s2d-activation-context';

const root = process.cwd();
const teams = JSON.parse(readFileSync(path.join(root, 'data', 'teams.json'), 'utf8')) as Team[];
const players = JSON.parse(readFileSync(path.join(root, 'data', 'players.json'), 'utf8')) as Player[];
const byTeam = new Map<string, Player[]>(teams.map((team) => [team.id, []]));
for (const player of players) if (player.teamId && byTeam.has(player.teamId)) byTeam.get(player.teamId)!.push(player);
const S2C1_R_TERMINAL_OUTCOMES = new Set(['made_shot', 'missed_shot', 'and_one', 'turnover']);

function distribution(seed: number): Map<string, number> {
  const rng = new SeededRNG(seed); const counts = new Map<string, number>();
  const teamById = new Map(teams.map((team) => [team.id, team]));
  let games = 0;
  for (const scheduled of generateSchedule(teams, rng)) {
    const home = teamById.get(scheduled.homeTeamId)!; const away = teamById.get(scheduled.awayTeamId)!;
    const hp = byTeam.get(home.id)!; const ap = byTeam.get(away.id)!;
    if (hp.length < 5 || ap.length < 5) continue;
    games++;
    const sim = simulateGame(home, away, hp, ap, scheduled.id, 's2d', `day-${scheduled.day}`, rng.nextInt(1, 2_000_000_000));
    for (const event of sim.playByPlay) {
      // S2c1-R accepted the candidate selector against the emitted terminal
      // possession stream. Candidate semantics label every terminal event by
      // its originating action, including and-ones and turnovers; restricting
      // the denominator to field-goal attempts instead measures downstream
      // shot resolution rather than selector behavior.
      if (S2C1_R_TERMINAL_OUTCOMES.has(event.outcome)) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
  }
  assert.equal(games, 1290, 'full production schedule must be playable');
  return counts;
}

function terminalBandError(seed: number): number {
  const counts = distribution(seed); const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const target: Record<string, number> = {
    isolation: 0.0819,
    pick_and_roll: 0.254,
    post_up: 0.0424,
    spot_up: 0.2561,
    transition: 0.1966,
    cut: 0.0732,
    off_screen: 0.0408,
    handoff: 0.055,
  };
  let absolute = 0;
  for (const [type, expected] of Object.entries(target)) absolute += Math.abs((counts.get(type) ?? 0) / total - expected);
  assert.deepEqual(distribution(seed), counts, `seed ${seed} terminal distribution must be byte-stable on repeat`);
  console.log(`seed ${seed}: terminal total abs ${(absolute * 100).toFixed(2)}pp (${absolute <= 0.06 ? 'IN BAND' : 'OUT OF BAND'})`);
  return absolute;
}

function assertFtInverse(): void {
  const resolve = (rating: number) => Math.max(constants.FT_SIM_PCT_MIN, Math.min(constants.FT_SIM_PCT_MAX,
    constants.FT_LEAGUE_AVG_PCT + ((rating - 40) / 40) * constants.FT_PCT_SLOPE));
  // Test only percentages produced inside the representable, unclamped domain.
  for (const rating of [1, 20, 40, 60]) {
    const pct = resolve(rating);
    const derived = Math.max(1, Math.min(80, Math.round(40 + (pct - constants.FT_LEAGUE_AVG_PCT) * constants.FT_DERIVE_SCALE)));
    assert.equal(derived, rating, `FT inverse must recover representable rating ${rating}`);
    assert.equal(resolve(derived), pct, `FT inverse must round-trip representable pct ${pct}`);
  }
  // Endpoints are clamp behavior, not inverse-pair failures.
  assert.equal(resolve(-100), constants.FT_SIM_PCT_MIN, 'FT lower endpoint must clamp');
  assert.equal(resolve(80), constants.FT_SIM_PCT_MAX, 'FT upper endpoint must clamp');
}

function assertProfileHasNoSelectionInterface(): void {
  const profileSource = readFileSync(path.join(root, 'scripts', 'profile-engine.ts'), 'utf8');
  const selectorSource = readFileSync(path.join(root, 'src', 'engine', 'play-types.ts'), 'utf8');
  for (const forbidden of ['--league-dir', '--shot-zones', 'process.env']) {
    assert.equal(profileSource.includes(forbidden), false, `profile must not expose or infer selector/table mode via ${forbidden}`);
  }
  assert.equal(selectorSource.includes('process.env'), false, 'selector must not depend on environment state');
  assert.equal(selectorSource.includes('player.id'), false, 'selector must not choose a mode from player identity');
  for (const args of [['--league-dir', 'data'], ['--shot-zones=real']]) {
    try {
      execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'profile-engine.ts'), ...args], { stdio: 'pipe' });
      assert.fail(`profile unexpectedly accepted ${args.join(' ')}`);
    } catch (error) {
      const result = error as { status?: number; stderr?: Buffer };
      assert.equal(result.status, 1, `profile must reject ${args.join(' ')}`);
      assert.match(result.stderr?.toString() ?? '', /Unknown argument/, `profile rejection for ${args.join(' ')} must be explicit`);
    }
  }
}

async function main(): Promise<void> {
  const context = await loadActivationContext();
  printActivationContextBanner(context);
  assert.equal(teams.length, 30);
  assert.ok(players.length > 0 && players.every((player) => player.id.startsWith('nba_')), 'new-game production template must be NBA-derived');
  assert.equal('PLAY_TYPE_SHOT_ZONES_REAL' in constants, false, 'dual shot-zone table must be retired');
  assert.equal('LEGACY_PLAY_TYPE_SELECTION' in playTypes, false, 'legacy selector must be retired');
  assert.equal('CANDIDATE_PLAY_TYPE_SELECTION' in playTypes, false, 'candidate selector switch must be retired');
  assertProfileHasNoSelectionInterface();
  assertFtInverse();
  const terminalErrors = [2026, 7, 42].map((seed) => [seed, terminalBandError(seed)] as const);
  for (const [seed, error] of terminalErrors) {
    assert.ok(error <= 0.06, `seed ${seed} play-type terminal total absolute error ${error.toFixed(4)} exceeds 0.06`);
  }
  execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'build-league.ts'), '--check'], { stdio: 'inherit' });

  // Loading a current snapshot must not rederive or replace its roster/player pool.
  const freeAgents = players.filter((player) => player.teamId === FREE_AGENT_TEAM_ID);
  assert.ok(freeAgents.length > 0, 'production pool must carry unsigned players in the canonical free-agent pool');
  const save = { schemaVersion: 7, controlledTeamId: null, teams, players, season: { freeAgentPool: freeAgents, transactionLog: [] } } as unknown as Parameters<typeof migrateSaveFile>[0];
  const original = JSON.stringify(save.players);
  const migration = migrateSaveFile(save);
  assert.equal(migration.ok, true, 'current save must load');
  if (migration.ok) assert.equal(JSON.stringify(migration.file.players), original, 'loading a current save must not rewrite player snapshots');
  console.log('S2d activation harness: PASS');
}

main().catch((error) => { console.error(error); process.exit(1); });
