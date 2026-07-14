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
import { SeasonState } from '../src/models/season';
import { SaveFile, SAVE_SCHEMA_VERSION, derivePhase } from '../src/models/save';
import { SaveStore } from '../src/data/saves/save-store';
import { getControlledTeamId, isControlledTeam } from '../src/franchise/controlled';
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

function buildSaveFile(
  season: SeasonState,
  teams: Team[],
  players: Player[],
  controlledTeamId: string | null = null,
): SaveFile {
  const now = new Date().toISOString();
  return { schemaVersion: 0, phase: derivePhase(season), season, teams, players, controlledTeamId, createdAt: now, updatedAt: now };
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

  // --- F1: controlled-franchise identity persistence ---
  const controlledTeam = teams[0];
  const controlledSeason = createSeasonState(teams, players, { seed: SEED });
  advanceSeason(controlledSeason, day14, teams, players);
  const controlledFile = buildSaveFile(controlledSeason, teams, players, controlledTeam.id);
  const controlledMeta = await store.createSave('controlled', controlledFile);
  const controlledReload = await store.loadSave(controlledMeta.saveId);
  check('controlled team id survives save/load',
    controlledReload.ok && getControlledTeamId(controlledReload.file) === controlledTeam.id);
  check('isControlledTeam matches only the controlled team',
    controlledReload.ok && isControlledTeam(controlledReload.file, controlledTeam.id) &&
    !isControlledTeam(controlledReload.file, teams[1].id));
  check('controlled save summary carries the team abbreviation tag',
    controlledMeta.summary.startsWith(`${controlledTeam.abbreviation} · `) &&
    controlledMeta.summary.includes('games'));

  // Metadata regeneration (copy to autosave rewrites metadata) keeps identity + tag.
  await store.copyToAutosave(controlledMeta.saveId);
  const controlledActive = (await store.loadActiveSave())!;
  check('controlled team id survives copyToAutosave',
    getControlledTeamId(controlledActive) === controlledTeam.id);
  const regenerated = await store.listSaves();
  const autoMeta = regenerated.saves.find((s) => s.isAutosave);
  check('regenerated autosave metadata keeps the abbreviation tag',
    !!autoMeta && autoMeta.summary.startsWith(`${controlledTeam.abbreviation} · `));

  // Spectator save: null identity, league-wide summary with no team tag.
  const spectatorFile = buildSaveFile(controlledSeason, teams, players, null);
  const spectatorMeta = await store.createSave('spectator', spectatorFile);
  const spectatorReload = await store.loadSave(spectatorMeta.saveId);
  check('spectator save persists controlledTeamId === null',
    spectatorReload.ok && getControlledTeamId(spectatorReload.file) === null);
  check('spectator summary stays league-wide (no team tag)',
    !spectatorMeta.summary.startsWith(`${controlledTeam.abbreviation} · `) &&
    spectatorMeta.summary.includes('games'));

  // --- F2: playoff phase + champion metadata persistence ---
  const playoffSeason = createSeasonState(teams, players, { seed: SEED });
  playoffSeason.gamesPlayed = playoffSeason.totalGames;
  playoffSeason.currentDate = playoffSeason.endDate;
  playoffSeason.playoffs.status = 'in_progress';
  playoffSeason.playoffs.startDate = addDays(playoffSeason.endDate, 2);
  playoffSeason.playoffs.endDate = addDays(playoffSeason.endDate, 90);
  const playoffMeta = await store.createSave('playoffs', buildSaveFile(playoffSeason, teams, players));
  const playoffReload = await store.loadSave(playoffMeta.saveId);
  check('playoff phase survives save/load and metadata derivation',
    playoffReload.ok && derivePhase(playoffReload.file.season) === 'playoffs' && playoffMeta.phase === 'playoffs');

  playoffSeason.playoffs.championTeamId = controlledTeam.id;
  let malformedChampionRejected = false;
  try {
    await store.createSave('malformed champion', buildSaveFile(playoffSeason, teams, players));
  } catch (error) {
    malformedChampionRejected = error instanceof Error &&
      error.message === 'completed playoff state must carry exactly one championTeamId';
  }
  check('write boundary rejects a champion on a non-complete postseason', malformedChampionRejected);
  const savesAfterMalformedAttempt = await store.listSaves();
  check('rejected malformed champion save is not persisted',
    !savesAfterMalformedAttempt.saves.some((save) => save.name === 'malformed champion'));

  playoffSeason.playoffs.status = 'complete';
  const championMeta = await store.createSave('champion', buildSaveFile(playoffSeason, teams, players));
  const championReload = await store.loadSave(championMeta.saveId);
  check('champion survives save/load',
    championReload.ok && championReload.file.season.playoffs.championTeamId === controlledTeam.id);
  check('champion save summary names the winning team',
    championMeta.phase === 'offseason' && championMeta.summary.includes(`Champion ${controlledTeam.abbreviation}`));

  playoffSeason.playoffs.status = 'grandfathered_complete';
  playoffSeason.playoffs.championTeamId = null;
  const legacyMeta = await store.createSave('legacy complete', buildSaveFile(playoffSeason, teams, players));
  check('grandfathered completion never fabricates a champion in metadata',
    legacyMeta.phase === 'offseason' && legacyMeta.summary.includes('Season complete') && !legacyMeta.summary.includes('Champion'));

  await rm(tmp, { recursive: true, force: true });

  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
