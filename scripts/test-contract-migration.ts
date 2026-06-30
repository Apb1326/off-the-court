/**
 * Tests the save schema migration for transactions Phase 2 (v2 -> v3: contracts).
 *
 * Proves:
 *  1. FNV-1a hash stability (test vector)
 *  2. v2 -> v3 migration: all players have valid contracts
 *  3. FA-pool repair: teamId === '' players are in pool
 *  4. FA-pool players have desiredContract
 *  5. Idempotency: migrate twice = byte-identical
 *  6. Order independence: reversed players = identical contracts by ID
 *  7. Plausibility: stars have higher salaries than bench
 *  8. Tier precedence: young high-rated → rookie_scale; old star → max
 *  9. No empty salarySchedule
 *  10. v1 → v2 → v3 full chain
 *  11. validateContract passes on all generated contracts
 *
 * Run with: node_modules/.bin/tsx scripts/test-contract-migration.ts
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SaveFile, SAVE_SCHEMA_VERSION, derivePhase } from '../src/models/save';
import { migrateSaveFile } from '../src/data/saves/migrations';
import { createSeasonState } from '../src/engine/season';
import { fnv1a } from '../src/lib/hash';
import { validateContract } from '../src/transactions/contracts';
import { FREE_AGENT_TEAM_ID } from '../src/transactions/constants';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

/** Build a v1 save (no FA pool, no transaction log). */
function buildV1Save(teams: Team[], players: Player[]): Record<string, unknown> {
  const full = createSeasonState(teams, players, { seed: 1 });
  const phase = derivePhase(full);
  const season = structuredClone(full) as unknown as Record<string, unknown>;
  delete season.freeAgentPool;
  delete season.transactionLog;
  const now = new Date().toISOString();
  return { schemaVersion: 1, phase, season, teams, players, createdAt: now, updatedAt: now };
}

/** Build a v2 save (has FA pool + transaction log, old-shape contracts). */
function buildV2Save(teams: Team[], players: Player[]): SaveFile {
  const full = createSeasonState(teams, players, { seed: 1 });
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    phase: derivePhase(full),
    season: full,
    teams,
    players: structuredClone(players),
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  console.log('--- 1. FNV-1a hash stability ---');
  const hashResult = fnv1a('player_123');
  check(`fnv1a('player_123') === 2558982419 (got ${hashResult})`, hashResult === 2558982419);

  console.log('\n--- 2. v2 -> v3 migration: valid contracts ---');
  const v2 = buildV2Save(teams, players);
  const m1 = migrateSaveFile(v2);
  check('v2->v3 migration succeeds', m1.ok);
  if (!m1.ok) { finish(); return; }
  check('migrated schemaVersion is 3', m1.file.schemaVersion === SAVE_SCHEMA_VERSION);
  check('all players have contract.type',
    m1.file.players.every(p => typeof p.contract.type === 'string'));
  check('all players have non-empty salarySchedule',
    m1.file.players.every(p => p.contract.salarySchedule.length >= 1));

  console.log('\n--- 3. FA-pool repair ---');
  const faPlayers = m1.file.players.filter(p => p.teamId === FREE_AGENT_TEAM_ID);
  const poolSet = new Set(m1.file.season.freeAgentPool);
  check(`${faPlayers.length} FA players exist`,
    faPlayers.length > 0);
  check('all FA-sentinel players are in freeAgentPool',
    faPlayers.every(p => poolSet.has(p.id)));

  console.log('\n--- 4. FA-pool players have desiredContract ---');
  check('all FA-pool players have desiredContract',
    faPlayers.every(p => p.desiredContract !== undefined));
  check('non-FA players do NOT have desiredContract',
    m1.file.players.filter(p => p.teamId !== FREE_AGENT_TEAM_ID).every(p => p.desiredContract === undefined));

  console.log('\n--- 5. Idempotency ---');
  const roundTripped = JSON.parse(JSON.stringify(m1.file)) as SaveFile;
  const m2 = migrateSaveFile(roundTripped);
  check('second migration succeeds', m2.ok);
  check('second migration reports no change (already at v3)', m2.ok && m2.migrated === false);
  check('second migration is byte-identical',
    m2.ok && JSON.stringify(m2.file) === JSON.stringify(roundTripped));

  console.log('\n--- 6. Order independence ---');
  const v2Reversed = buildV2Save(teams, players);
  v2Reversed.players = [...v2Reversed.players].reverse();
  const mReversed = migrateSaveFile(v2Reversed);
  check('reversed-order migration succeeds', mReversed.ok);
  if (mReversed.ok) {
    const contractsByIdOriginal = new Map<string, string>();
    for (const p of m1.file.players) {
      contractsByIdOriginal.set(p.id, JSON.stringify(p.contract));
    }
    const contractsByIdReversed = new Map<string, string>();
    for (const p of mReversed.file.players) {
      contractsByIdReversed.set(p.id, JSON.stringify(p.contract));
    }
    let allMatch = true;
    for (const [id, contractStr] of contractsByIdOriginal) {
      if (contractsByIdReversed.get(id) !== contractStr) {
        console.log(`  MISMATCH on ${id}`);
        allMatch = false;
        break;
      }
    }
    check('contracts identical by player ID regardless of array order', allMatch);
  }

  console.log('\n--- 7. Plausibility (stars > bench) ---');
  const overallOf = (p: Player) => {
    const vals = Object.values(p.ratings) as number[];
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const stars = m1.file.players.filter(p => overallOf(p) >= 55 && p.teamId !== FREE_AGENT_TEAM_ID);
  const bench = m1.file.players.filter(p => overallOf(p) < 40 && p.teamId !== FREE_AGENT_TEAM_ID);
  if (stars.length > 0 && bench.length > 0) {
    const avgStarSalary = stars.reduce((s, p) => s + p.contract.salarySchedule[0], 0) / stars.length;
    const avgBenchSalary = bench.reduce((s, p) => s + p.contract.salarySchedule[0], 0) / bench.length;
    check(`star avg salary (${avgStarSalary.toFixed(1)}M) > bench avg (${avgBenchSalary.toFixed(1)}M)`,
      avgStarSalary > avgBenchSalary);
  } else {
    check('plausibility: skipped (need both stars and bench players)', false);
  }

  console.log('\n--- 8. Tier precedence ---');
  // Young high-rated should be rookie_scale, not max
  const youngStar = m1.file.players.find(p => overallOf(p) >= 55 && p.age <= 23 && p.experience <= 3);
  if (youngStar) {
    check(`young star ${youngStar.firstName} ${youngStar.lastName} (age=${youngStar.age}, exp=${youngStar.experience}, ovr=${overallOf(youngStar).toFixed(0)}) → rookie_scale`,
      youngStar.contract.type === 'rookie_scale');
  } else {
    console.log('  skip  no young star found in data (age<=23, exp<=3, ovr>=55)');
  }
  // Old star should be max (if overall >= 60)
  const oldStar = m1.file.players.find(p => overallOf(p) >= 60 && p.age >= 30 && p.age < 36);
  if (oldStar) {
    check(`old star ${oldStar.firstName} ${oldStar.lastName} (age=${oldStar.age}, ovr=${overallOf(oldStar).toFixed(0)}) → max`,
      oldStar.contract.type === 'max');
  } else {
    console.log('  skip  no old star found in data (age>=30, age<36, ovr>=60)');
  }

  console.log('\n--- 9. No empty salarySchedule ---');
  const emptySchedule = m1.file.players.filter(p => p.contract.salarySchedule.length === 0);
  check(`no players have empty salarySchedule (found ${emptySchedule.length})`,
    emptySchedule.length === 0);

  console.log('\n--- 10. v1 → v2 → v3 full chain ---');
  const v1 = buildV1Save(teams, players);
  const mChain = migrateSaveFile(v1 as unknown as SaveFile);
  check('v1→v3 full-chain migration succeeds', mChain.ok);
  if (mChain.ok) {
    check('full-chain: schemaVersion is 3', mChain.file.schemaVersion === SAVE_SCHEMA_VERSION);
    check('full-chain: all players have contract.type',
      mChain.file.players.every(p => typeof p.contract.type === 'string'));
    check('full-chain: FA pool exists',
      Array.isArray(mChain.file.season.freeAgentPool));
    check('full-chain: transaction log exists',
      Array.isArray(mChain.file.season.transactionLog));
  }

  console.log('\n--- 11. validateContract passes on all ---');
  let allValid = true;
  let invalidCount = 0;
  for (const p of m1.file.players) {
    const v = validateContract(p.contract);
    if (!v.ok) {
      if (invalidCount < 3) console.log(`  INVALID contract on ${p.firstName} ${p.lastName}: ${v.reason}`);
      allValid = false;
      invalidCount++;
    }
  }
  check(`validateContract passes on all ${m1.file.players.length} players (${invalidCount} invalid)`,
    allValid);

  finish();
}

function finish() {
  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
