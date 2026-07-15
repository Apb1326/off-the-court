/**
 * Derives spacing and defensive-versatility baselines/spreads from the active
 * NBA-derived production pool. The deterministic representative population is
 * every configured starter five; spacing evaluates every possible finisher
 * exclusion weighted by the finisher's actual production selection share.
 *
 * The baseline must be the average of the OFF-BALL FOUR, not of a five-man
 * lineup: the finisher is excluded, and the finisher is usually the lineup's
 * best shooter, so the off-ball-four mean sits systematically BELOW the five-man
 * mean. To capture that bias, each (lineup, finisher) pair is weighted by the
 * finisher's PRODUCTION selection share: the lineup's play-type mix from the
 * exported production selector decomposition (`explainPlayTypeSelection` under
 * a neutral game situation, plus the lineup's unconditional transition share),
 * times the finisher's share of the exported `primaryPlayerWeight` — the exact
 * usage × position × skill-fit weight `selectPrimaryPlayer` draws with. The
 * derived constants are therefore centered on the population the runtime
 * actually selects, not on a proxy weighting.
 *
 * Pure arithmetic over the rosters; no RNG, no game simulation.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { rawOffBallGravity, rawVersatility } from '../src/engine/spacing';
import { productionFinisherShare, productionPlayTypeMix } from './shared-lineup-model';

function weighted(values: readonly { value: number; weight: number }[]): { mean: number; sd: number } {
  const total = values.reduce((sum, row) => sum + row.weight, 0);
  const mean = values.reduce((sum, row) => sum + row.value * row.weight, 0) / total;
  const variance = values.reduce((sum, row) => sum + row.weight * (row.value - mean) ** 2, 0) / total;
  return { mean, sd: Math.sqrt(variance) };
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
  const byId = new Map(players.map((p) => [p.id, p]));

  const spacingPopulation: { value: number; weight: number }[] = [];
  const versatilityPopulation: { value: number; weight: number }[] = [];
  // Unweighted references to show the finisher-exclusion bias.
  let fiveSum = 0, fiveN = 0;       // five-man-lineup mean gravity
  let offFlatSum = 0, offFlatN = 0; // off-ball-four mean, flat over finishers

  for (const team of teams) {
    const starters = team.rotation.starters
      .map((id) => byId.get(id))
      .filter((p): p is Player => !!p);
    if (starters.length < 5) continue;

    const five = starters.slice(0, 5);
    fiveSum += rawOffBallGravity(five); fiveN++;

    const mix = productionPlayTypeMix(five, team);
    for (const finisher of five) {
      const offBall = five.filter((p) => p.id !== finisher.id);
      const gravity = rawOffBallGravity(offBall);

      offFlatSum += gravity; offFlatN++;

      // Weight = the finisher's production selection probability, from the
      // shared primaryPlayerWeight and the lineup's production play-type mix.
      spacingPopulation.push({ value: gravity, weight: productionFinisherShare(finisher, five, mix) });
    }
    versatilityPopulation.push({ value: rawVersatility(five), weight: 1 });
  }

  const spacing = weighted(spacingPopulation);
  const versatility = weighted(versatilityPopulation);
  const fiveMean = fiveSum / fiveN;
  const offFlatMean = offFlatSum / offFlatN;

  console.log('Spacing baseline calibration (off-ball-four group gravity)\n');
  console.log(`  five-man lineup mean gravity      : ${fiveMean.toFixed(4)}`);
  console.log(`  off-ball-four mean (flat)         : ${offFlatMean.toFixed(4)}`);
  console.log(`  off-ball-four mean (selection-weighted): ${spacing.mean.toFixed(4)}  <- SPACING_BASELINE_OFFBALL_FOUR`);
  console.log(`  off-ball-four spread (selection-wtd sd): ${spacing.sd.toFixed(4)}  <- SPACING_SPREAD`);
  console.log(`\n  finisher-exclusion bias (five - offFour weighted): ${(fiveMean - spacing.mean).toFixed(4)}`);
  console.log('  (positive confirms the finisher is on average a better-than-lineup shooter,');
  console.log('   so centering on a five-man mean would bias spacing negative — hence off-four.)');
  console.log('\nVersatility baseline calibration (configured defensive starter fives)\n');
  console.log(`  representative lineups                 : ${versatilityPopulation.length}`);
  console.log(`  five-man mean raw versatility           : ${versatility.mean.toFixed(4)}  <- VERSATILITY_BASELINE`);
  console.log(`  five-man spread raw versatility (sd)    : ${versatility.sd.toFixed(4)}  <- VERSATILITY_SPREAD`);
}

main().catch((e) => { console.error(e); process.exit(1); });
