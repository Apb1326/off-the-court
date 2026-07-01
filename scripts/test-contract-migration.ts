/**
 * Tests the save schema migration chain through transactions Phase 5a (schema v5).
 *
 * Proves:
 *  1. FNV-1a hash stability (test vector)
 *  2. v2 -> v4 migration chain: all players have valid contracts
 *  3. FA-pool repair: teamId === '' players are in pool
 *  4. FA-pool players have desiredContract
 *  5. Idempotency: migrate twice = byte-identical
 *  6. Order independence: reversed players = identical contracts by ID
 *  7. Plausibility: stars have higher salaries than bench
 *  8. Tier precedence: young high-rated → rookie_scale; old star → max
 *  9. No empty salarySchedule
 *  10. v1 → v2 → v3 → v4 full chain
 *  11. validateContract passes on all generated contracts
 *  12. direct v3 → v4 rights reconstruction and canonical absence
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
import {
  FIRST_APRON,
  FREE_AGENT_TEAM_ID,
  ROOKIE_MINIMUM_SALARY,
  SALARY_CAP,
  SECOND_APRON,
} from '../src/transactions/constants';
import { getLeagueFinancialSummary } from '../src/transactions/cap';

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

  console.log('\n--- 2. v2 -> v5 migration chain: valid contracts ---');
  const v2 = buildV2Save(teams, players);
  const m1 = migrateSaveFile(v2);
  check('v2->v5 migration succeeds', m1.ok);
  if (!m1.ok) { finish(); return; }
  check('migrated schemaVersion is current', m1.file.schemaVersion === SAVE_SCHEMA_VERSION);
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
  check('second migration reports no change (already current)', m2.ok && m2.migrated === false);
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

  console.log('\n--- 10. v1 → v2 → v3 → v4 → v5 full chain ---');
  const v1 = buildV1Save(teams, players);
  const mChain = migrateSaveFile(v1 as unknown as SaveFile);
  check('v1→v5 full-chain migration succeeds', mChain.ok);
  if (mChain.ok) {
    check('full-chain: schemaVersion is current', mChain.file.schemaVersion === SAVE_SCHEMA_VERSION);
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

  console.log('\n--- 12. League contract economy ---');
  const financials = getLeagueFinancialSummary(m1.file);
  const payrolls = financials.map((summary) => summary.payroll).sort((a, b) => a - b);
  const payrollMin = payrolls[0];
  const payrollMedian = payrolls.length % 2 === 0
    ? (payrolls[payrolls.length / 2 - 1] + payrolls[payrolls.length / 2]) / 2
    : payrolls[Math.floor(payrolls.length / 2)];
  const payrollMax = payrolls[payrolls.length - 1];
  const statusCounts = financials.reduce<Record<string, number>>((counts, summary) => {
    counts[summary.capStatus] = (counts[summary.capStatus] ?? 0) + 1;
    return counts;
  }, {});
  console.log(
    `  payroll min/median/max: ${payrollMin.toFixed(3)} / ${payrollMedian.toFixed(3)} / ${payrollMax.toFixed(3)}`,
  );
  console.log(
    `  status distribution: under_cap=${statusCounts.under_cap ?? 0}, ` +
    `over_cap=${statusCounts.over_cap ?? 0}, over_tax=${statusCounts.over_tax ?? 0}, ` +
    `over_first_apron=${statusCounts.over_first_apron ?? 0}, ` +
    `over_second_apron=${statusCounts.over_second_apron ?? 0}`,
  );
  check('median standard payroll is between salary cap and first apron',
    payrollMedian >= SALARY_CAP && payrollMedian <= FIRST_APRON);
  check('at least one team is under the salary cap',
    financials.some((summary) => summary.payroll < SALARY_CAP));
  check('no more than eight teams exceed the second apron',
    financials.filter((summary) => summary.payroll >= SECOND_APRON).length <= 8);

  console.log('\n--- 13. Canonical free-agent normalization ---');
  const stale = structuredClone(m1.file);
  const rosteredPlayerId = stale.teams[0].roster[0];
  stale.season.freeAgentPool = [rosteredPlayerId, rosteredPlayerId, 'missing-player'];
  stale.players = stale.players.map((player) =>
    player.id === rosteredPlayerId ? { ...player, teamId: FREE_AGENT_TEAM_ID } : player);
  const repaired = migrateSaveFile(stale);
  check('current-schema stale pool is normalized', repaired.ok && repaired.migrated);
  if (repaired.ok) {
    const repairedPool = repaired.file.season.freeAgentPool;
    const expectedUnsigned = repaired.file.players
      .filter((player) => !repaired.file.teams.some((team) => team.roster.includes(player.id)))
      .map((player) => player.id)
      .sort();
    check('canonical pool is unique and contains only existing unsigned players',
      new Set(repairedPool).size === repairedPool.length &&
      JSON.stringify(repairedPool) === JSON.stringify(expectedUnsigned));
    check('rostered stale-pool player is removed and teamId back-reference is repaired',
      !repairedPool.includes(rosteredPlayerId) &&
      repaired.file.players.find((player) => player.id === rosteredPlayerId)?.teamId === stale.teams[0].id);
    check('every genuinely unsigned player has a valid desiredContract',
      repaired.file.players
        .filter((player) => player.teamId === FREE_AGENT_TEAM_ID)
        .every((player) => player.desiredContract !== undefined));
  }

  const duplicateOwner = structuredClone(m1.file);
  duplicateOwner.teams[1].roster.push(rosteredPlayerId);
  const duplicateBefore = JSON.stringify(duplicateOwner);
  const duplicateResult = migrateSaveFile(duplicateOwner);
  check('player on multiple rosters is explicitly rejected',
    !duplicateResult.ok && /multiple rosters/.test(duplicateResult.reason));
  check('duplicate-roster rejection leaves migration input byte-identical',
    JSON.stringify(duplicateOwner) === duplicateBefore);

  console.log('\n--- 14. Direct v3 → v4 rights migration ---');
  const directV3 = structuredClone(m1.file);
  directV3.schemaVersion = 3;
  const releasingTeam = directV3.teams[0];
  const releasedIds = releasingTeam.roster.slice(0, 4);
  const [birdId, earlyBirdId, nonBirdId, supersededCutId] = releasedIds;
  releasingTeam.roster = releasingTeam.roster.filter((id) => !releasedIds.includes(id));
  directV3.season.freeAgentPool = [...directV3.season.freeAgentPool, ...releasedIds];
  directV3.players = directV3.players.map((player) => {
    if (player.id === birdId) {
      return { ...player, teamId: FREE_AGENT_TEAM_ID, experience: 3 };
    }
    if (player.id === earlyBirdId) {
      return { ...player, teamId: FREE_AGENT_TEAM_ID, experience: 1 };
    }
    if (player.id === nonBirdId) {
      return {
        ...player,
        teamId: FREE_AGENT_TEAM_ID,
        contract: { type: 'minimum', salarySchedule: [1.1], noTradeClause: false },
        desiredContract: { type: 'veteran', desiredSalary: 1.1, desiredYears: 1 },
      };
    }
    if (releasedIds.includes(player.id)) {
      return { ...player, teamId: FREE_AGENT_TEAM_ID };
    }
    if (player.id === directV3.teams[1].roster[0]) {
      return { ...player, birdRights: { teamId: releasingTeam.id, type: 'bird' as const } };
    }
    return player;
  });

  const entryBase = {
    date: directV3.season.currentDate,
    season: directV3.season.seasonId,
  };
  const firstSeq = directV3.season.transactionLog.length;
  directV3.season.transactionLog.push(
    {
      ...entryBase,
      seq: firstSeq,
      type: 'cut',
      playerId: birdId,
      fromTeamId: releasingTeam.id,
      contractAtCut: { type: 'veteran', salarySchedule: [10], noTradeClause: false },
    },
    {
      ...entryBase,
      seq: firstSeq + 1,
      type: 'cut',
      playerId: earlyBirdId,
      fromTeamId: releasingTeam.id,
      contractAtCut: { type: 'veteran', salarySchedule: [5], noTradeClause: false },
    },
    {
      ...entryBase,
      seq: firstSeq + 2,
      type: 'cut',
      playerId: nonBirdId,
      fromTeamId: releasingTeam.id,
      contractAtCut: { type: 'minimum', salarySchedule: [1], noTradeClause: false },
    },
    {
      ...entryBase,
      seq: firstSeq + 3,
      type: 'cut',
      playerId: supersededCutId,
      fromTeamId: releasingTeam.id,
      contractAtCut: { type: 'max', salarySchedule: [40], noTradeClause: false },
    },
    {
      ...entryBase,
      seq: firstSeq + 4,
      type: 'sign',
      playerId: supersededCutId,
      toTeamId: releasingTeam.id,
    },
  );
  directV3.teams[1].hardCappedAtApron = 'first_apron';
  const logBeforeV4 = JSON.stringify(directV3.season.transactionLog);
  const directV4 = migrateSaveFile(directV3);
  check('direct v3→v4 migration succeeds', directV4.ok);
  if (directV4.ok) {
    const byId = new Map(directV4.file.players.map((player) => [player.id, player]));
    check('direct migration reaches current schema', directV4.file.schemaVersion === SAVE_SCHEMA_VERSION);
    check('Bird proxy reconstructed from veteran experience >= 3',
      byId.get(birdId)?.birdRights?.type === 'bird');
    check('Early Bird proxy reconstructed from veteran experience 1–2',
      byId.get(earlyBirdId)?.birdRights?.type === 'early_bird');
    check('Non-Bird proxy reconstructed from minimum contract',
      byId.get(nonBirdId)?.birdRights?.type === 'non_bird');
    check('legacy minimum free-agent ask is normalized for the minimum exception',
      byId.get(nonBirdId)?.desiredContract?.type === 'minimum' &&
      byId.get(nonBirdId)?.desiredContract?.desiredSalary === ROOKIE_MINIMUM_SALARY);
    check('latest sign supersedes an older cut for rights reconstruction',
      !('birdRights' in (byId.get(supersededCutId) ?? {})));
    check('all reconstructed rights belong to the releasing team',
      [birdId, earlyBirdId, nonBirdId]
        .every((id) => byId.get(id)?.birdRights?.teamId === releasingTeam.id));
    check('seeded free agents without an applicable cut keep rights absent',
      directV4.file.players
        .filter((player) => !releasedIds.includes(player.id) && player.teamId === FREE_AGENT_TEAM_ID)
        .every((player) => !('birdRights' in player)));
    check('normalization strips stale rights keys from rostered players',
      directV4.file.players
        .filter((player) => directV4.file.teams.some((team) => team.roster.includes(player.id)))
        .every((player) => !('birdRights' in player)));
    check('existing hard-cap state is preserved and absent state stays absent',
      directV4.file.teams[1].hardCappedAtApron === 'first_apron' &&
      !('hardCappedAtApron' in directV4.file.teams[0]));
    check('v3→v4 migration does not rewrite append-only log entries',
      JSON.stringify(directV4.file.season.transactionLog) === logBeforeV4);

    const directRoundTrip = JSON.parse(JSON.stringify(directV4.file)) as SaveFile;
    const directAgain = migrateSaveFile(directRoundTrip);
    check('direct current-schema re-migration reports no change',
      directAgain.ok && directAgain.migrated === false);
    check('direct current-schema re-migration is byte-identical after canonical JSON',
      directAgain.ok && JSON.stringify(directAgain.file) === JSON.stringify(directRoundTrip));
  }

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
