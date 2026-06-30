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
 * selectDefender's positional-match path is neutralized and the hunt RATE (the
 * lever this layer moves) drives selection cleanly. The soft-target hit rate is
 * the fraction of draws where the assigned defender is the lineup's weakest
 * (lowest combined defensive rating) — i.e. how often hunting finds the mismatch.
 *
 * Stated, asserted thresholds (script exits non-zero if unmet):
 *   - z(switchable) - z(studsSieve)  >= Z_GAP  (equal mean, opposite floor → the
 *     value is floor-driven, not mean-driven),
 *   - huntRate(studsSieve) - huntRate(switchable) >= HUNT_GAP (the studs-sieve
 *     lineup gets hunted materially more often than the switchable one),
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
import { VERSATILITY_HUNT_COEF } from '../src/engine/constants';

const Z_GAP = 2.0;
const HUNT_GAP = 0.12;
const RIM_GAP = 1.5;
const DRAWS = 60000;

let pid = 0;
// All defenders are position 'C'; the star is a 'PG', so selectDefender finds no
// positional match and the hunt rate becomes the lever (clean mechanism test).
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

// (a) Switchable: high FLOOR (60), low spread.
const switchable = (): Player[] => {
  const perim = [62, 64, 60, 63, 61], ath = [56, 58, 55, 57, 56], ht = [78, 79, 78, 80, 79];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], 60, 55));
};
// (b) Studs + sieve: mean perim ≈ switchable, but FLOOR 30, high spread.
const studsSieve = (): Player[] => {
  const perim = [70, 72, 71, 69, 30], ath = [60, 62, 58, 61, 40], ht = [78, 79, 80, 81, 76], dIQ = [62, 60, 64, 61, 40];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], dIQ[i], 55));
};
// (c) Average control: realistic league spread, mid floor.
const average = (): Player[] => {
  const perim = [46, 50, 52, 48, 54], ath = [44, 50, 55, 48, 58], ht = [74, 77, 79, 81, 84], dIQ = [48, 50, 52, 50, 50];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], dIQ[i], 52));
};
// (d) Five immobile rim protectors: elite interior D, poor/immobile perimeter D.
const rimProtectors = (): Player[] => {
  const perim = [38, 36, 35, 40, 37], ath = [40, 38, 36, 42, 39], ht = [83, 84, 85, 84, 86], intDef = [72, 74, 76, 73, 78];
  return perim.map((p, i) => mkDef(p, ath[i], ht[i], 50, intDef[i]));
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
  const huntRate = Math.max(0.15, Math.min(0.6, 0.45 - VERSATILITY_HUNT_COEF * z));

  const weakestId = def.reduce((min, d) => (combined(d) < combined(min) ? d : min)).id;
  let softHits = 0;
  for (let i = 0; i < DRAWS; i++) {
    if (selectDefender(def, star, rng, 'isolation').id === weakestId) softHits++;
  }
  const softTarget = softHits / DRAWS;
  console.log(
    `${name.padEnd(13)} meanPerimD ${meanPerim.toFixed(1).padStart(5)} | floor ${floor.toString().padStart(2)} | ` +
    `vers-z ${z.toFixed(2).padStart(6)} | huntRate ${huntRate.toFixed(3)} | softTargetRate ${(softTarget * 100).toFixed(1)}%`,
  );
  return { z, huntRate, softTarget };
}

function main() {
  console.log(`Defensive versatility A/B — selectDefender on isolation, ${DRAWS} draws each\n`);
  const a = evaluate('switchable', switchable);
  const b = evaluate('studsSieve', studsSieve);
  const c = evaluate('average', average);
  const r = evaluate('rimProtectors', rimProtectors);

  const zGap = a.z - b.z;
  const huntGap = b.huntRate - a.huntRate;
  console.log(`\nWeak-link checks (switchable & studsSieve have ~equal MEAN perimeter D, opposite floors):`);
  console.log(`  z gap (switchable - studsSieve)        = ${zGap.toFixed(2)}   (need ≥ ${Z_GAP})`);
  console.log(`  huntRate gap (studsSieve - switchable) = ${huntGap.toFixed(3)} (need ≥ ${HUNT_GAP})`);
  console.log(`  soft-target rate: studsSieve ${(b.softTarget * 100).toFixed(1)}% > switchable ${(a.softTarget * 100).toFixed(1)}%`);
  console.log(`  rim-protectors z ${r.z.toFixed(2)} ≤ switchable z - ${RIM_GAP} (${(a.z - RIM_GAP).toFixed(2)})? rim protection ≠ switchability`);
  console.log(`  versatility ordering: switchable ${a.z.toFixed(2)} > average ${c.z.toFixed(2)} > studsSieve ${b.z.toFixed(2)}`);

  const checks = {
    zGap: zGap >= Z_GAP,
    huntGap: huntGap >= HUNT_GAP,
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
