/**
 * Structural validator for the normalized NBA data contracts.
 *
 * Loads whatever normalized files exist under data/nba/normalized/ and
 * asserts structural invariants. Missing files are SKIPPED, not failures —
 * the user may not have harvested every group. Exits non-zero on any FAIL.
 *
 * Run: npm run validate-nba-data
 */

import {
  hasNormalizedFile,
  listPbpGameIds,
  listSeasons,
  loadBoxAdvanced,
  loadCrosswalk,
  loadDefense,
  loadGames,
  loadHustle,
  loadLineups,
  loadManifest,
  loadPbpGame,
  loadPlayers,
  loadPlayTypes,
  loadShotEvents,
  loadShotZones,
  loadTracking,
} from '../src/data/nba/load';
import { OtcZone, SeasonEnvelope } from '../src/data/nba/types';

type Result = { file: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; detail?: string };
const results: Result[] = [];

function record(file: string, run: () => void): void {
  try {
    run();
    results.push({ file, status: 'PASS' });
  } catch (err) {
    results.push({ file, status: 'FAIL', detail: (err as Error).message });
  }
}

function skip(file: string): void {
  results.push({ file, status: 'SKIPPED', detail: 'not harvested' });
}

function fail(msg: string): never {
  throw new Error(msg);
}

function assertFinite(value: unknown, label: string): void {
  if (value === null || value === undefined) return; // nullable is fine
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} is not a finite number: ${String(value)}`);
  }
}

function assertNoDuplicatePersonIds(env: SeasonEnvelope<{ personId: number }>, file: string): void {
  const seen = new Set<number>();
  for (const row of env.rows) {
    if (typeof row.personId !== 'number' || !Number.isFinite(row.personId)) {
      fail(`${file}: row with invalid personId: ${String(row.personId)}`);
    }
    if (seen.has(row.personId)) fail(`${file}: duplicate personId ${row.personId}`);
    seen.add(row.personId);
  }
}

const OTC_ZONES: OtcZone[] = [
  'rim',
  'short_midrange',
  'long_midrange',
  'corner_three',
  'above_break_three',
];

function main(): number {
  // Seasonal, personId-keyed contracts share the duplicate/finite checks.
  const personKeyed = [
    { name: 'players', load: loadPlayers },
    { name: 'box_advanced', load: loadBoxAdvanced },
    { name: 'shot_zones', load: loadShotZones },
    { name: 'tracking', load: loadTracking },
    { name: 'defense', load: loadDefense },
    { name: 'hustle', load: loadHustle },
  ] as const;

  const allSeasons = new Set<string>();
  for (const contract of [...personKeyed.map((c) => c.name), 'playtypes', 'shot_events', 'lineups', 'games']) {
    for (const season of listSeasons(contract)) allSeasons.add(season);
  }
  if (allSeasons.size === 0) {
    console.log('No normalized NBA data found under data/nba/normalized/ — nothing to validate.');
    console.log('Run the pipeline first (see pipeline/README.md).');
    return 0;
  }

  for (const season of [...allSeasons].sort()) {
    for (const { name, load } of personKeyed) {
      const file = `${name}/${season}.json`;
      if (!hasNormalizedFile(file)) {
        skip(file);
        continue;
      }
      record(file, () => {
        const env = load(season) as SeasonEnvelope<{ personId: number }>;
        if (env.season !== season) fail(`${file}: season field ${env.season} != ${season}`);
        if (env.rows.length === 0) fail(`${file}: zero rows`);
        assertNoDuplicatePersonIds(env, file);
      });
    }

    const shotZonesFile = `shot_zones/${season}.json`;
    if (hasNormalizedFile(shotZonesFile)) {
      record(`${shotZonesFile} (zone sums)`, () => {
        const env = loadShotZones(season);
        for (const row of env.rows) {
          let otcFga = 0;
          for (const zone of OTC_ZONES) {
            const line = row.otcZones[zone];
            if (!line) fail(`${shotZonesFile}: personId ${row.personId} missing otc zone ${zone}`);
            assertFinite(line.fga, `${shotZonesFile}: ${row.personId} ${zone}.fga`);
            assertFinite(line.fgm, `${shotZonesFile}: ${row.personId} ${zone}.fgm`);
            if (line.fgm > line.fga) fail(`${shotZonesFile}: ${row.personId} ${zone} fgm > fga`);
            otcFga += line.fga;
          }
          // Mapped zones must repartition the raw NBA zones exactly
          // ("Corner 3" is an aggregate of LC3+RC3 and is excluded).
          let nbaFga = 0;
          for (const [zone, line] of Object.entries(row.nbaZones)) {
            if (zone === 'Corner 3') continue;
            nbaFga += line.fga ?? 0;
          }
          if (otcFga !== nbaFga) {
            fail(`${shotZonesFile}: ${row.personId} otc FGA ${otcFga} != nba FGA ${nbaFga}`);
          }
        }
      });
    }

    const playtypesFile = `playtypes/${season}.json`;
    if (hasNormalizedFile(playtypesFile)) {
      record(playtypesFile, () => {
        const env = loadPlayTypes(season);
        if (env.rows.length === 0) fail(`${playtypesFile}: zero rows`);
        const seen = new Set<string>();
        for (const row of env.rows) {
          // teamId is part of the key: a traded player has one row per team
          const key = `${row.personId}|${row.typeGrouping}|${row.playType}|${row.teamId}`;
          if (seen.has(key)) fail(`${playtypesFile}: duplicate row ${key}`);
          seen.add(key);
          assertFinite(row.poss, `${playtypesFile}: ${key} poss`);
          assertFinite(row.ppp, `${playtypesFile}: ${key} ppp`);
          assertFinite(row.possPct, `${playtypesFile}: ${key} possPct`);
        }
      });
    }

    const shotEventsFile = `shot_events/${season}.json`;
    if (hasNormalizedFile(shotEventsFile)) {
      record(shotEventsFile, () => {
        const env = loadShotEvents(season);
        if (env.rows.length === 0) fail(`${shotEventsFile}: zero rows`);
        for (const row of env.rows) {
          if (typeof row.gameId !== 'string' || row.gameId.length === 0) {
            fail(`${shotEventsFile}: event with missing gameId`);
          }
          assertFinite(row.playerId, `${shotEventsFile}: playerId`);
          assertFinite(row.locX, `${shotEventsFile}: locX`);
          assertFinite(row.locY, `${shotEventsFile}: locY`);
          if (typeof row.made !== 'boolean') fail(`${shotEventsFile}: made not boolean`);
        }
      });
    }

    const lineupsFile = `lineups/${season}.json`;
    if (hasNormalizedFile(lineupsFile)) {
      record(lineupsFile, () => {
        const env = loadLineups(season);
        if (env.rows.length === 0) fail(`${lineupsFile}: zero rows`);
        for (const row of env.rows) {
          if (!Array.isArray(row.personIds) || row.personIds.length !== 5) {
            fail(`${lineupsFile}: lineup without exactly 5 personIds`);
          }
          for (const pid of row.personIds) assertFinite(pid, `${lineupsFile}: personId`);
          assertFinite(row.minutes, `${lineupsFile}: minutes`);
        }
      });
    }

    const gamesFile = `games/${season}.json`;
    if (hasNormalizedFile(gamesFile)) {
      record(gamesFile, () => {
        const env = loadGames(season);
        if (env.rows.length === 0) fail(`${gamesFile}: zero rows`);
        const seen = new Set<string>();
        for (const row of env.rows) {
          if (seen.has(row.gameId)) fail(`${gamesFile}: duplicate gameId ${row.gameId}`);
          seen.add(row.gameId);
          assertFinite(row.homeTeamId, `${gamesFile}: ${row.gameId} homeTeamId`);
          assertFinite(row.awayTeamId, `${gamesFile}: ${row.gameId} awayTeamId`);
          assertFinite(row.homeScore, `${gamesFile}: ${row.gameId} homeScore`);
          assertFinite(row.awayScore, `${gamesFile}: ${row.gameId} awayScore`);
        }
      });
    }

    const pbpGameIds = listPbpGameIds(season);
    if (pbpGameIds.length === 0) {
      skip(`pbp/${season}/`);
    } else {
      record(`pbp/${season}/ (${pbpGameIds.length} games)`, () => {
        for (const gameId of pbpGameIds) {
          const game = loadPbpGame(season, gameId);
          if (game.gameId !== gameId) {
            fail(`pbp/${season}/${gameId}.json: gameId field ${game.gameId} != ${gameId}`);
          }
          if (game.rows.length === 0) fail(`pbp/${season}/${gameId}.json: zero actions`);
          for (const action of game.rows) {
            assertFinite(action.actionNumber, `pbp ${gameId} actionNumber`);
            assertFinite(action.period, `pbp ${gameId} period`);
            assertFinite(action.clockSeconds, `pbp ${gameId} clockSeconds`);
          }
        }
      });
    }
  }

  if (hasNormalizedFile('crosswalk.json')) {
    record('crosswalk.json', () => {
      const xwalk = loadCrosswalk();
      const seenSource = new Set<string>();
      for (const row of xwalk.rows) {
        if (typeof row.sourceId !== 'string' || row.sourceId.length === 0) {
          fail('crosswalk.json: row with missing sourceId');
        }
        if (seenSource.has(row.sourceId)) fail(`crosswalk.json: duplicate sourceId ${row.sourceId}`);
        seenSource.add(row.sourceId);
        if (row.bdlId !== null) assertFinite(row.bdlId, `crosswalk ${row.sourceId} bdlId`);
        assertFinite(row.nbaPersonId, `crosswalk ${row.sourceId} nbaPersonId`);
        if (!Number.isInteger(row.nbaPersonId) || row.nbaPersonId <= 0) {
          fail(`crosswalk.json: ${row.sourceId} has malformed nbaPersonId ${row.nbaPersonId}`);
        }
      }
    });
  } else {
    skip('crosswalk.json');
  }

  if (hasNormalizedFile('manifest.json')) {
    record('manifest.json', () => {
      const manifest = loadManifest();
      if (typeof manifest.generated_at !== 'string') fail('manifest.json: missing generated_at');
      if (manifest === null || typeof manifest.contracts !== 'object') {
        fail('manifest.json: missing contracts map');
      }
    });
  } else {
    skip('manifest.json');
  }

  const width = Math.max(...results.map((r) => r.file.length));
  let failures = 0;
  for (const r of results) {
    const detail = r.detail ? `  ${r.detail}` : '';
    console.log(`${r.status.padEnd(7)} ${r.file.padEnd(width)}${detail}`);
    if (r.status === 'FAIL') failures += 1;
  }
  const passed = results.filter((r) => r.status === 'PASS').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED').length;
  console.log(`\n${passed} passed, ${failures} failed, ${skipped} skipped`);
  return failures > 0 ? 1 : 0;
}

process.exit(main());
