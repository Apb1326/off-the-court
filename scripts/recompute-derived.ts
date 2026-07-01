/**
 * Refresh only persisted usage and free-throw derivations from canonical raw
 * career stats. Run with: tsx scripts/recompute-derived.ts
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { recomputeUsageAndFreeThrowFields } from '../src/ratings/derivation';
import {
  FT_DERIVE_SCALE,
  FT_LEAGUE_AVG_PCT,
  FT_PCT_SLOPE,
  FT_SIM_PCT_MAX,
  FT_SIM_PCT_MIN,
} from '../src/engine/constants';

interface Distribution {
  min: number;
  mean: number;
  max: number;
}

function summarize(values: number[]): Distribution {
  return {
    min: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
  };
}

function printDistribution(label: string, values: number[], floor?: number): void {
  const stats = summarize(values);
  const floorText = floor === undefined
    ? ''
    : `, at ${floor.toFixed(2)} floor=${values.filter((value) => value === floor).length}`;
  console.log(
    `${label}: min=${stats.min.toFixed(3)}, mean=${stats.mean.toFixed(3)}, max=${stats.max.toFixed(3)}${floorText}`,
  );
}

function assertFreeThrowRoundTrip(): void {
  for (const pct of [0.55, 0.65, 0.781, 0.85, 0.92]) {
    const rating = Math.max(1, Math.min(
      80,
      Math.round(40 + (pct - FT_LEAGUE_AVG_PCT) * FT_DERIVE_SCALE),
    ));
    const simulated = Math.max(FT_SIM_PCT_MIN, Math.min(
      FT_SIM_PCT_MAX,
      FT_LEAGUE_AVG_PCT + ((rating - 40) / 40) * FT_PCT_SLOPE,
    ));
    if (Math.abs(simulated - pct) > 0.01) {
      throw new Error(`FT round trip failed for ${pct}: rating=${rating}, sim=${simulated}`);
    }
  }
  console.log('FT derivation/resolution round trip: PASS');
}

async function main(): Promise<void> {
  assertFreeThrowRoundTrip();
  const file = path.join(process.cwd(), 'data', 'players.json');
  const originalText = await readFile(file, 'utf8');
  const players = JSON.parse(originalText) as Player[];
  const skippedIds: string[] = [];
  const updated = players.map((player) => {
    const recomputed = recomputeUsageAndFreeThrowFields(player);
    if (!recomputed) {
      skippedIds.push(player.id);
      return player;
    }
    return recomputed;
  });

  console.log(`Players: ${players.length}`);
  printDistribution('Usage before', players.map((p) => p.tendencies.usageRate), 0.10);
  printDistribution('Usage after ', updated.map((p) => p.tendencies.usageRate), 0.10);
  printDistribution('FT rating before', players.map((p) => p.ratings.freeThrowShooting));
  printDistribution('FT rating after ', updated.map((p) => p.ratings.freeThrowShooting));
  console.log(`Skipped invalid/missing canonical seasons: ${skippedIds.length}`);
  if (skippedIds.length > 0) console.log(`Examples: ${skippedIds.slice(0, 5).join(', ')}`);

  const outputText = `${JSON.stringify(updated, null, 2)}\n`;
  const changed = outputText !== originalText;
  if (changed) await writeFile(file, outputText, 'utf8');
  console.log(`File changed: ${changed ? 'yes' : 'no (already canonical)'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
