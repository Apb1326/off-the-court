/** Focused deterministic tests for the S3.a projection and pair seams. */
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

import { LineupRow, ShotZonesRow } from '../src/data/nba/types';
import { deriveNbaTendencies, TendencyInput } from '../src/ratings/nba-tendencies';
import { seasonRelativeNbaDerivationOptions } from '../src/ratings/nba-derivation';
import { canonicalLineupKey, canonicalPairKey, enforceRegressionBaseline, harmonicMean, isUsableLineupRow } from './validate-lineups';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`S3.a test failed: ${message}`);
}

function assertThrows(action: () => void, message: string): void {
  try { action(); } catch { return; }
  throw new Error(`S3.a test failed: ${message}`);
}

function boxRow(season: string, usgPct: number, poss: number) {
  return {
    personId: 1,
    name: 'Fixture Player',
    teamId: 1,
    age: 25,
    gp: 50,
    mpg: 30,
    perGame: { gp: 50, w: 0, l: 0, min: 1500, fgm: 250, fga: 500, fgPct: 0.5, fg3m: 50, fg3a: 150, fg3Pct: 0.333, ftm: 100, fta: 120, ftPct: 0.833, oreb: 50, dreb: 200, reb: 250, ast: 200, tov: 100, stl: 50, blk: 20, blka: 0, pf: 100, pfd: 100, pts: 650, plusMinus: 0 },
    advanced: { offRating: 110, defRating: 105, netRating: 5, astPct: 0.2, astTo: 2, astRatio: 15, orebPct: 0.05, drebPct: 0.15, rebPct: 0.1, tmTovPct: 0.12, efgPct: 0.55, tsPct: 0.58, usgPct, pace: 100, pie: 0.1, poss },
    usage: null, scoring: null, defense: null, per100: { fgm: 10, fga: 20, fg3m: 2, fg3a: 6, ftm: 4, fta: 5, oreb: 2, dreb: 8, reb: 10, ast: 8, tov: 4, stl: 2, blk: 1, pf: 4, pfd: 4, pts: 26 },
    season,
  };
}

function tendencyFixture(): TendencyInput {
  const target = boxRow('2007-08', 0.2, 200);
  const future = boxRow('2008-09', 0.4, 10000);
  const zones: ShotZonesRow = {
    personId: 1,
    name: 'Fixture Player',
    teamId: 1,
    nbaZones: { Backcourt: { fgm: 2, fga: 5 } },
    otcZones: {
      rim: { fgm: 50, fga: 100 },
      short_midrange: { fgm: 15, fga: 30 },
      long_midrange: { fgm: 0, fga: 0 },
      corner_three: { fgm: 4, fga: 20 },
      above_break_three: { fgm: 5, fga: 10 },
    },
  };
  return {
    personId: 1,
    id: 'nba_1',
    position: 'PG',
    boxSeasons: [{ season: '2007-08', row: target }, { season: '2008-09', row: future }],
    shotZoneSeasons: [{ season: '2007-08', row: zones }],
    raw: { gamesPlayed: 50, minutesPerGame: 30, stats: { fieldGoalsAttempted: 500, freeThrowsAttempted: 120, assists: 200, rebounds: 250 } },
  };
}

function main(): void {
  assert(canonicalLineupKey([5, 2, 4, 1, 3]) === '1,2,3,4,5', 'lineup keys sort player IDs');
  assert(canonicalPairKey('2007-08', '1', [5, 2, 4, 1, 3], [6, 2, 4, 1, 3]) === canonicalPairKey('2007-08', '1', [6, 2, 4, 1, 3], [5, 2, 4, 1, 3]), 'pair keys are direction-independent');
  assert(Math.abs(harmonicMean(100, 300) - 150) < 1e-12, 'pair weight is harmonic mean');
  assert(enforceRegressionBaseline('fixture', 0.05, 0.05, 0.01, 0.0001) === 0.04, 'frozen regression floor is applied');
  assertThrows(() => enforceRegressionBaseline('fixture', 0, 0.05, 0.01, 0.0001), 'non-positive regression is rejected by the frozen numerical floor');

  const ids = new Set([1, 2, 3, 4, 5]);
  const usable: LineupRow = { personIds: [1, 2, 3, 4, 5], teamId: 1, gp: 10, minutes: 20, possessions: 100, offRating: 110, defRating: 105, netRating: 5 };
  assert(isUsableLineupRow(usable, ids), 'mechanical usable-row definition accepts complete finite row');
  assert(!isUsableLineupRow({ ...usable, possessions: 0 }, ids), 'usable-row definition rejects non-positive possessions');
  assert(!isUsableLineupRow({ ...usable, personIds: [1, 2, 3, 4, 6] }, ids), 'usable-row definition rejects identity miss');
  assert(!isUsableLineupRow({ ...usable, netRating: null }, ids), 'usable-row definition rejects missing observed metric');

  const options = seasonRelativeNbaDerivationOptions('2007-08');
  assert(options.recentSeasons.join(',') === '2007-08,2006-07,2005-06', 'historical recent window is target-relative');
  assert(!options.recentSeasons.includes('2008-09'), 'historical recent window excludes future season');
  const result = deriveNbaTendencies([tendencyFixture()], [], [], { ...options, targetSeason: '2007-08' });
  const tendency = result.tendencies.get(1)!;
  assert(Math.abs(tendency.usageRate - 0.2) < 1e-9, 'usage derivation ignores future-season row');
  assert(result.shotMixSource.get(1) === 'shot_zones', 'shot mix rescue uses shot_zones when shot_events are absent');
  assert(Math.abs(tendency.rimRate - 100 / 155) < 1e-9 && Math.abs(tendency.midrangeRate - 30 / 155) < 1e-9 && Math.abs(tendency.threePointRate - 25 / 155) < 1e-9, 'shot-zone rescue matches post-heave hand-computed shares');

  const first = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/validate-lineups.ts', '--stdout'], { encoding: 'utf8' });
  const second = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/validate-lineups.ts', '--stdout'], { encoding: 'utf8' });
  assert(first.status === 0 && second.status === 0, 'full validation runs succeed twice');
  const firstHash = crypto.createHash('sha256').update(first.stdout).digest('hex');
  const secondHash = crypto.createHash('sha256').update(second.stdout).digest('hex');
  assert(firstHash === secondHash, 'full validation stdout is deterministic');
  console.log('S3.a lineup seam tests passed: canonicalization, leakage, weighting, usable rows, shot rescue, and deterministic output.');
}

main();
