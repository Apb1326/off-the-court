/**
 * Tests the complete save schema migration chain through the current schema.
 *
 * Proves:
 *  - A pre-Phase-1 save (no free-agent pool / transaction log, schemaVersion 1) migrates to
 *    an EMPTY log and canonical pool at schemaVersion 4, then re-serializes cleanly.
 *  - Migration is idempotent: running it again is a no-op (byte-identical).
 *  - The real SaveStore.loadSave path migrates an old on-disk save transparently.
 *  - A save from a newer, unknown version is still rejected (not down-converted).
 *
 * Standalone (no Next runtime). Runs against a throwaway temp dir. Run with:
 *   node_modules/.bin/tsx scripts/test-save-migration.ts
 */
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SaveFile, SAVE_SCHEMA_VERSION, derivePhase } from '../src/models/save';
import { SaveStore } from '../src/data/saves/save-store';
import { migrateSaveFile } from '../src/data/saves/migrations';
import { createSeasonState } from '../src/engine/season';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

/** Build a synthetic pre-Phase-1 (v1) SaveFile: a season WITHOUT the new fields. */
function buildV1Save(teams: Team[], players: Player[]): Record<string, unknown> {
  const full = createSeasonState(teams, players, { seed: 1 });
  const phase = derivePhase(full); // derive from the valid season before stripping
  const season = structuredClone(full) as unknown as Record<string, unknown>;
  // Simulate the old on-disk shape: these fields did not exist before v2.
  delete season.freeAgentPool;
  delete season.transactionLog;
  const now = new Date().toISOString();
  return { schemaVersion: 1, phase, season, teams, players, createdAt: now, updatedAt: now };
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  // --- 1. In-memory migration of a v1 save ---
  const v1 = buildV1Save(teams, players);
  check('v1 fixture has no FA pool / log', !('freeAgentPool' in (v1.season as object)));

  const m1 = migrateSaveFile(v1 as unknown as SaveFile);
  check('migrate v1 succeeds', m1.ok);
  if (!m1.ok) {
    finish();
    return;
  }
  check('migrate reports it ran', m1.migrated === true);
  check('migrated schemaVersion is current', m1.file.schemaVersion === SAVE_SCHEMA_VERSION);
  check('migrated FA pool exists',
    Array.isArray(m1.file.season.freeAgentPool));
  check('migrated transaction log exists and is empty',
    Array.isArray(m1.file.season.transactionLog) && m1.file.season.transactionLog.length === 0);
  check('migrated save gains controlledTeamId: null (spectator)',
    m1.file.controlledTeamId === null);

  // --- 2. Re-serialize, then migrate again: must be a no-op ---
  const roundTripped = JSON.parse(JSON.stringify(m1.file)) as SaveFile;
  const m2 = migrateSaveFile(roundTripped);
  check('second migration succeeds', m2.ok);
  check('second migration is a no-op (reports no change)', m2.ok && m2.migrated === false);
  check('second migration is byte-identical to the first',
    m2.ok && JSON.stringify(m2.file) === JSON.stringify(roundTripped));

  // --- 3. Direct v5 -> v6 derivation refresh + guarded passthrough ---
  const v5 = structuredClone(m1.file);
  v5.schemaVersion = 5;
  const valid = v5.players.find((player) => player.careerStats.length > 0)!;
  valid.tendencies.usageRate = 0.01;
  valid.ratings.freeThrowShooting = 80;
  valid.potential.freeThrowShooting = 80;
  const invalid = v5.players.find((player) => player.id !== valid.id)!;
  invalid.careerStats = [];
  invalid.tendencies.usageRate = 0.02;
  invalid.ratings.freeThrowShooting = 79;
  invalid.potential.freeThrowShooting = 78;
  const v6 = migrateSaveFile(v5);
  check('v5 -> v6 refresh succeeds', v6.ok && v6.file.schemaVersion === SAVE_SCHEMA_VERSION);
  if (v6.ok) {
    const refreshed = v6.file.players.find((player) => player.id === valid.id)!;
    const passedThrough = v6.file.players.find((player) => player.id === invalid.id)!;
    check('v6 refreshes the three valid derived fields',
      refreshed.tendencies.usageRate !== 0.01 &&
      refreshed.ratings.freeThrowShooting !== 80 &&
      refreshed.potential.freeThrowShooting !== 80);
    check('v6 leaves invalid canonical-stat player derivations unchanged',
      passedThrough.tendencies.usageRate === 0.02 &&
      passedThrough.ratings.freeThrowShooting === 79 &&
      passedThrough.potential.freeThrowShooting === 78);
  }

  // --- 3b. Direct v6 -> v7: controlled-franchise identity ---
  const v6file = structuredClone(m1.file) as unknown as Record<string, unknown>;
  v6file.schemaVersion = 6;
  delete v6file.controlledTeamId; // a real v6 file predates the field
  const m7 = migrateSaveFile(v6file as unknown as SaveFile);
  check('v6 -> v7 migration succeeds and reports it ran', m7.ok && m7.migrated === true);
  check('v6 -> v7 adds top-level controlledTeamId: null at current version',
    m7.ok && m7.file.schemaVersion === SAVE_SCHEMA_VERSION && m7.file.controlledTeamId === null);
  if (m7.ok) {
    const strip = (f: SaveFile) => {
      const clone = JSON.parse(JSON.stringify(f)) as Record<string, unknown>;
      delete clone.schemaVersion;
      delete clone.controlledTeamId;
      return JSON.stringify(clone);
    };
    check('v6 -> v7 changes nothing besides version + new field',
      strip(m7.file) === strip(v6file as unknown as SaveFile));
    // Second run on the current v7 file: reports no migration, byte-identical.
    const v7again = migrateSaveFile(JSON.parse(JSON.stringify(m7.file)) as SaveFile);
    check('second run on a current v7 save reports no migration',
      v7again.ok && v7again.migrated === false);
    check('second run on a current v7 save is byte-identical',
      v7again.ok && JSON.stringify(v7again.file) === JSON.stringify(m7.file));
    // A non-null identity is preserved by the migration path (?? never clobbers).
    const withTeam = { ...JSON.parse(JSON.stringify(m7.file)), controlledTeamId: teams[0].id } as SaveFile;
    const withTeamAgain = migrateSaveFile(withTeam);
    check('re-migration preserves a non-null controlledTeamId',
      withTeamAgain.ok && withTeamAgain.file.controlledTeamId === teams[0].id);
  }

  // --- 4. Real SaveStore.loadSave migrates an old on-disk save ---
  const tmp = await mkdtemp(path.join(tmpdir(), 'otc-migrate-'));
  const store = new SaveStore(tmp);
  const slotDir = path.join(tmp, 'saves', 'oldsave');
  await mkdir(slotDir, { recursive: true });
  await writeFile(path.join(slotDir, 'save.json'), JSON.stringify(v1), 'utf-8');

  const loaded = await store.loadSave('oldsave');
  check('loadSave migrates an old save instead of rejecting it', loaded.ok);
  check('loaded save is at the current version with pool + empty log',
    loaded.ok &&
      loaded.file.schemaVersion === SAVE_SCHEMA_VERSION &&
      Array.isArray(loaded.file.season.freeAgentPool) &&
      loaded.file.season.transactionLog.length === 0);

  // Re-serialize through the store and reload: still clean, still current version.
  if (loaded.ok) {
    await store.overwriteSave('oldsave', loaded.file);
    const reloaded = await store.loadSave('oldsave');
    check('re-saved migrated file reloads cleanly at current version',
      reloaded.ok && reloaded.file.schemaVersion === SAVE_SCHEMA_VERSION);
  }

  // --- 5. A newer, unknown version is still rejected ---
  const futureDir = path.join(tmp, 'saves', 'fromthefuture');
  await mkdir(futureDir, { recursive: true });
  await writeFile(
    path.join(futureDir, 'save.json'),
    JSON.stringify({ ...v1, schemaVersion: SAVE_SCHEMA_VERSION + 999 }),
    'utf-8',
  );
  const future = await store.loadSave('fromthefuture');
  check('a newer (unknown) schema version is rejected, not misread', !future.ok);

  await rm(tmp, { recursive: true, force: true });
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
