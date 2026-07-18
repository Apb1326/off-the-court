/**
 * Defensive versatility A/B test (the weak-link property).
 *
 * Mismatch-hunting attacks the single softest defender every possession, so what
 * stops it must be the FLOOR of the lineup, not the mean. This test proves the
 * versatility layer keys on the floor — and that it is NOT "collective rim
 * protection" — using four lineups:
 *   - switchable    : high perimeter-D floor, low mobility/size spread.
 *   - studsSieve    : four elite perimeter defenders + one sieve. SAME MEAN
 *                     perimeter D as `switchable`, but a low floor — the average
 *                     hides the guy being attacked.
 *   - average       : a realistic, league-spread control.
 *   - rimProtectors : five immobile rim protectors — elite interior D, but poor,
 *                     immobile perimeter D. High summed rim protection, the
 *                     OPPOSITE of switch-everything.
 *
 * Defender positions are all set to one value the hunted star does NOT play, so
 * the S3.b1 position term is uniform and cancels after normalization. The
 * versatility-gated hunt term drives selection cleanly. The soft-target hit rate is
 * the fraction of draws where the assigned defender is the lineup's weakest
 * (lowest combined defensive rating) — i.e. how often hunting finds the mismatch.
 *
 * Stated, asserted thresholds (script exits non-zero if unmet):
 *   - z(switchable) - z(studsSieve)  >= Z_GAP  (equal mean, opposite floor → the
 *     value is floor-driven, not mean-driven),
 *   - softTargetRate(studsSieve) - softTargetRate(switchable) >=
 *     S3B1_AB_SUPPRESSION_GAP (the studs-sieve lineup gets hunted materially
 *     more often than the switchable one),
 *   - z(rimProtectors) <= z(switchable) - RIM_GAP (rim protection does NOT buy
 *     switchability),
 *   - softTarget(studsSieve) > softTarget(switchable) (hunting finds the soft
 *     target more often against the low-floor lineup), and
 *   - versatility ordering switchable > average > studsSieve.
 */
import { Player, Position, PlayerRatings } from '../src/models/player';
import { SeededRNG } from '../src/lib/rng';
import { selectDefender } from '../src/engine/play-types';
import { computeVersatility } from '../src/engine/spacing';

const Z_GAP = 2.0;
// Frozen before S3.b1 gameplay tuning: behavioral weak-link suppression, 2 pp.
const S3B1_AB_SUPPRESSION_GAP = 0.02;
const RIM_GAP = 1.5;
const DRAWS = 60000;

let pid = 0;
// All defenders are position 'C'; the star is a 'PG', so selectDefender finds no
// positional advantage and the hunt term becomes the lever (clean mechanism test).
function mkDef(perim: number, ath: number, ht: number, defIQ: number, intDef: number): Player {
  pid++;
  const ratings: PlayerRatings = {
    outsideShooting: 45, midrangeShooting: 45, interiorScoring: 45, freeThrowShooting: 50,
    ballHandling: 45, passing: 45, offensiveIQ: 50,
    perimeterDefense: perim, interiorDefense: intDef, defensiveIQ: defIQ, steal: 50, block: 50,
    athleticism: ath, strength: 50, rebounding: 50, stamina: 50, durability: 50,
  };
  return {
    id: `d${pid}`, firstName: 'D', lastName: `${pid}`, position: 'C',
    height: ht, weight: 210, age: 26, experience: 5, teamId: 'DEF', jerseyNumber: pid,
    ratings, potential: ratings, scoutingAccuracy: 1,
    tendencies: {
      isolationFreq: 0.1, pickAndRollBallHandlerFreq: 0.1, pickAndRollScreenerFreq: 0.1,
      postUpFreq: 0.1, spotUpFreq: 0.3, transitionFreq: 0.15, cutFreq: 0.08,
      offScreenFreq: 0.1, handoffFreq: 0.1, threePointRate: 0.4, midrangeRate: 0.15, rimRate: 0.35,
      drawFoulRate: 0.1, assistRate: 0.12, usageRate: 0.12, reboundRate: 0.1,
    },
    contract: { type: 'veteran' as const, salarySchedule: [10, 10], noTradeClause: false }, health: { healthy: true }, careerStats: [],
  };
}

function makeStar(): Player {
  const d = mkDef(50, 64, 78, 50, 50);
  return { ...d, id: 'STAR', position: 'PG' as Position, teamId: 'OFF' };
}

// Fixture rating levels are scaled to the S2d NBA-derived pool: the
// versatility baseline/spread (VERSATILITY_BASELINE/SPREAD, re-derived by
// calibrate-spacing from real starter fives) center much lower than the
// retired heuristic pool, so "elite floor" here is ~mid-30s perimeter D and
// a sieve is ~18 — chosen so the fixtures land at z ≈ +1.8 / -2.0 / +0.7 /
// -1.0 instead of all saturating the ±VERSATILITY_CLAMP.
// (a) Switchable: high FLOOR (33), low spread.
const switchable = (): Player[] => {
  const perim = [33, 35, 34, 36, 34], ath = [46, 48, 45, 47, 46], ht = [78, 79, 78, 80, 79];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], 45, 45));
};
// (b) Studs + sieve: mean perim ≈ switchable (34.4), but FLOOR 18, high spread.
const studsSieve = (): Player[] => {
  const perim = [40, 39, 38, 37, 18], ath = [50, 52, 48, 51, 30], ht = [78, 79, 80, 81, 76], dIQ = [46, 44, 48, 45, 25];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], dIQ[i], 45));
};
// (c) Average control: realistic league spread, mid floor.
const average = (): Player[] => {
  const perim = [34, 38, 40, 36, 42], ath = [40, 46, 50, 44, 52], ht = [74, 77, 79, 81, 84], dIQ = [44, 46, 48, 45, 46];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], dIQ[i], 45));
};
// (d) Five immobile rim protectors: elite interior D, poor/immobile perimeter D.
const rimProtectors = (): Player[] => {
  const perim = [20, 18, 17, 22, 19], ath = [30, 28, 26, 32, 29], ht = [83, 84, 85, 84, 86], intDef = [62, 64, 66, 63, 68];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], 40, intDef[i]));
};

const combined = (d: Player) =>
  (d.ratings.perimeterDefense + d.ratings.interiorDefense + d.ratings.defensiveIQ) / 3;

function evaluate(name: string, build: () => Player[]) {
  pid = 0;
  const def = build();
  const star = makeStar();
  const rng = new SeededRNG(98765);
  const meanPerim = def.reduce((s, d) => s + d.ratings.perimeterDefense, 0) / def.length;
  const floor = Math.min(...def.map((d) => d.ratings.perimeterDefense));
  const z = computeVersatility(def);

  const weakestId = def.reduce((min, d) => (combined(d) < combined(min) ? d : min)).id;
  let softHits = 0;
  for (let i = 0; i < DRAWS; i++) {
    if (selectDefender(def, star, rng, 'isolation').id === weakestId) softHits++;
  }
  const softTarget = softHits / DRAWS;
  console.log(
    `${name.padEnd(13)} meanPerimD ${meanPerim.toFixed(1).padStart(5)} | floor ${floor.toString().padStart(2)} | ` +
    `vers-z ${z.toFixed(2).padStart(6)} | softTargetRate ${(softTarget * 100).toFixed(1)}%`,
  );
  return { z, softTarget };
}

function main() {
  console.log(`Defensive versatility A/B — selectDefender on isolation, ${DRAWS} draws each\n`);
  const a = evaluate('switchable', switchable);
  const b = evaluate('studsSieve', studsSieve);
  const c = evaluate('average', average);
  const r = evaluate('rimProtectors', rimProtectors);

  const zGap = a.z - b.z;
  const suppressionGap = b.softTarget - a.softTarget;
  console.log(`\nWeak-link checks (switchable & studsSieve have ~equal MEAN perimeter D, opposite floors):`);
  console.log(`  z gap (switchable - studsSieve)        = ${zGap.toFixed(2)}   (need ≥ ${Z_GAP})`);
  console.log(`  soft-target suppression gap            = ${suppressionGap.toFixed(3)} (need ≥ ${S3B1_AB_SUPPRESSION_GAP})`);
  console.log(`  soft-target rate: studsSieve ${(b.softTarget * 100).toFixed(1)}% > switchable ${(a.softTarget * 100).toFixed(1)}%`);
  console.log(`  rim-protectors z ${r.z.toFixed(2)} ≤ switchable z - ${RIM_GAP} (${(a.z - RIM_GAP).toFixed(2)})? rim protection ≠ switchability`);
  console.log(`  versatility ordering: switchable ${a.z.toFixed(2)} > average ${c.z.toFixed(2)} > studsSieve ${b.z.toFixed(2)}`);

  const checks = {
    zGap: zGap >= Z_GAP,
    suppressionGap: suppressionGap >= S3B1_AB_SUPPRESSION_GAP,
    rimNotSwitchable: r.z <= a.z - RIM_GAP,
    softTargetDir: b.softTarget > a.softTarget,
    ordering: a.z > c.z && c.z > b.z,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) {
    console.error(`\nDEFENSE A/B FAILED: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nDEFENSE A/B PASSED: the studs-and-sieve lineup is hunted far more than the equal-mean`);
  console.log(`switch-everything lineup (the value keys on the weak link, not the mean), and five`);
  console.log(`immobile rim protectors do NOT read as switchable — rim protection doesn't dominate.`);
}

main();
