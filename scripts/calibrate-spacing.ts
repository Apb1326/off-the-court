/**
 * Derives the empirical baseline + spread for the spacing model
 * (engine/spacing.ts), so SPACING_BASELINE_OFFBALL_FOUR and SPACING_SPREAD in
 * engine/constants.ts are tuned against the real player pool rather than
 * guessed.
 *
 * The baseline must be the average of the OFF-BALL FOUR, not of a five-man
 * lineup: the finisher is excluded, and the finisher is usually the lineup's
 * best shooter, so the off-ball-four mean sits systematically BELOW the five-man
 * mean. To capture that bias we weight each (lineup, finisher) pair by the
 * engine's first-order finisher-selection weight (sqrt of usage rate, mirroring
 * selectPrimaryPlayer), then take a usage-weighted mean/variance of the
 * off-ball-four group gravity.
 *
 * Pure arithmetic over the rosters; no RNG, no game simulation.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { rawOffBallGravity } from '../src/engine/spacing';

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
  const byId = new Map(players.map((p) => [p.id, p]));

  // Weighted accumulators for the off-ball-four group gravity.
  let wSum = 0, wMean = 0, wM2 = 0; // Welford-ish weighted mean/variance
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

    for (const finisher of five) {
      const offBall = five.filter((p) => p.id !== finisher.id);
      const g = rawOffBallGravity(offBall);

      offFlatSum += g; offFlatN++;

      // Engine's first-order finisher weight (selectPrimaryPlayer uses
      // sqrt(usageRate) as the dominant term).
      const w = Math.sqrt(Math.max(0.001, finisher.tendencies.usageRate));
      const newWSum = wSum + w;
      const delta = g - wMean;
      wMean += (w / newWSum) * delta;
      wM2 += w * delta * (g - wMean);
      wSum = newWSum;
    }
  }

  const weightedMean = wMean;
  const weightedSd = Math.sqrt(wM2 / wSum);
  const fiveMean = fiveSum / fiveN;
  const offFlatMean = offFlatSum / offFlatN;

  console.log('Spacing baseline calibration (off-ball-four group gravity)\n');
  console.log(`  five-man lineup mean gravity      : ${fiveMean.toFixed(4)}`);
  console.log(`  off-ball-four mean (flat)         : ${offFlatMean.toFixed(4)}`);
  console.log(`  off-ball-four mean (usage-weighted): ${weightedMean.toFixed(4)}  <- SPACING_BASELINE_OFFBALL_FOUR`);
  console.log(`  off-ball-four spread (usage-wtd sd): ${weightedSd.toFixed(4)}  <- SPACING_SPREAD`);
  console.log(`\n  finisher-exclusion bias (five - offFour weighted): ${(fiveMean - weightedMean).toFixed(4)}`);
  console.log('  (positive confirms the finisher is on average a better-than-lineup shooter,');
  console.log('   so centering on a five-man mean would bias spacing negative — hence off-four.)');
}

main().catch((e) => { console.error(e); process.exit(1); });
