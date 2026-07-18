/**
 * S3.b1 defender-assignment evidence derivation.
 *
 * Reads normalized defense.matchupsByOppPosition.partialPoss and the matching
 * seasonal players contract. It writes a generated 5x3 supply-adjusted lift
 * block in engine/constants.ts plus docs/S3B1_MATCHUP_DERIVATION.md.
 *
 * Deterministic: no RNG or timestamps; seasons, personIds, and buckets use
 * fixed order; --check byte-compares both generated outputs and writes nothing.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  loadDefense,
  loadManifest,
  loadPlayers,
  listSeasons,
} from '../src/data/nba/load';
import {
  NBA_POSITION_FALLBACK,
  enginePositionToMatchupBucket,
  nbaMatchupBucketToRuntimeBucket,
  nbaPrimaryPosition,
  type MatchupPositionBucket,
} from '../src/data/nba/position-mapping';
import type { Position } from '../src/models/player';

const REPORT_PATH = path.join(process.cwd(), 'docs', 'S3B1_MATCHUP_DERIVATION.md');
const CONSTANTS_PATH = path.join(process.cwd(), 'src', 'engine', 'constants.ts');
const BLOCK_START = '// BEGIN GENERATED S3B1 MATCHUP LIFT';
const BLOCK_END = '// END GENERATED S3B1 MATCHUP LIFT';

const DEFENDER_POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const RAW_BUCKETS = ['G', 'G-F', 'F-G', 'F', 'F-C', 'C-F', 'C'] as const;
const RUNTIME_BUCKETS: readonly MatchupPositionBucket[] = ['G', 'F', 'C'];
const IN_PROGRESS_SEASON = '2025-26';

// Predeclared gates, chosen before fitting.
const MIN_ROSTERED_DEFENDER_COVERAGE = 0.90;
const MIN_POSITION_JOIN_RATE = 0.98;
const MIN_LIFT_CELL_PARTIAL_POSS = 1_000;
const MIN_MARGINAL_PARTIAL_POSS = 10_000;
const CONSISTENCY_TOLERANCE = 0.000_002;

type RawBucket = typeof RAW_BUCKETS[number];
type Matrix<B extends string> = Record<Position, Record<B, number>>;

interface CoverageRow {
  season: string;
  rosteredDefenders: number;
  defendersWithMatchups: number;
  coverage: number;
  included: boolean;
}

interface Derivation {
  coverage: CoverageRow[];
  includedSeasons: string[];
  expectedCompletedSeasons: string[];
  raw: Matrix<RawBucket>;
  aggregated: Matrix<MatchupPositionBucket>;
  columnShares: Matrix<MatchupPositionBucket>;
  lifts: Matrix<MatchupPositionBucket>;
  positionMarginal: Record<Position, number>;
  bucketMarginal: Record<MatchupPositionBucket, number>;
  consistency: Record<Position, number>;
  knownPartialPoss: number;
  unknownPartialPoss: number;
  joinedRows: number;
  eligibleRows: number;
  joinedPartialPoss: number;
  eligiblePartialPoss: number;
}

function matrix<B extends string>(buckets: readonly B[]): Matrix<B> {
  return Object.fromEntries(DEFENDER_POSITIONS.map((position) => [
    position,
    Object.fromEntries(buckets.map((bucket) => [bucket, 0])) as Record<B, number>,
  ])) as Matrix<B>;
}

function seasonFromStart(start: number): string {
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function expectedCompletedSeasons(): string[] {
  const manifestPath = path.join(process.cwd(), 'pipeline', 'manifests', 'default.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    groups?: { matchups?: { seasons?: { from?: number; to?: number } } };
  };
  const window = manifest.groups?.matchups?.seasons;
  if (!window || !Number.isInteger(window.from) || !Number.isInteger(window.to)) {
    throw new Error('pipeline/manifests/default.json has no valid matchups season window');
  }
  const seasons: string[] = [];
  for (let start = window.from!; start <= window.to!; start++) {
    const season = seasonFromStart(start);
    if (season !== IN_PROGRESS_SEASON) seasons.push(season);
  }
  return seasons;
}

function assertAggregationVocabulary(): void {
  const locked: Record<RawBucket, MatchupPositionBucket> = {
    G: 'G', 'G-F': 'G', 'F-G': 'F', F: 'F', 'F-C': 'F', 'C-F': 'F', C: 'C',
  };
  for (const bucket of RAW_BUCKETS) {
    const composed = nbaMatchupBucketToRuntimeBucket(bucket);
    if (composed !== locked[bucket]) {
      throw new Error(`position aggregation mismatch for ${bucket}: production composition=${String(composed)}, locked=${locked[bucket]}`);
    }
  }
  for (const position of DEFENDER_POSITIONS) {
    if (!RUNTIME_BUCKETS.includes(enginePositionToMatchupBucket(position))) {
      throw new Error(`engine position ${position} has no reachable runtime matchup bucket`);
    }
  }
}

function uniquePlayerPositions(season: string): Map<number, Position> {
  const positions = new Map<number, Position>();
  for (const row of [...loadPlayers(season).rows].sort((a, b) => a.personId - b.personId)) {
    const mapped = nbaPrimaryPosition(row.position) ?? NBA_POSITION_FALLBACK;
    const existing = positions.get(row.personId);
    if (existing !== undefined && existing !== mapped) {
      throw new Error(`${season}: conflicting player positions for personId ${row.personId}: ${existing} vs ${mapped}`);
    }
    positions.set(row.personId, mapped);
  }
  return positions;
}

function positivePartialPoss(buckets: Readonly<Record<string, { partialPoss: number }>>): number {
  return Object.keys(buckets).sort().reduce((sum, key) => {
    const bucket = buckets[key];
    if (!Number.isFinite(bucket.partialPoss) || bucket.partialPoss < 0) throw new Error('invalid matchup partialPoss');
    return sum + bucket.partialPoss;
  }, 0);
}

function derive(): Derivation {
  assertAggregationVocabulary();
  const manifest = loadManifest();
  if (!manifest.complete || manifest.completeness_issues.length > 0) {
    throw new Error('normalized NBA manifest is incomplete; stop and repair/re-harvest intentionally');
  }

  const defenseSeasons = listSeasons('defense').filter((season) => season !== IN_PROGRESS_SEASON).sort();
  const coverage: CoverageRow[] = [];
  for (const season of defenseSeasons) {
    const players = uniquePlayerPositions(season);
    const rostered = new Set(players.keys());
    const withMatchups = new Set(
      loadDefense(season).rows
        .filter((row) => rostered.has(row.personId) && positivePartialPoss(row.matchupsByOppPosition) > 0)
        .map((row) => row.personId),
    );
    const value = rostered.size === 0 ? 0 : withMatchups.size / rostered.size;
    coverage.push({
      season,
      rosteredDefenders: rostered.size,
      defendersWithMatchups: withMatchups.size,
      coverage: value,
      included: value >= MIN_ROSTERED_DEFENDER_COVERAGE,
    });
  }

  const includedSeasons = coverage.filter((row) => row.included).map((row) => row.season);
  if (includedSeasons.length < 2) {
    throw new Error(`matchup window has ${includedSeasons.length} qualifying season(s); need at least 2`);
  }

  const raw = matrix(RAW_BUCKETS);
  let unknownPartialPoss = 0;
  let joinedRows = 0;
  let eligibleRows = 0;
  let joinedPartialPoss = 0;
  let eligiblePartialPoss = 0;

  for (const season of includedSeasons) {
    const positions = uniquePlayerPositions(season);
    const rows = [...loadDefense(season).rows].sort((a, b) => a.personId - b.personId);
    for (const row of rows) {
      const rowTotal = positivePartialPoss(row.matchupsByOppPosition);
      if (rowTotal <= 0) continue;
      eligibleRows++;
      eligiblePartialPoss += rowTotal;
      const defenderPosition = positions.get(row.personId);
      if (defenderPosition === undefined) continue;
      joinedRows++;
      joinedPartialPoss += rowTotal;

      for (const bucket of Object.keys(row.matchupsByOppPosition).sort()) {
        const partialPoss = row.matchupsByOppPosition[bucket].partialPoss;
        if (bucket === 'UNK') {
          unknownPartialPoss += partialPoss;
          continue;
        }
        if (!(RAW_BUCKETS as readonly string[]).includes(bucket)) {
          throw new Error(`${season} personId ${row.personId}: unexpected opponent position bucket ${bucket}`);
        }
        raw[defenderPosition][bucket as RawBucket] += partialPoss;
      }
    }
  }

  const joinRate = eligibleRows === 0 ? 0 : joinedRows / eligibleRows;
  if (joinRate < MIN_POSITION_JOIN_RATE) {
    throw new Error(`defender-position join rate ${(joinRate * 100).toFixed(2)}% is below ${(MIN_POSITION_JOIN_RATE * 100).toFixed(2)}%`);
  }

  const aggregated = matrix(RUNTIME_BUCKETS);
  for (const position of DEFENDER_POSITIONS) {
    for (const rawBucket of RAW_BUCKETS) {
      const runtimeBucket = nbaMatchupBucketToRuntimeBucket(rawBucket);
      if (runtimeBucket === undefined) throw new Error(`no runtime bucket for ${rawBucket}`);
      aggregated[position][runtimeBucket] += raw[position][rawBucket];
    }
  }

  const positionTotals = Object.fromEntries(DEFENDER_POSITIONS.map((position) => [
    position,
    RUNTIME_BUCKETS.reduce((sum, bucket) => sum + aggregated[position][bucket], 0),
  ])) as Record<Position, number>;
  const bucketTotals = Object.fromEntries(RUNTIME_BUCKETS.map((bucket) => [
    bucket,
    DEFENDER_POSITIONS.reduce((sum, position) => sum + aggregated[position][bucket], 0),
  ])) as Record<MatchupPositionBucket, number>;
  const knownPartialPoss = RUNTIME_BUCKETS.reduce((sum, bucket) => sum + bucketTotals[bucket], 0);

  for (const position of DEFENDER_POSITIONS) {
    if (positionTotals[position] < MIN_MARGINAL_PARTIAL_POSS) {
      throw new Error(`${position} marginal ${positionTotals[position].toFixed(2)} is below ${MIN_MARGINAL_PARTIAL_POSS}`);
    }
    for (const bucket of RUNTIME_BUCKETS) {
      if (aggregated[position][bucket] < MIN_LIFT_CELL_PARTIAL_POSS) {
        throw new Error(`${position}/${bucket} cell ${aggregated[position][bucket].toFixed(2)} is below ${MIN_LIFT_CELL_PARTIAL_POSS}`);
      }
    }
  }
  for (const bucket of RUNTIME_BUCKETS) {
    if (bucketTotals[bucket] < MIN_MARGINAL_PARTIAL_POSS) {
      throw new Error(`${bucket} bucket marginal ${bucketTotals[bucket].toFixed(2)} is below ${MIN_MARGINAL_PARTIAL_POSS}`);
    }
  }

  const positionMarginal = Object.fromEntries(DEFENDER_POSITIONS.map((position) => [position, positionTotals[position] / knownPartialPoss])) as Record<Position, number>;
  const bucketMarginal = Object.fromEntries(RUNTIME_BUCKETS.map((bucket) => [bucket, bucketTotals[bucket] / knownPartialPoss])) as Record<MatchupPositionBucket, number>;
  const columnShares = matrix(RUNTIME_BUCKETS);
  const lifts = matrix(RUNTIME_BUCKETS);
  const consistency = {} as Record<Position, number>;
  for (const position of DEFENDER_POSITIONS) {
    for (const bucket of RUNTIME_BUCKETS) {
      columnShares[position][bucket] = aggregated[position][bucket] / bucketTotals[bucket];
      // The committed runtime quantity is rounded to six decimals; run the
      // consistency check on that exact rounded value, not hidden precision.
      lifts[position][bucket] = Number((columnShares[position][bucket] / positionMarginal[position]).toFixed(6));
    }
    consistency[position] = RUNTIME_BUCKETS.reduce((sum, bucket) => sum + bucketMarginal[bucket] * lifts[position][bucket], 0);
    if (Math.abs(consistency[position] - 1) > CONSISTENCY_TOLERANCE) {
      throw new Error(`${position} lift consistency ${consistency[position]} differs from 1`);
    }
  }

  return {
    coverage,
    includedSeasons,
    expectedCompletedSeasons: expectedCompletedSeasons(),
    raw,
    aggregated,
    columnShares,
    lifts,
    positionMarginal,
    bucketMarginal,
    consistency,
    knownPartialPoss,
    unknownPartialPoss,
    joinedRows,
    eligibleRows,
    joinedPartialPoss,
    eligiblePartialPoss,
  };
}

function pct(value: number, digits = 2): string { return `${(value * 100).toFixed(digits)}%`; }
function fixed(value: number): string { return value.toFixed(6); }
function poss(value: number): string { return value.toFixed(2); }

function matrixTable<B extends string>(
  buckets: readonly B[],
  values: Matrix<B>,
  format: (value: number) => string,
): string[] {
  const lines = [
    `| Defender | ${buckets.join(' | ')} |`,
    `| --- | ${buckets.map(() => '---:').join(' | ')} |`,
  ];
  for (const position of DEFENDER_POSITIONS) {
    lines.push(`| ${position} | ${buckets.map((bucket) => format(values[position][bucket])).join(' | ')} |`);
  }
  return lines;
}

function renderReport(result: Derivation): string {
  const unknownShare = result.unknownPartialPoss / (result.knownPartialPoss + result.unknownPartialPoss);
  const discoveredMatchesExpected = result.includedSeasons.join(',') === result.expectedCompletedSeasons.join(',');
  const lines: string[] = [
    '# S3.b1 Matchup Derivation',
    '',
    'Deterministic measurement artifact generated by `scripts/derive-s3b1-matchups.ts`. It contains measurements, formulas, checks, and provenance only.',
    '',
    '## Scope and provenance limitations',
    '',
    '- Both axes use present-day static bio positions retroactively: `normalize.py` assigns opponent buckets from the current bio index, and the seasonal players contract derives defender positions from that same source.',
    '- Supply-adjusted lift removes defender-position supply from the column share, but it does not undo the builder’s coarse token mapping (`G → PG`, `F → SF`). The result is internally consistent with the production pool vocabulary, not a claim about true historical positional identity.',
    '- Lift is a conditional-choice proxy among the defenders available at runtime. The source does not observe the alternative on-court defenders, so it cannot identify a true conditional assignment model.',
    '- The shooter’s primary engine position selects the runtime `G`/`F`/`C` bucket. Shooter secondary position is deliberately unused. Exact-composite runtime lookup was rejected because the engine secondary vocabulary is only `{PG, SF, C}` and almost no primary/secondary pair maps unambiguously to an observed composite bucket.',
    '',
    '## Window and coverage',
    '',
    `- Predeclared season inclusion gate: at least ${pct(MIN_ROSTERED_DEFENDER_COVERAGE)} of unique rostered player ids have positive matchup partial possessions.`,
    `- In-progress season excluded: ${IN_PROGRESS_SEASON}.`,
    `- Discovered included window: ${result.includedSeasons.join(', ')}.`,
    `- Declared completed matchup window: ${result.expectedCompletedSeasons.join(', ')}.`,
    `- Window equality: ${discoveredMatchesExpected ? 'exact' : 'different (coverage table is authoritative)'}.`,
    '',
    '| Season | Unique rostered defenders | With matchup evidence | Coverage | Included |',
    '| --- | ---: | ---: | ---: | --- |',
  ];
  for (const row of result.coverage) {
    lines.push(`| ${row.season} | ${row.rosteredDefenders} | ${row.defendersWithMatchups} | ${pct(row.coverage)} | ${row.included ? 'yes' : 'no'} |`);
  }
  lines.push(
    '',
    `Defender-position join: ${result.joinedRows}/${result.eligibleRows} rows (${pct(result.joinedRows / result.eligibleRows)}); possession-weighted ${poss(result.joinedPartialPoss)}/${poss(result.eligiblePartialPoss)} (${pct(result.joinedPartialPoss / result.eligiblePartialPoss)}). The predeclared row gate is ${pct(MIN_POSITION_JOIN_RATE)}.`,
    '',
    '## Aggregation vocabulary',
    '',
    '- The source-to-runtime rule is mechanically composed through the same raw-token → engine-primary mapping used by `build-league`, followed by engine-position → runtime bucket: `G, G-F → G`; `F-G, F, F-C, C-F → F`; `C → C`.',
    '- The derivation asserts that composition against the locked table and checks that all five engine positions reach one of the three runtime columns. The load-bearing case is `C-F → PF → F`.',
    '- Source buckets are never split across engine positions.',
    '',
    '## Raw partial possessions (5×7)',
    '',
    ...matrixTable(RAW_BUCKETS, result.raw, poss),
    '',
    '## Aggregated partial possessions (5×3)',
    '',
    ...matrixTable(RUNTIME_BUCKETS, result.aggregated, poss),
    '',
    `Known partial possessions: ${poss(result.knownPartialPoss)}. Excluded UNK: ${poss(result.unknownPartialPoss)} (${pct(unknownShare)} of known + UNK).`,
    '',
    '## Supply adjustment',
    '',
    '`lift[dPos][B] = P(dPos | B) / P(dPos)`, where all probabilities are partial-possession weighted after the same season, join, and UNK exclusions.',
    '',
    '### Column shares P(defender position | shooter bucket)',
    '',
    ...matrixTable(RUNTIME_BUCKETS, result.columnShares, fixed),
    '',
    '### Defender-position marginal P(defender position)',
    '',
    '| Defender | Marginal |',
    '| --- | ---: |',
    ...DEFENDER_POSITIONS.map((position) => `| ${position} | ${fixed(result.positionMarginal[position])} |`),
    '',
    '### Shooter-bucket marginal P(bucket)',
    '',
    '| Bucket | Marginal |',
    '| --- | ---: |',
    ...RUNTIME_BUCKETS.map((bucket) => `| ${bucket} | ${fixed(result.bucketMarginal[bucket])} |`),
    '',
    '### Runtime lift (committed constant)',
    '',
    ...matrixTable(RUNTIME_BUCKETS, result.lifts, fixed),
    '',
    '## Mechanical checks',
    '',
    `- Minimum lift-cell sample: ${MIN_LIFT_CELL_PARTIAL_POSS.toFixed(0)} partial possessions; minimum position/bucket marginal: ${MIN_MARGINAL_PARTIAL_POSS.toFixed(0)}.`,
    `- Consistency tolerance for Σ_B P(B) × lift[dPos][B] = 1: ${CONSISTENCY_TOLERANCE}.`,
    '',
    '| Defender | Weighted lift mean | Absolute error from 1 |',
    '| --- | ---: | ---: |',
    ...DEFENDER_POSITIONS.map((position) => `| ${position} | ${fixed(result.consistency[position])} | ${Math.abs(result.consistency[position] - 1).toExponential(2)} |`),
    '',
    '- Only `partialPoss` is read from matchup buckets. `matchupFgPct`, player points, makes, and attempts are outside this unit.',
    '- Iteration is sorted by season/personId/bucket, numeric output uses fixed rounding, and `--check` byte-compares this report and the marked constant block.',
    '',
  );
  return lines.join('\n');
}

function renderConstantBlock(result: Derivation): string {
  const first = result.includedSeasons[0];
  const last = result.includedSeasons.at(-1);
  const lines = [
    BLOCK_START,
    `// Generated by scripts/derive-s3b1-matchups.ts from ${first} through ${last}.`,
    '// Values are partial-possession-weighted supply-adjusted lift (1 = independence).',
    'export type S3B1MatchupBucket = \'G\' | \'F\' | \'C\';',
    'export const S3B1_MATCHUP_LIFT: Readonly<Record<Position, Readonly<Record<S3B1MatchupBucket, number>>>> = {',
  ];
  for (const position of DEFENDER_POSITIONS) {
    const values = RUNTIME_BUCKETS.map((bucket) => `${bucket}: ${fixed(result.lifts[position][bucket])}`).join(', ');
    lines.push(`  ${position}: { ${values} },`);
  }
  lines.push('};', BLOCK_END);
  return lines.join('\n');
}

function constantsWithBlock(block: string): string {
  const existing = fs.readFileSync(CONSTANTS_PATH, 'utf8');
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start < 0 || end < start) throw new Error('constants.ts is missing the S3.b1 generated block markers');
  return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) throw new Error(`unknown argument(s): ${args.join(' ')}`);
  const check = args.includes('--check');
  const result = derive();
  const report = renderReport(result);
  const block = renderConstantBlock(result);
  const nextConstants = constantsWithBlock(block);

  if (check) {
    const reportMatches = fs.existsSync(REPORT_PATH) && fs.readFileSync(REPORT_PATH, 'utf8') === report;
    const constantsMatch = fs.readFileSync(CONSTANTS_PATH, 'utf8') === nextConstants;
    if (!reportMatches || !constantsMatch) {
      if (!reportMatches) console.error(`--check FAILED: ${REPORT_PATH} is stale or missing.`);
      if (!constantsMatch) console.error(`--check FAILED: generated block in ${CONSTANTS_PATH} is stale.`);
      process.exitCode = 1;
      return;
    }
    console.log(`--check OK: ${REPORT_PATH} and the constants block are byte-identical to the derivation.`);
    return;
  }

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  fs.writeFileSync(CONSTANTS_PATH, nextConstants, 'utf8');
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Updated generated block in ${CONSTANTS_PATH}`);
  console.log(`Window ${result.includedSeasons[0]}..${result.includedSeasons.at(-1)}; known partial possessions ${poss(result.knownPartialPoss)}; UNK ${pct(result.unknownPartialPoss / (result.knownPartialPoss + result.unknownPartialPoss))}.`);
}

main();
