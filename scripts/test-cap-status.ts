/**
 * Standalone transactions Phase 3 verification.
 *
 * Exercises real normalized data, threshold boundaries, incomplete-roster
 * charges, the temporary cut-log cap-hold proxy, corrupt-world failures, and
 * input purity. Run with:
 *   node_modules/.bin/tsx scripts/test-cap-status.ts
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { createSeasonState } from '../src/engine/season';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { CutEntry } from '../src/models/transaction';
import {
  applyCut,
  applySignFreeAgent,
  CAP_HOLD_PERCENTAGE,
  CapStatus,
  classifyCapStatus,
  computeApronPayroll,
  computeCapHolds,
  computeCapRoom,
  computeCapRoomSalary,
  computeIncompleteRosterCharge,
  computeTaxPayroll,
  computeTeamPayroll,
  currentSalary,
  FIRST_APRON,
  getLeagueFinancialSummary,
  getTeamCapStatus,
  getTeamFinancialSummary,
  INCOMPLETE_ROSTER_THRESHOLD,
  LUXURY_TAX_LINE,
  normalizePlayersForSave,
  ROOKIE_MINIMUM_SALARY,
  RosterWorld,
  SALARY_CAP,
  SECOND_APRON,
} from '../src/transactions';

let failures = 0;

function check(label: string, ok: boolean): void {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

function close(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function snap(world: RosterWorld): string {
  return JSON.stringify(world);
}

function throwsMatching(run: () => unknown, pattern: RegExp): boolean {
  try {
    run();
    return false;
  } catch (error) {
    return error instanceof Error && pattern.test(error.message);
  }
}

function asStandardPlayer(player: Player, teamId: string): Player {
  return {
    ...structuredClone(player),
    teamId,
    contract: {
      type: 'veteran',
      salarySchedule: [5],
      noTradeClause: false,
    },
    desiredContract: undefined,
  };
}

function rosterScenario(
  realWorld: RosterWorld,
  standardCount: number,
  twoWayCount = 0,
): RosterWorld {
  const team = structuredClone(realWorld.teams[0]);
  const source = realWorld.players.slice(0, standardCount + twoWayCount);
  const players = source.map((player, index) => {
    const standard = asStandardPlayer(player, team.id);
    if (index < standardCount) return standard;
    return {
      ...standard,
      contract: {
        type: 'two_way' as const,
        salarySchedule: [0.6],
        noTradeClause: false,
      },
    };
  });

  team.roster = players.map((player) => player.id);
  return {
    teams: [team],
    players,
    season: {
      ...structuredClone(realWorld.season),
      freeAgentPool: [],
      transactionLog: [],
    },
  };
}

function capHoldHistoryScenario(realWorld: RosterWorld): {
  world: RosterWorld;
  teamAId: string;
  teamBId: string;
  cutPlayerId: string;
  seededFreeAgentId: string;
} {
  const teamA = structuredClone(realWorld.teams[0]);
  const teamB = structuredClone(realWorld.teams[1]);
  const source = realWorld.players.slice(0, 30);
  const aSource = source.slice(0, 15);
  const bSource = source.slice(15, 29);
  const seededFreeAgent = source[29];

  const aPlayers = aSource.map((player) => asStandardPlayer(player, teamA.id));
  const bPlayers = bSource.map((player) => asStandardPlayer(player, teamB.id));
  const freeAgentPlayer: Player = {
    ...asStandardPlayer(seededFreeAgent, ''),
    desiredContract: {
      type: 'veteran',
      desiredSalary: 5,
      desiredYears: 1,
    },
  };

  teamA.roster = aPlayers.map((player) => player.id);
  teamB.roster = bPlayers.map((player) => player.id);

  return {
    world: {
      teams: [teamA, teamB],
      players: [...aPlayers, ...bPlayers, freeAgentPlayer],
      season: {
        ...structuredClone(realWorld.season),
        freeAgentPool: [freeAgentPlayer.id],
        transactionLog: [],
      },
    },
    teamAId: teamA.id,
    teamBId: teamB.id,
    cutPlayerId: aPlayers[0].id,
    seededFreeAgentId: freeAgentPlayer.id,
  };
}

function testRealWorldArithmetic(world: RosterWorld): void {
  console.log('\nA. Real-world arithmetic');
  const before = snap(world);
  const team = world.teams[0];
  const playersById = new Map(world.players.map((player) => [player.id, player]));
  const manualPayroll = team.roster.reduce((total, playerId) => {
    const player = playersById.get(playerId);
    if (!player) throw new Error(`real-data fixture missing ${playerId}`);
    return player.contract.type === 'two_way'
      ? total
      : total + currentSalary(player.contract);
  }, 0);
  const payroll = computeTeamPayroll(world, team.id);
  const holds = computeCapHolds(world, team.id);
  const incomplete = computeIncompleteRosterCharge(world, team.id);
  const capRoomSalary = computeCapRoomSalary(world, team.id);
  const capRoom = computeCapRoom(world, team.id);
  const taxPayroll = computeTaxPayroll(world, team.id);
  const apronPayroll = computeApronPayroll(world, team.id);

  check('manual standard-contract sum matches team payroll', close(payroll, manualPayroll));
  check('cap-room salary uses payroll + holds + incomplete-roster charge',
    close(capRoomSalary, payroll + holds + incomplete));
  check('cap room is salary cap minus cap-room salary', close(capRoom, SALARY_CAP - capRoomSalary));
  check('Phase 3 tax payroll equals raw payroll', close(taxPayroll, payroll));
  check('Phase 3 apron payroll equals raw payroll', close(apronPayroll, payroll));
  check('all team financial values are finite',
    [payroll, holds, incomplete, capRoomSalary, capRoom, taxPayroll, apronPayroll]
      .every(Number.isFinite));

  const withTwoWay = world.teams.find((candidate) =>
    candidate.roster.some((id) => playersById.get(id)?.contract.type === 'two_way'));
  if (withTwoWay) {
    const inclusive = withTwoWay.roster.reduce(
      (total, id) => total + currentSalary(playersById.get(id)!.contract),
      0,
    );
    check('real-data two-way salaries are excluded from payroll',
      inclusive > computeTeamPayroll(world, withTwoWay.id));
  } else {
    const synthetic = rosterScenario(world, 1, 1);
    check('synthetic two-way salary is excluded from payroll',
      close(computeTeamPayroll(synthetic, synthetic.teams[0].id), 5));
  }

  const summaries = getLeagueFinancialSummary(world);
  check('league summary preserves world.teams order',
    summaries.map((summary) => summary.teamId).join('|') === world.teams.map((t) => t.id).join('|'));
  check('every league-summary financial value is finite',
    summaries.every((summary) => [
      summary.payroll,
      summary.capHolds,
      summary.incompleteRosterCharge,
      summary.capRoomSalary,
      summary.capRoom,
      summary.taxPayroll,
      summary.apronPayroll,
    ].every(Number.isFinite)));
  check('team cap-status accessor matches the summary',
    getTeamCapStatus(world, team.id) === getTeamFinancialSummary(world, team.id).capStatus);
  check('financial calculations do not mutate their input', snap(world) === before);

  console.log('\nTeam financial summary ($M)');
  console.log('Team      Payroll   CapSalary    CapRoom        Tax      Apron  Status');
  for (const summary of summaries) {
    const abbreviation = world.teams.find((candidate) => candidate.id === summary.teamId)?.abbreviation
      ?? summary.teamId;
    console.log(
      `${abbreviation.padEnd(6)}  ${summary.payroll.toFixed(3).padStart(9)}  ` +
      `${summary.capRoomSalary.toFixed(3).padStart(10)}  ${summary.capRoom.toFixed(3).padStart(9)}  ` +
      `${summary.taxPayroll.toFixed(3).padStart(9)}  ${summary.apronPayroll.toFixed(3).padStart(9)}  ` +
      summary.capStatus,
    );
  }

  const payrolls = summaries.map((summary) => summary.payroll).sort((a, b) => a - b);
  const middle = Math.floor(payrolls.length / 2);
  const median = payrolls.length % 2 === 0
    ? (payrolls[middle - 1] + payrolls[middle]) / 2
    : payrolls[middle];
  const statuses: CapStatus[] = [
    'under_cap',
    'over_cap',
    'over_tax',
    'over_first_apron',
    'over_second_apron',
  ];

  console.log(
    `Payroll min/median/max: ${payrolls[0].toFixed(3)} / ${median.toFixed(3)} / ` +
    `${payrolls[payrolls.length - 1].toFixed(3)}`,
  );
  console.log(`Status counts: ${statuses.map((status) =>
    `${status}=${summaries.filter((summary) => summary.capStatus === status).length}`).join(', ')}`);
}

function testThresholds(): void {
  console.log('\nB. Pure threshold classification');
  const epsilon = 0.001;
  const classify = (capRoomSalary: number, taxPayroll: number, apronPayroll: number) =>
    classifyCapStatus({ capRoomSalary, taxPayroll, apronPayroll });

  check('just below salary cap is under_cap',
    classify(SALARY_CAP - epsilon, 0, 0) === 'under_cap');
  check('exact salary cap is over_cap', classify(SALARY_CAP, 0, 0) === 'over_cap');
  check('just below tax line is not over_tax',
    classify(SALARY_CAP, LUXURY_TAX_LINE - epsilon, 0) === 'over_cap');
  check('exact tax line is over_tax',
    classify(SALARY_CAP, LUXURY_TAX_LINE, 0) === 'over_tax');
  check('just below first apron is not over_first_apron',
    classify(0, 0, FIRST_APRON - epsilon) === 'under_cap');
  check('exact first apron is over_first_apron',
    classify(0, 0, FIRST_APRON) === 'over_first_apron');
  check('just below second apron remains over_first_apron',
    classify(0, 0, SECOND_APRON - epsilon) === 'over_first_apron');
  check('exact second apron is over_second_apron',
    classify(0, 0, SECOND_APRON) === 'over_second_apron');
  check('large holds can create only over_cap when tax/apron bases stay low',
    classify(SALARY_CAP + 100, 100, 100) === 'over_cap');
}

function testIncompleteRosterCharges(world: RosterWorld): void {
  console.log('\nC. Incomplete-roster charges');
  const expected = (missing: number) => missing * ROOKIE_MINIMUM_SALARY;
  for (const standardCount of [10, 11, 12, 14]) {
    const synthetic = rosterScenario(world, standardCount);
    const missing = Math.max(0, INCOMPLETE_ROSTER_THRESHOLD - standardCount);
    check(`${standardCount} standard players => ${missing} empty-slot charge(s)`,
      close(computeIncompleteRosterCharge(synthetic, synthetic.teams[0].id), expected(missing)));
  }
  const elevenPlusTwoWay = rosterScenario(world, 11, 1);
  check('11 standard + 1 two-way still has one empty standard slot',
    close(
      computeIncompleteRosterCharge(elevenPlusTwoWay, elevenPlusTwoWay.teams[0].id),
      ROOKIE_MINIMUM_SALARY,
    ));
  check('two-way contract is also excluded from synthetic payroll',
    close(computeTeamPayroll(elevenPlusTwoWay, elevenPlusTwoWay.teams[0].id), 55));
}

function testCapHoldHistory(realWorld: RosterWorld): void {
  console.log('\nD. Cap-hold history');
  const { world, teamAId, teamBId, cutPlayerId, seededFreeAgentId } =
    capHoldHistoryScenario(realWorld);

  check('seeded free agent with no history creates no hold',
    computeCapHolds(world, teamAId) === 0 && computeCapHolds(world, teamBId) === 0);

  const cutByA = applyCut(world, { teamId: teamAId, playerId: cutPlayerId });
  check('Team A can cut from a 15-player roster', cutByA.ok);
  if (!cutByA.ok) return;
  const cutAEntry = cutByA.entry as CutEntry;
  const expectedA = Math.max(
    currentSalary(cutAEntry.contractAtCut!) * CAP_HOLD_PERCENTAGE,
    ROOKIE_MINIMUM_SALARY,
  );
  check('cut player enters the FA pool', cutByA.world.season.freeAgentPool.includes(cutPlayerId));
  check('Team A receives exactly one hold based on contractAtCut',
    close(computeCapHolds(cutByA.world, teamAId), expectedA));

  const signedByB = applySignFreeAgent(cutByA.world, { teamId: teamBId, playerId: cutPlayerId });
  check('Team B can sign the cut player', signedByB.ok);
  if (!signedByB.ok) return;
  check('signing removes the player from the FA pool',
    !signedByB.world.season.freeAgentPool.includes(cutPlayerId));
  check('Team A hold disappears after Team B signs the player',
    computeCapHolds(signedByB.world, teamAId) === 0);

  const cutByB = applyCut(signedByB.world, { teamId: teamBId, playerId: cutPlayerId });
  check('Team B can later cut the same player', cutByB.ok);
  if (!cutByB.ok) return;
  const cutBEntry = cutByB.entry as CutEntry;
  const expectedB = Math.max(
    currentSalary(cutBEntry.contractAtCut!) * CAP_HOLD_PERCENTAGE,
    ROOKIE_MINIMUM_SALARY,
  );
  check('only Team B owns the latest cut proxy hold',
    computeCapHolds(cutByB.world, teamAId) === 0 &&
    close(computeCapHolds(cutByB.world, teamBId), expectedB));

  const signedBackByA = applySignFreeAgent(cutByB.world, {
    teamId: teamAId,
    playerId: cutPlayerId,
  });
  check('Team A can sign the player back', signedBackByA.ok);
  if (!signedBackByA.ok) return;
  const cutAgainByA = applyCut(signedBackByA.world, { teamId: teamAId, playerId: cutPlayerId });
  check('Team A can cut the player again', cutAgainByA.ok);
  if (!cutAgainByA.ok) return;
  const latestCut = cutAgainByA.entry as CutEntry;
  const latestExpected = Math.max(
    currentSalary(latestCut.contractAtCut!) * CAP_HOLD_PERCENTAGE,
    ROOKIE_MINIMUM_SALARY,
  );
  check('repeated sign/cut history counts one current FA hold, never stale holds',
    close(computeCapHolds(cutAgainByA.world, teamAId), latestExpected) &&
    computeCapHolds(cutAgainByA.world, teamBId) === 0);

  const legacyCutWorld = structuredClone(world);
  legacyCutWorld.season.transactionLog = [{
    type: 'cut',
    seq: 0,
    date: legacyCutWorld.season.currentDate,
    season: legacyCutWorld.season.seasonId,
    playerId: seededFreeAgentId,
    fromTeamId: teamAId,
  }];
  check('pre-Phase-2 cut without contractAtCut creates no hold',
    computeCapHolds(legacyCutWorld, teamAId) === 0);
}

function testDefensiveFailures(world: RosterWorld): void {
  console.log('\nE. Defensive invariant failures');
  check('unknown team throws an informative error',
    throwsMatching(() => computeTeamPayroll(world, 'missing-team'), /team.*missing-team.*does not exist/i));

  const corrupt = structuredClone(world);
  corrupt.teams[0].roster = [...corrupt.teams[0].roster, 'missing-player'];
  check('missing roster player throws instead of understating payroll',
    throwsMatching(
      () => getTeamFinancialSummary(corrupt, corrupt.teams[0].id),
      /roster references missing player.*missing-player/i,
    ));
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf-8'));
  const rawPlayers: Player[] = JSON.parse(
    await readFile(path.join(dataDir, 'players.json'), 'utf-8'),
  );
  const normalized = normalizePlayersForSave(rawPlayers, []);
  const season = createSeasonState(teams, normalized.players, { seed: 1 });
  season.freeAgentPool = [...normalized.freeAgentPool];
  const world: RosterWorld = { teams, players: normalized.players, season };

  testRealWorldArithmetic(world);
  testThresholds();
  testIncompleteRosterCharges(world);
  testCapHoldHistory(world);
  testDefensiveFailures(world);

  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
