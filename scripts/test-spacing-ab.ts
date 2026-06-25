/**
 * Spacing A/B test.
 *
 * Runs the SAME five-player offense twice against the SAME average defense:
 *   A) the star surrounded by four SHOOTERS (high outside shooting + three-point
 *      tendency), and
 *   B) the star surrounded by four NON-SHOOTERS whose every other (non-shooting)
 *      rating is IDENTICAL to the shooters — only outsideShooting and
 *      threePointRate change.
 *
 * Everything about the star is identical between the two runs, so any difference
 * in the star's shot mix and efficiency is attributable to lineup spacing alone.
 *
 * Stated thresholds (asserted; the script exits non-zero if not met):
 *   - the star's RIM-ATTEMPT RATE is at least RIM_THRESHOLD pts higher with
 *     shooters around him, AND
 *   - the star's TRUE-SHOOTING% is at least TS_THRESHOLD pts higher.
 * An eyeball check would let a negligible-but-correct effect pass; these gates
 * force the effect to be materially large and in the right direction.
 */
import { Player, Position, PlayerRatings, PlayerTendencies } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateGame } from '../src/engine';

const RIM_THRESHOLD = 3.0; // percentage points
const TS_THRESHOLD = 1.5;  // percentage points
const GAMES = 60;

const baseRatings = (o: Partial<PlayerRatings> = {}): PlayerRatings => ({
  outsideShooting: 50, midrangeShooting: 50, interiorScoring: 50, freeThrowShooting: 50,
  ballHandling: 50, passing: 50, offensiveIQ: 50,
  perimeterDefense: 50, interiorDefense: 50, defensiveIQ: 50, steal: 50, block: 50,
  athleticism: 50, strength: 50, rebounding: 50, stamina: 50, durability: 50, ...o,
});

const baseTend = (o: Partial<PlayerTendencies> = {}): PlayerTendencies => ({
  isolationFreq: 0.1, pickAndRollBallHandlerFreq: 0.1, pickAndRollScreenerFreq: 0.1,
  postUpFreq: 0.1, spotUpFreq: 0.3, transitionFreq: 0.15, cutFreq: 0.08,
  offScreenFreq: 0.1, handoffFreq: 0.1,
  threePointRate: 0.45, midrangeRate: 0.15, rimRate: 0.35,
  drawFoulRate: 0.1, assistRate: 0.12, usageRate: 0.12, reboundRate: 0.1, ...o,
});

let pid = 0;
function makePlayer(
  pos: Position, teamId: string,
  ratings: Partial<PlayerRatings>, tend: Partial<PlayerTendencies>,
): Player {
  pid++;
  return {
    id: `p${pid}`, firstName: 'P', lastName: `${pid}`, position: pos,
    height: 78, weight: 210, age: 26, experience: 5, teamId, jerseyNumber: pid,
    ratings: baseRatings(ratings), potential: baseRatings(ratings), scoutingAccuracy: 1,
    tendencies: baseTend(tend),
    contract: { yearsRemaining: 2, salaryPerYear: 10 },
    health: { healthy: true },
    careerStats: [],
  };
}

function makeTeam(id: string, abbr: string, players: Player[]): Team {
  return {
    id, name: abbr, city: abbr, fullName: abbr, abbreviation: abbr,
    conference: 'West', division: 'Pacific',
    roster: players.map((p) => p.id),
    rotation: {
      starters: players.slice(0, 5).map((p) => p.id) as [string, string, string, string, string],
      rotationOrder: players.map((p) => p.id),
      minuteTargets: Object.fromEntries(players.map((p) => [p.id, 48])),
    },
    offensiveSystem: {
      pace: 100, threePointEmphasis: 0.5, transitionEmphasis: 0.5,
      postPlayEmphasis: 0.3, isolationEmphasis: 0.5, screeningEmphasis: 0.5,
    },
    defensiveSystem: {
      scheme: 'man', intensity: 0.5, doubleTeamThreshold: 78, helpDefenseAggression: 0.4,
    },
  };
}

// Star: a balanced, high-usage shot creator who finishes the action. Same in
// both cases. doubleTeamThreshold is set high (78) so the star is never doubled,
// keeping the comparison clean.
function makeStar(teamId: string): Player {
  return makePlayer('SF', teamId,
    { outsideShooting: 60, midrangeShooting: 62, interiorScoring: 66, ballHandling: 68, athleticism: 64, freeThrowShooting: 60 },
    { usageRate: 0.40, isolationFreq: 0.5, pickAndRollBallHandlerFreq: 0.3, rimRate: 0.40, midrangeRate: 0.20, threePointRate: 0.40 });
}

// Surrounding players. The ONLY difference between shooter and non-shooter
// variants is outsideShooting + threePointRate; every non-shooting rating is
// identical, so the comparison isolates spacing.
function surround(teamId: string, shooters: boolean): Player[] {
  const positions: Position[] = ['PG', 'SG', 'PF', 'C'];
  const shootRating = shooters ? 74 : 26;
  const threeRate = shooters ? 0.60 : 0.05;
  return positions.map((pos) =>
    makePlayer(pos, teamId,
      { outsideShooting: shootRating },
      { usageRate: 0.06, threePointRate: threeRate, spotUpFreq: 0.4, isolationFreq: 0.04 }));
}

function avgDefense(teamId: string): Player[] {
  const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  return positions.map((pos) => makePlayer(pos, teamId, {}, { usageRate: 0.12 }));
}

interface Acc { rimAtt: number; totalAtt: number; pts: number; fga: number; fta: number; }

function runCase(shooters: boolean): Acc {
  const acc: Acc = { rimAtt: 0, totalAtt: 0, pts: 0, fga: 0, fta: 0 };
  for (let seed = 1; seed <= GAMES; seed++) {
    pid = 0; // reset ids so star is the same id ('p1') in both cases & all seeds
    const star = makeStar('OFF');
    const off = [star, ...surround('OFF', shooters)];
    const def = avgDefense('DEF');
    const offTeam = makeTeam('OFF', 'OFF', off);
    const defTeam = makeTeam('DEF', 'DEF', def);

    const sim = simulateGame(offTeam, defTeam, off, def, `ab${seed}`, 'ab', '2025-01-01', seed);

    for (const e of sim.playByPlay) {
      if (e.primaryPlayerId !== star.id || !e.shotZone) continue;
      if (e.outcome !== 'made_shot' && e.outcome !== 'and_one' && e.outcome !== 'missed_shot') continue;
      acc.totalAtt++;
      if (e.shotZone === 'rim') acc.rimAtt++;
    }
    const line = sim.boxScore.homeTeam.players.find((p) => p.playerId === star.id);
    if (line) { acc.pts += line.stats.points; acc.fga += line.stats.fieldGoalsAttempted; acc.fta += line.stats.freeThrowsAttempted; }
  }
  return acc;
}

function ts(a: Acc): number { return a.pts / (2 * (a.fga + 0.44 * a.fta)); }

function main() {
  const A = runCase(true);   // shooters
  const B = runCase(false);  // non-shooters

  const rimA = (A.rimAtt / A.totalAtt) * 100, rimB = (B.rimAtt / B.totalAtt) * 100;
  const tsA = ts(A) * 100, tsB = ts(B) * 100;
  const rimDelta = rimA - rimB;
  const tsDelta = tsA - tsB;

  console.log(`Spacing A/B — same star, ${GAMES} games each\n`);
  console.log('                       Shooters   NonShooters   Delta');
  console.log(`Star rim-attempt rate   ${rimA.toFixed(1).padStart(6)}%     ${rimB.toFixed(1).padStart(6)}%   ${(rimDelta >= 0 ? '+' : '') + rimDelta.toFixed(1)} pts`);
  console.log(`Star true-shooting %    ${tsA.toFixed(1).padStart(6)}%     ${tsB.toFixed(1).padStart(6)}%   ${(tsDelta >= 0 ? '+' : '') + tsDelta.toFixed(1)} pts`);
  console.log(`Star FGA (total)        ${String(A.fga).padStart(6)}      ${String(B.fga).padStart(6)}`);

  const rimOK = rimDelta >= RIM_THRESHOLD;
  const tsOK = tsDelta >= TS_THRESHOLD;
  console.log(`\nThresholds: rim-rate Δ ≥ ${RIM_THRESHOLD} pts  -> ${rimOK ? 'PASS' : 'FAIL'} (${rimDelta.toFixed(1)})`);
  console.log(`            TS% Δ      ≥ ${TS_THRESHOLD} pts  -> ${tsOK ? 'PASS' : 'FAIL'} (${tsDelta.toFixed(1)})`);

  if (!rimOK || !tsOK) {
    console.error('\nSPACING A/B FAILED: effect not materially large in the expected direction.');
    process.exit(1);
  }
  console.log('\nSPACING A/B PASSED: shooters around the star clearly open the rim and lift efficiency.');
}

main();
