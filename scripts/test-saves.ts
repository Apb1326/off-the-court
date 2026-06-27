/**
 * Tests the multi-save system end-to-end against real persisted state.
 *
 * Proves the load-bearing property: saving, reloading, and continuing resumes
 * the simulation byte-identically — the seed/cursor/RNG state survives a round
 * trip to disk with no reset. Also exercises the CRUD + robustness paths
 * (list/create/overwrite/rename/delete, corrupt metadata, schema mismatch).
 *
 * Standalone (no Next runtime). Runs against a throwaway temp data dir so it
 * never touches the real data/saves. Run with:
 *   node_modules/.bin/tsx scripts/test-saves.ts
 */
import { readFile, mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SeasonState, isControlledTeam } from '../src/models/season';
import { SaveFile, SAVE_SCHEMA_VERSION, derivePhase } from '../src/models/save';
import { SaveStore } from '../src/data/saves/save-store';
import { createSeasonState, advanceSeason } from '../src/engine/season';
import { addDays } from '../src/engine/calendar';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

/** Structural fingerprint of everything advancing should be able to change. */
function fingerprint(state: SeasonState): string {
  return JSON.stringify({
    currentDate: state.currentDate,
    gamesPlayed: state.gamesPlayed,
    results: state.results.map((r) => `${r.id}:${r.homeScore}-${r.awayScore}`),
    standings: state.standings.map((s) => `${s.teamId}:${s.wins}-${s.losses}:${s.pointsFor}/${s.pointsAgainst}`),
    playerTotals: state.playerStats.map((s) => `${s.playerId}:${s.gamesPlayed}:${s.totals.points}:${s.minutes}`),
    injuries: state.injuries.map((i) => `${i.playerId}:${i.gamesRemaining}`),
  });
}

function buildSaveFile(season: SeasonState, teams: Team[], players: Player[]): SaveFile {
  const now = new Date().toISOString();
  return { schemaVersion: 0, phase: derivePhase(season), season, teams, players, createdAt: now, updatedAt: now };
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const tmp = await mkdtemp(path.join(tmpdir(), 'otc-saves-'));
  const store = new SaveStore(tmp);

  const SEED = 2026;
  const startDate = createSeasonState(teams, players, { seed: SEED }).startDate;
  const day14 = addDays(startDate, 14);
  const day28 = addDays(startDate, 28);

  // --- Control: advance a fresh season straight through, no persistence. ---
  const control = createSeasonState(teams, players, { seed: SEED });
  advanceSeason(control, day14, teams, players);
  advanceSeason(control, day28, teams, players);
  const controlFinal = fingerprint(control);

  // --- Resume path: new game -> autosave -> advance -> checkpoint -> reload -> continue. ---
  const fresh = createSeasonState(teams, players, { seed: SEED });
  await store.autoSave(buildSaveFile(fresh, teams, players));

  // Advance the live (autosave) state to day 14, persisting through disk each step.
  let live = (await store.loadActiveSave())!;
  check('active save loads after new game', !!live);
  advanceSeason(live.season, day14, live.teams, live.players);
  await store.autoSave(live);
  const at14 = fingerprint(live.season);

  // Snapshot a manual checkpoint at day 14.
  const checkpointMeta = await store.createSave('checkpoint', (await store.loadActiveSave())!);
  check('createSave returns a manual (non-autosave) slot', !checkpointMeta.isAutosave);

  // Continue the live state PAST the checkpoint to day 28.
  live = (await store.loadActiveSave())!;
  advanceSeason(live.season, day28, live.teams, live.players);
  await store.autoSave(live);
  const continued = fingerprint(live.season);
  check('continue-past-checkpoint matches straight-through control', continued === controlFinal);

  // The checkpoint slot must be untouched by the continued auto-saving.
  const checkpointReload = await store.loadSave(checkpointMeta.saveId);
  check('checkpoint not clobbered by later auto-saves',
    checkpointReload.ok && fingerprint(checkpointReload.file.season) === at14);

  // Load the checkpoint back into the live slot and advance from there to day 28.
  const loaded = await store.copyToAutosave(checkpointMeta.saveId);
  check('copyToAutosave succeeds', !('error' in loaded));
  const resumed = (await store.loadActiveSave())!;
  check('resumed live state equals the checkpoint (day 14)', fingerprint(resumed.season) === at14);
  advanceSeason(resumed.season, day28, resumed.teams, resumed.players);
  await store.autoSave(resumed);
  check('reload-then-resume is byte-identical to control (no seed/cursor reset)',
    fingerprint(resumed.season) === controlFinal);

  // --- CRUD + robustness ---
  const listed = await store.listSaves();
  check('listSaves includes autosave + checkpoint', listed.saves.length === 2 && listed.errors.length === 0);
  check('autosave sorts first', listed.saves[0].isAutosave);

  const renamed = await store.renameSave(checkpointMeta.saveId, 'My Checkpoint');
  check('rename changes display name', !('error' in renamed) && renamed.name === 'My Checkpoint');
  const afterRename = await store.listSaves();
  check('rename keeps folder id stable',
    afterRename.saves.some((s) => s.saveId === checkpointMeta.saveId && s.name === 'My Checkpoint'));

  const dup = await store.createSave('checkpoint', resumed);
  check('duplicate name gets a unique slot id', dup.saveId !== checkpointMeta.saveId);

  // Corrupt a metadata.json — listSaves must skip + surface it, not throw.
  await writeFile(path.join(tmp, 'saves', dup.saveId, 'metadata.json'), '{ not valid json', 'utf-8');
  const afterCorrupt = await store.listSaves();
  check('corrupt metadata is skipped and surfaced',
    afterCorrupt.errors.some((e) => e.saveId === dup.saveId) &&
    !afterCorrupt.saves.some((s) => s.saveId === dup.saveId));

  // Schema-version mismatch must be rejected gracefully (no crash, no bad read).
  await writeFile(
    path.join(tmp, 'saves', checkpointMeta.saveId, 'save.json'),
    JSON.stringify({ ...resumed, schemaVersion: SAVE_SCHEMA_VERSION + 999 }),
    'utf-8',
  );
  const badVersion = await store.loadSave(checkpointMeta.saveId);
  check('wrong schema version is rejected, not misread', !badVersion.ok);

  // Delete round-trip.
  await store.deleteSave(checkpointMeta.saveId);
  const afterDelete = await store.listSaves();
  check('delete removes the slot', !afterDelete.saves.some((s) => s.saveId === checkpointMeta.saveId));

  // --- Controlled team: selection persists across a save/load round trip. ---
  const myTeamId = teams[0].id;
  const withTeam = createSeasonState(teams, players, { seed: SEED, controlledTeamId: myTeamId });
  check('createSeasonState records the controlled team', withTeam.controlledTeamId === myTeamId);
  const teamSlot = await store.createSave('with team', buildSaveFile(withTeam, teams, players));
  const teamReload = await store.loadSave(teamSlot.saveId);
  check('controlled team survives save/load', teamReload.ok && teamReload.file.season.controlledTeamId === myTeamId);
  check('isControlledTeam accessor distinguishes my team from CPU teams',
    teamReload.ok && isControlledTeam(teamReload.file.season, myTeamId) && !isControlledTeam(teamReload.file.season, teams[1].id));

  // --- Legacy v1 save (pre-controlledTeamId) migrates forward, not rejected. ---
  const legacySlot = await store.createSave('legacy v1', buildSaveFile(withTeam, teams, players));
  const legacyPath = path.join(tmp, 'saves', legacySlot.saveId, 'save.json');
  const legacyRaw = JSON.parse(await readFile(legacyPath, 'utf-8'));
  delete legacyRaw.season.controlledTeamId; // v1 seasons had no such field
  legacyRaw.schemaVersion = 1;
  await writeFile(legacyPath, JSON.stringify(legacyRaw), 'utf-8');
  const migrated = await store.loadSave(legacySlot.saveId);
  check('v1 save loads (migrated forward, not rejected)', migrated.ok);
  check('migration bumps schemaVersion to current', migrated.ok && migrated.file.schemaVersion === SAVE_SCHEMA_VERSION);
  check('migration defaults a missing controlledTeamId to null', migrated.ok && migrated.file.season.controlledTeamId === null);

  await rm(tmp, { recursive: true, force: true });

  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
