/** Focused acceptance harness for transactions Phase 4. */
import { readFile } from 'fs/promises';
import path from 'path';
import { createSeasonState } from '../src/engine/season';
import { migrateSaveFile } from '../src/data/saves/migrations';
import { Player, ContractType, ReSigningRightsType } from '../src/models/player';
import { SaveFile, SAVE_SCHEMA_VERSION, derivePhase } from '../src/models/save';
import { Team } from '../src/models/team';
import { CutEntry } from '../src/models/transaction';
import {
  analyzeTradeMatchingForTeam,
  applyCut,
  applySignFreeAgent,
  applyTrade,
  buildPlayerTrade,
  computeCapHolds,
  computePlayerCapHold,
  deriveReSigningRightsForCut,
  generateDesiredContract,
  EARLY_BIRD_AVERAGE_SALARY_MULTIPLIER,
  ESTIMATED_AVERAGE_PLAYER_SALARY_2024_25,
  executeCpuTrade,
  expandedTpeMaximum,
  FIRST_APRON,
  FREE_AGENT_TEAM_ID,
  maximumSalaryForRights,
  MINIMUM_TEAM_SALARY,
  projectPostSigningCapRoomSalary,
  projectPostTradeApronPayroll,
  projectPostTradeCapRoomSalary,
  ROOKIE_MINIMUM_SALARY,
  RosterWorld,
  SALARY_CAP,
  SECOND_APRON,
  TRADE_ALLOWANCE,
} from '../src/transactions';

let failures = 0;
let sourceTeams: Team[];
let sourcePlayers: Player[];

function check(label: string, ok: boolean): void {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

function close(actual: number, expected: number, tolerance = 1e-8): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function snap(value: unknown): string {
  return JSON.stringify(value);
}

function player(world: RosterWorld, id: string): Player {
  return world.players.find((candidate) => candidate.id === id)!;
}

function team(world: RosterWorld, id: string): Team {
  return world.teams.find((candidate) => candidate.id === id)!;
}

interface Fixture {
  world: RosterWorld;
  aId: string;
  bId: string;
  a: string[];
  b: string[];
  fa: string[];
}

function fixture(aCount = 15, bCount = 15, faCount = 3, salary = 10): Fixture {
  const teamA = structuredClone(sourceTeams[0]);
  const teamB = structuredClone(sourceTeams[1]);
  const selected = sourcePlayers.slice(0, aCount + bCount + faCount).map((p) => structuredClone(p));
  const a = selected.slice(0, aCount).map((p) => p.id);
  const b = selected.slice(aCount, aCount + bCount).map((p) => p.id);
  const fa = selected.slice(aCount + bCount).map((p) => p.id);
  teamA.roster = [...a];
  teamB.roster = [...b];
  delete teamA.hardCappedAtApron;
  delete teamB.hardCappedAtApron;

  const aSet = new Set(a);
  const bSet = new Set(b);
  for (const p of selected) {
    p.teamId = aSet.has(p.id) ? teamA.id : bSet.has(p.id) ? teamB.id : FREE_AGENT_TEAM_ID;
    p.contract = { type: 'veteran', salarySchedule: [salary], noTradeClause: false };
    p.desiredContract = fa.includes(p.id)
      ? { type: 'minimum', desiredSalary: ROOKIE_MINIMUM_SALARY, desiredYears: 1 }
      : undefined;
    delete p.birdRights;
  }

  const season = createSeasonState([teamA, teamB], selected, { seed: 1 });
  const deadline = season.markers.find((marker) => marker.type === 'trade_deadline')!;
  season.currentDate = deadline.date;
  season.freeAgentPool = [...fa];
  season.transactionLog = [];
  return {
    world: { teams: [teamA, teamB], players: selected, season },
    aId: teamA.id,
    bId: teamB.id,
    a,
    b,
    fa,
  };
}

function setContract(
  world: RosterWorld,
  id: string,
  salary: number,
  type: ContractType = 'veteran',
  years = 1,
): void {
  player(world, id).contract = {
    type,
    salarySchedule: Array.from({ length: years }, () => salary),
    noTradeClause: false,
  };
}

function setTeamPayroll(
  world: RosterWorld,
  teamId: string,
  total: number,
  overrides: Record<string, number> = {},
): void {
  const ids = team(world, teamId).roster;
  const fixed = new Set(Object.keys(overrides));
  const remainderIds = ids.filter((id) => !fixed.has(id));
  const fixedTotal = Object.values(overrides).reduce((sum, salary) => sum + salary, 0);
  const remainderSalary = remainderIds.length === 0 ? 0 : (total - fixedTotal) / remainderIds.length;
  for (const id of ids) setContract(world, id, overrides[id] ?? remainderSalary);
}

function setDesired(
  world: RosterWorld,
  id: string,
  salary: number,
  years: number,
  type: ContractType = 'veteran',
  rights?: { teamId: string; type: ReSigningRightsType },
): void {
  const p = player(world, id);
  p.desiredContract = { type, desiredSalary: salary, desiredYears: years };
  if (rights) p.birdRights = rights;
  else delete p.birdRights;
}

function testExpandedFormula(): void {
  console.log('\nA. Expanded TPE formula and crossovers');
  const cases: Array<[number, number]> = [
    [8, 16.25],
    [8.277, 16.804],
    [10, 18.527],
    [33.108, 41.635],
    [40, 50.25],
  ];
  for (const [outgoing, expected] of cases) {
    check(`$${outgoing}M outgoing => $${expected}M maximum`,
      close(expandedTpeMaximum(outgoing, TRADE_ALLOWANCE), expected, 1e-6));
  }
  const epsilon = 0.001;
  check('first crossover changes from 200% to fixed-cushion region',
    close(expandedTpeMaximum(8.277 - epsilon, TRADE_ALLOWANCE), 2 * (8.277 - epsilon) + 0.25) &&
    close(expandedTpeMaximum(8.277 + epsilon, TRADE_ALLOWANCE), 8.277 + epsilon + 8.527));
  check('second crossover changes from fixed-cushion to 125% region',
    close(expandedTpeMaximum(33.108 - epsilon, TRADE_ALLOWANCE), 33.108 - epsilon + 8.527) &&
    close(expandedTpeMaximum(33.108 + epsilon, TRADE_ALLOWANCE), 1.25 * (33.108 + epsilon) + 0.25));
}

function testProjectionsAndMatching(): void {
  console.log('\nB. Projections, allowance, and matching modes');

  const uneven = fixture(11, 11, 0, 5);
  const beforeCharge = projectPostTradeCapRoomSalary(uneven.world, uneven.aId, [], []);
  const afterCharge = projectPostTradeCapRoomSalary(
    uneven.world, uneven.aId, [uneven.a[0], uneven.a[1]], [uneven.b[0]],
  );
  check('2-for-1 projection adds one incomplete-roster charge net of salaries',
    close(afterCharge - beforeCharge, -5 + ROOKIE_MINIMUM_SALARY));

  const unevenRoom = fixture(11, 11, 0, 5);
  setContract(unevenRoom.world, unevenRoom.b[0], 108);
  check('room matching uses projected incomplete-roster charges, not only current room',
    !analyzeTradeMatchingForTeam(
      unevenRoom.world,
      unevenRoom.aId,
      [unevenRoom.a[0], unevenRoom.a[1]],
      [unevenRoom.b[0]],
    ).ok);

  const twoWay = fixture(15, 15, 0, 10);
  setContract(twoWay.world, twoWay.a[0], 100, 'two_way');
  setContract(twoWay.world, twoWay.b[0], 100, 'two_way');
  const twoWayPlan = analyzeTradeMatchingForTeam(
    twoWay.world, twoWay.aId, [twoWay.a[0]], [twoWay.b[0]],
  );
  check('two-way contracts generate zero matching salary',
    twoWayPlan.ok && twoWayPlan.plan.outgoingSalary === 0 && twoWayPlan.plan.incomingSalary === 0);
  check('two-way contracts are excluded from projected apron payroll',
    close(projectPostTradeApronPayroll(twoWay.world, twoWay.aId, [], []), 140));

  const room = fixture();
  setTeamPayroll(room.world, room.aId, 140, { [room.a[0]]: 10 });
  setContract(room.world, room.b[0], 10 + (SALARY_CAP - 140) + TRADE_ALLOWANCE);
  const roomBoundary = analyzeTradeMatchingForTeam(room.world, room.aId, [room.a[0]], [room.b[0]]);
  check('under-cap room includes net incoming plus $0.25M at the exact boundary',
    roomBoundary.ok && roomBoundary.plan.mode === 'room');
  setContract(room.world, room.b[0], 10 + (SALARY_CAP - 140) + TRADE_ALLOWANCE + 0.001);
  check('under-cap room rejects one dollar-band epsilon above the boundary',
    !analyzeTradeMatchingForTeam(room.world, room.aId, [room.a[0]], [room.b[0]]).ok);

  const standard = fixture();
  setTeamPayroll(standard.world, standard.aId, 160, { [standard.a[0]]: 10 });
  setContract(standard.world, standard.b[0], 10.25);
  const standardPlan = analyzeTradeMatchingForTeam(
    standard.world, standard.aId, [standard.a[0]], [standard.b[0]],
  );
  check('one outgoing salary selects standard mode without a hard cap',
    standardPlan.ok && standardPlan.plan.mode === 'standard' && !standardPlan.plan.triggeredHardCap);

  const unaggregatedPackage = fixture();
  setTeamPayroll(unaggregatedPackage.world, unaggregatedPackage.aId, 160, {
    [unaggregatedPackage.a[0]]: 20,
    [unaggregatedPackage.a[1]]: 2,
  });
  setContract(unaggregatedPackage.world, unaggregatedPackage.b[0], 19);
  const unaggregatedPlan = analyzeTradeMatchingForTeam(
    unaggregatedPackage.world,
    unaggregatedPackage.aId,
    [unaggregatedPackage.a[0], unaggregatedPackage.a[1]],
    [unaggregatedPackage.b[0]],
  );
  check('multi-player package uses one Standard TPE when aggregation is unnecessary',
    unaggregatedPlan.ok && unaggregatedPlan.plan.mode === 'standard' &&
    !unaggregatedPlan.plan.triggeredHardCap);

  const aggregate = fixture();
  setTeamPayroll(aggregate.world, aggregate.aId, 160, {
    [aggregate.a[0]]: 5, [aggregate.a[1]]: 5,
  });
  setContract(aggregate.world, aggregate.b[0], 10.25);
  const aggregatePlan = analyzeTradeMatchingForTeam(
    aggregate.world, aggregate.aId, [aggregate.a[0], aggregate.a[1]], [aggregate.b[0]],
  );
  check('multiple outgoing salaries select aggregated standard before Expanded',
    aggregatePlan.ok && aggregatePlan.plan.mode === 'aggregated_standard' &&
    aggregatePlan.plan.triggeredHardCap === 'second_apron');

  const expanded = fixture();
  setTeamPayroll(expanded.world, expanded.aId, 160, { [expanded.a[0]]: 10 });
  setContract(expanded.world, expanded.b[0], 18.527);
  const expandedPlan = analyzeTradeMatchingForTeam(
    expanded.world, expanded.aId, [expanded.a[0]], [expanded.b[0]],
  );
  check('Expanded mode covers salary beyond standard and triggers first-apron hard cap',
    expandedPlan.ok && expandedPlan.plan.mode === 'expanded' &&
    expandedPlan.plan.triggeredHardCap === 'first_apron');

  const allowance = fixture();
  setTeamPayroll(allowance.world, allowance.aId, FIRST_APRON, { [allowance.a[0]]: 40 });
  setContract(allowance.world, allowance.b[0], 40.25);
  check('post-trade Team Salary above first apron removes the $0.25M allowance',
    !analyzeTradeMatchingForTeam(allowance.world, allowance.aId, [allowance.a[0]], [allowance.b[0]]).ok);
  setContract(allowance.world, allowance.b[0], 40);
  check('high-tier dollar-for-dollar matching remains legal after allowance removal',
    analyzeTradeMatchingForTeam(allowance.world, allowance.aId, [allowance.a[0]], [allowance.b[0]]).ok);

  const postFirst = fixture();
  setTeamPayroll(postFirst.world, postFirst.aId, FIRST_APRON - 1, { [postFirst.a[0]]: 10 });
  setContract(postFirst.world, postFirst.b[0], 18);
  check('post-trade, not pre-trade, first-apron payroll blocks Expanded use',
    !analyzeTradeMatchingForTeam(postFirst.world, postFirst.aId, [postFirst.a[0]], [postFirst.b[0]]).ok);

  const shedBelowSecond = fixture();
  setTeamPayroll(shedBelowSecond.world, shedBelowSecond.aId, SECOND_APRON + 2, {
    [shedBelowSecond.a[0]]: 10, [shedBelowSecond.a[1]]: 10,
  });
  setContract(shedBelowSecond.world, shedBelowSecond.b[0], 10.25);
  const shedPlan = analyzeTradeMatchingForTeam(
    shedBelowSecond.world, shedBelowSecond.aId,
    [shedBelowSecond.a[0], shedBelowSecond.a[1]], [shedBelowSecond.b[0]],
  );
  check('team above second apron may aggregate only when the trade brings it below',
    shedPlan.ok && shedPlan.plan.mode === 'aggregated_standard' &&
    shedPlan.plan.projectedApronPayroll <= SECOND_APRON);

  const remainAboveSecond = fixture();
  setTeamPayroll(remainAboveSecond.world, remainAboveSecond.aId, SECOND_APRON + 1, {
    [remainAboveSecond.a[0]]: 5, [remainAboveSecond.a[1]]: 5,
  });
  setContract(remainAboveSecond.world, remainAboveSecond.b[0], 10);
  check('aggregation is rejected when projected payroll remains above second apron',
    !analyzeTradeMatchingForTeam(
      remainAboveSecond.world, remainAboveSecond.aId,
      [remainAboveSecond.a[0], remainAboveSecond.a[1]], [remainAboveSecond.b[0]],
    ).ok);
}

function testTradeGate(): void {
  console.log('\nC. Trade gate, hard caps, NTC, and deadline');

  const aggregated = fixture(15, 14);
  setTeamPayroll(aggregated.world, aggregated.aId, 160, {
    [aggregated.a[0]]: 5, [aggregated.a[1]]: 5,
  });
  setTeamPayroll(aggregated.world, aggregated.bId, 160, { [aggregated.b[0]]: 10.25 });
  const aggregateTrade = buildPlayerTrade(
    aggregated.aId, aggregated.bId,
    [aggregated.a[0], aggregated.a[1]], [aggregated.b[0]],
  );
  const aggregateResult = applyTrade(aggregated.world, aggregateTrade);
  check('successful aggregation atomically persists a second-apron hard cap',
    aggregateResult.ok && team(aggregateResult.world, aggregated.aId).hardCappedAtApron === 'second_apron');

  const expanded = fixture();
  setTeamPayroll(expanded.world, expanded.aId, 160, { [expanded.a[0]]: 10 });
  setTeamPayroll(expanded.world, expanded.bId, 160, { [expanded.b[0]]: 18.527 });
  const expandedTrade = buildPlayerTrade(expanded.aId, expanded.bId, [expanded.a[0]], [expanded.b[0]]);
  const expandedResult = applyTrade(expanded.world, expandedTrade);
  check('successful Expanded trade atomically persists a first-apron hard cap',
    expandedResult.ok && team(expandedResult.world, expanded.aId).hardCappedAtApron === 'first_apron');

  const noDowngrade = fixture(15, 14);
  team(noDowngrade.world, noDowngrade.aId).hardCappedAtApron = 'first_apron';
  setTeamPayroll(noDowngrade.world, noDowngrade.aId, 160, {
    [noDowngrade.a[0]]: 5, [noDowngrade.a[1]]: 5,
  });
  setTeamPayroll(noDowngrade.world, noDowngrade.bId, 160, { [noDowngrade.b[0]]: 10.25 });
  const noDowngradeResult = applyTrade(noDowngrade.world, buildPlayerTrade(
    noDowngrade.aId, noDowngrade.bId,
    [noDowngrade.a[0], noDowngrade.a[1]], [noDowngrade.b[0]],
  ));
  check('existing first-apron hard cap is never downgraded by aggregation',
    noDowngradeResult.ok && team(noDowngradeResult.world, noDowngrade.aId).hardCappedAtApron === 'first_apron');

  const existingCap = fixture();
  team(existingCap.world, existingCap.aId).hardCappedAtApron = 'first_apron';
  setTeamPayroll(existingCap.world, existingCap.aId, FIRST_APRON + 1, {
    [existingCap.a[0]]: 10,
  });
  setTeamPayroll(existingCap.world, existingCap.bId, 160, { [existingCap.b[0]]: 10 });
  const existingCapBefore = snap(existingCap.world);
  const existingCapResult = applyTrade(existingCap.world, buildPlayerTrade(
    existingCap.aId, existingCap.bId, [existingCap.a[0]], [existingCap.b[0]],
  ));
  check('existing first-apron hard cap blocks a trade that finishes above it',
    !existingCapResult.ok && /hard cap/.test(existingCapResult.reason));
  check('failed existing-hard-cap trade is byte-identical',
    snap(existingCap.world) === existingCapBefore);

  const holdDrivenCap = fixture(15, 15, 1);
  team(holdDrivenCap.world, holdDrivenCap.aId).hardCappedAtApron = 'first_apron';
  setTeamPayroll(holdDrivenCap.world, holdDrivenCap.aId, FIRST_APRON - 5, {
    [holdDrivenCap.a[0]]: 10,
  });
  setTeamPayroll(holdDrivenCap.world, holdDrivenCap.bId, 160, {
    [holdDrivenCap.b[0]]: 10,
  });
  setContract(holdDrivenCap.world, holdDrivenCap.fa[0], 10);
  player(holdDrivenCap.world, holdDrivenCap.fa[0]).birdRights = {
    teamId: holdDrivenCap.aId,
    type: 'bird',
  };
  const holdDrivenProposal = buildPlayerTrade(
    holdDrivenCap.aId, holdDrivenCap.bId,
    [holdDrivenCap.a[0]], [holdDrivenCap.b[0]],
  );
  const holdDrivenPlan = analyzeTradeMatchingForTeam(
    holdDrivenCap.world, holdDrivenCap.aId,
    [holdDrivenCap.a[0]], [holdDrivenCap.b[0]],
  );
  check('hold fixture keeps Apron Team Salary below first apron but Team Salary above it',
    holdDrivenPlan.ok &&
    holdDrivenPlan.plan.projectedApronPayroll <= FIRST_APRON &&
    holdDrivenPlan.plan.projectedTeamSalary > FIRST_APRON);
  check('existing hard cap rejects hold-driven Team Salary even when apron payroll is below',
    !applyTrade(holdDrivenCap.world, holdDrivenProposal).ok);

  const ntc = fixture();
  player(ntc.world, ntc.a[0]).contract.noTradeClause = true;
  const equalTrade = buildPlayerTrade(ntc.aId, ntc.bId, [ntc.a[0]], [ntc.b[0]]);
  const ntcBefore = snap(ntc.world);
  check('NTC blocks a player leaving the controlled team',
    !applyTrade(ntc.world, equalTrade, { controlledTeamId: ntc.aId }).ok);
  check('failed NTC validation leaves the input byte-identical', snap(ntc.world) === ntcBefore);
  check('NTC is skipped when no controlled team is supplied', applyTrade(ntc.world, equalTrade).ok);
  check('CPU execution still enforces NTC for a controlled proposer',
    !executeCpuTrade(ntc.world, equalTrade, ntc.bId, { controlledTeamId: ntc.aId }).ok);
  player(ntc.world, ntc.a[0]).contract.noTradeClause = false;
  player(ntc.world, ntc.b[0]).contract.noTradeClause = true;
  check('CPU-side NTC is treated as waived off-screen',
    applyTrade(ntc.world, equalTrade, { controlledTeamId: ntc.aId }).ok);

  const window = fixture();
  const windowTrade = buildPlayerTrade(window.aId, window.bId, [window.a[0]], [window.b[0]]);
  check('trade is legal on the deadline date', applyTrade(window.world, windowTrade).ok);
  window.world.season.currentDate = '2099-12-31';
  check('trade is rejected after the deadline', !applyTrade(window.world, windowTrade).ok);
  window.world.season.markers = window.world.season.markers.filter((m) => m.type !== 'trade_deadline');
  check('missing deadline marker fails closed', !applyTrade(window.world, windowTrade).ok);
  const malformed = fixture();
  malformed.world.season.currentDate = '2025-2-01';
  check('non-canonical dates fail closed before lexicographic comparison',
    !applyTrade(malformed.world, buildPlayerTrade(
      malformed.aId, malformed.bId, [malformed.a[0]], [malformed.b[0]],
    )).ok);
}

function testRightsAndSignings(): void {
  console.log('\nD. Rights proxy, signing exceptions, and hard caps');
  const proxyCases: Array<[ContractType, number, ReSigningRightsType]> = [
    ['two_way', 2, 'non_bird'], ['rookie_scale', 1, 'bird'], ['max', 8, 'bird'],
    ['minimum', 6, 'non_bird'], ['veteran', 3, 'bird'], ['veteran', 2, 'early_bird'],
    ['veteran', 0, 'non_bird'],
  ];
  for (const [type, experience, expected] of proxyCases) {
    check(`${type}/${experience} years assigns ${expected}`,
      deriveReSigningRightsForCut(
        { type, salarySchedule: [5], noTradeClause: false }, experience, 'T',
      ).type === expected);
  }

  const cut = fixture(15, 14, 0, 5);
  player(cut.world, cut.a[0]).experience = 2;
  const cutContract = snap(player(cut.world, cut.a[0]).contract);
  const cutResult = applyCut(cut.world, { teamId: cut.aId, playerId: cut.a[0] });
  check('cut assigns explicit rights while preserving immutable contract snapshot',
    cutResult.ok &&
    player(cutResult.world, cut.a[0]).birdRights?.type === 'early_bird' &&
    snap((cutResult.entry as CutEntry).contractAtCut) === cutContract);

  const minimumPlayer = structuredClone(player(cut.world, cut.a[1]));
  minimumPlayer.contract = {
    type: 'minimum', salarySchedule: [1.1, 1.1], noTradeClause: false,
  };
  const generatedMinimum = generateDesiredContract(minimumPlayer);
  check('production desired-contract generation preserves genuine minimum eligibility',
    generatedMinimum.type === 'minimum' &&
    generatedMinimum.desiredSalary === ROOKIE_MINIMUM_SALARY &&
    generatedMinimum.desiredYears === 2);

  const signingCase = (
    rightsType: ReSigningRightsType,
    desiredSalary: number,
    desiredYears: number,
    priorSalary = 5,
  ) => {
    const f = fixture(14, 14, 1, 12);
    const id = f.fa[0];
    setContract(f.world, id, priorSalary);
    player(f.world, id).experience = 5;
    setDesired(f.world, id, desiredSalary, desiredYears, 'veteran', {
      teamId: f.aId, type: rightsType,
    });
    return { f, id };
  };

  const birdMax = maximumSalaryForRights('bird', 5, 5);
  const bird = signingCase('bird', birdMax, 5);
  check('Bird rights permit the general maximum for five years',
    applySignFreeAgent(bird.f.world, { teamId: bird.f.aId, playerId: bird.id }).ok);
  const birdTooHigh = signingCase('bird', birdMax + 0.001, 5);
  check('Bird salary above the maximum is rejected',
    !applySignFreeAgent(birdTooHigh.f.world, { teamId: birdTooHigh.f.aId, playerId: birdTooHigh.id }).ok);

  const earlyMax = maximumSalaryForRights('early_bird', 5, 5);
  check('Early Bird ceiling uses the estimated-average-salary branch in this fixture',
    close(earlyMax, ESTIMATED_AVERAGE_PLAYER_SALARY_2024_25 * EARLY_BIRD_AVERAGE_SALARY_MULTIPLIER));
  const early = signingCase('early_bird', earlyMax, 2);
  check('Early Bird exact salary ceiling and two-year minimum are legal',
    applySignFreeAgent(early.f.world, { teamId: early.f.aId, playerId: early.id }).ok);
  const earlyShort = signingCase('early_bird', earlyMax, 1);
  check('Early Bird one-year contract is rejected',
    !applySignFreeAgent(earlyShort.f.world, { teamId: earlyShort.f.aId, playerId: earlyShort.id }).ok);
  const earlyHigh = signingCase('early_bird', earlyMax + 0.001, 2);
  check('Early Bird salary above its ceiling is rejected',
    !applySignFreeAgent(earlyHigh.f.world, { teamId: earlyHigh.f.aId, playerId: earlyHigh.id }).ok);

  const nonBirdMax = maximumSalaryForRights('non_bird', 5, 5);
  const nonBird = signingCase('non_bird', nonBirdMax, 4);
  check('Non-Bird exact ceiling and four-year term are legal',
    applySignFreeAgent(nonBird.f.world, { teamId: nonBird.f.aId, playerId: nonBird.id }).ok);
  const nonBirdLong = signingCase('non_bird', nonBirdMax, 5);
  check('Non-Bird five-year contract is rejected',
    !applySignFreeAgent(nonBirdLong.f.world, { teamId: nonBirdLong.f.aId, playerId: nonBirdLong.id }).ok);

  const wrongTeam = signingCase('bird', 5, 2);
  player(wrongTeam.f.world, wrongTeam.id).birdRights!.teamId = wrongTeam.f.bId;
  check('rights belonging to another team do not create an over-cap exception',
    !applySignFreeAgent(wrongTeam.f.world, { teamId: wrongTeam.f.aId, playerId: wrongTeam.id }).ok);

  const minimum = fixture(14, 14, 1, 12);
  setDesired(minimum.world, minimum.fa[0], ROOKIE_MINIMUM_SALARY, 2, 'minimum');
  check('configured minimum contract for at most two years uses minimum exception',
    applySignFreeAgent(minimum.world, { teamId: minimum.aId, playerId: minimum.fa[0] }).ok);
  const fakeMinimum = fixture(14, 14, 1, 12);
  setDesired(fakeMinimum.world, fakeMinimum.fa[0], ROOKIE_MINIMUM_SALARY, 2, 'veteran');
  check('low-salary veteran deal is not reclassified as a minimum exception',
    !applySignFreeAgent(fakeMinimum.world, { teamId: fakeMinimum.aId, playerId: fakeMinimum.fa[0] }).ok);
  const longMinimum = fixture(14, 14, 1, 12);
  setDesired(longMinimum.world, longMinimum.fa[0], ROOKIE_MINIMUM_SALARY, 3, 'minimum');
  check('three-year minimum deal is not a minimum exception',
    !applySignFreeAgent(longMinimum.world, { teamId: longMinimum.aId, playerId: longMinimum.fa[0] }).ok);

  const replacement = fixture(14, 14, 1, 10);
  const replacementId = replacement.fa[0];
  setContract(replacement.world, replacementId, 10);
  setDesired(replacement.world, replacementId, 10, 2, 'veteran', {
    teamId: replacement.aId, type: 'bird',
  });
  check('own-player cap hold exists before signing',
    close(computeCapHolds(replacement.world, replacement.aId), computePlayerCapHold(player(replacement.world, replacementId))));
  check('signing projection replaces rather than stacks the player cap hold',
    close(projectPostSigningCapRoomSalary(replacement.world, replacement.aId, replacementId), 150));
  const replaced = applySignFreeAgent(replacement.world, { teamId: replacement.aId, playerId: replacementId });
  check('successful own-player signing clears rights and removes the hold',
    replaced.ok && player(replaced.world, replacementId).birdRights === undefined &&
    computeCapHolds(replaced.world, replacement.aId) === 0);

  for (const [hardCap, payroll] of [
    ['first_apron', FIRST_APRON - 0.5],
    ['second_apron', SECOND_APRON - 0.5],
  ] as const) {
    const hard = fixture(14, 14, 1, 10);
    setTeamPayroll(hard.world, hard.aId, payroll);
    team(hard.world, hard.aId).hardCappedAtApron = hardCap;
    const id = hard.fa[0];
    setContract(hard.world, id, 1);
    setDesired(hard.world, id, 1, 1, 'veteran', { teamId: hard.aId, type: 'bird' });
    const before = snap(hard.world);
    const result = applySignFreeAgent(hard.world, { teamId: hard.aId, playerId: id });
    check(`existing ${hardCap.replace('_', '-')} blocks signing above it`, !result.ok);
    check(`failed ${hardCap.replace('_', '-')} signing is byte-identical`, snap(hard.world) === before);
  }
}

function testWarningsAndAtomicity(): void {
  console.log('\nE. Salary-floor warnings and immutable results');
  const trade = fixture(15, 15, 0, 1);
  const proposal = buildPlayerTrade(trade.aId, trade.bId, [trade.a[0]], [trade.b[0]]);
  const result = applyTrade(trade.world, proposal);
  check('low-payroll trade succeeds with non-blocking warnings for both teams',
    result.ok && (result.warnings?.length ?? 0) === 2);

  const sign = fixture(14, 14, 1, 1);
  setDesired(sign.world, sign.fa[0], 1, 1, 'veteran');
  const signed = applySignFreeAgent(sign.world, { teamId: sign.aId, playerId: sign.fa[0] });
  check('low-payroll cap-room signing succeeds with a floor warning',
    signed.ok && (signed.warnings?.some((warning) => /minimum-team-salary/.test(warning)) ?? false));

  const cut = fixture(15, 14, 0, 1);
  const cutResult = applyCut(cut.world, { teamId: cut.aId, playerId: cut.a[0] });
  check('low-payroll cut succeeds with a floor warning',
    cutResult.ok && (cutResult.warnings?.some((warning) => /minimum-team-salary/.test(warning)) ?? false));

  const above = fixture(15, 15, 0, MINIMUM_TEAM_SALARY / 15 + 1);
  const aboveResult = applyTrade(
    above.world, buildPlayerTrade(above.aId, above.bId, [above.a[0]], [above.b[0]]),
  );
  check('teams remaining above the salary floor receive no warning',
    aboveResult.ok && aboveResult.warnings === undefined);

  if (result.ok) {
    const stored = snap(result.world.season.transactionLog);
    proposal.assetsFromA[0].playerId = trade.a[1];
    result.entry.seq = 99;
    check('successful trade log remains isolated from caller mutations',
      snap(result.world.season.transactionLog) === stored);
  }
}

function testMigration(): void {
  console.log('\nF. v3 -> v4 migration');
  const f = fixture(14, 14, 2, 5);
  const [cutFa, seededFa] = f.fa;
  player(f.world, cutFa).experience = 2;
  player(f.world, cutFa).birdRights = { teamId: f.bId, type: 'bird' };
  player(f.world, seededFa).birdRights = { teamId: f.aId, type: 'bird' };
  player(f.world, f.a[0]).birdRights = { teamId: f.aId, type: 'bird' };
  const cutEntry: CutEntry = {
    type: 'cut', seq: 0, date: f.world.season.currentDate, season: f.world.season.seasonId,
    playerId: cutFa, fromTeamId: f.aId,
    contractAtCut: { type: 'veteran', salarySchedule: [7], noTradeClause: false },
  };
  f.world.season.transactionLog = [cutEntry];
  const now = new Date(0).toISOString();
  const v3: SaveFile = {
    schemaVersion: 3,
    phase: derivePhase(f.world.season),
    season: f.world.season,
    teams: f.world.teams,
    players: f.world.players,
    createdAt: now,
    updatedAt: now,
  };
  const logBefore = snap(v3.season.transactionLog);
  const migrated = migrateSaveFile(v3);
  check('direct v3 migration reaches schema v4', migrated.ok && migrated.file.schemaVersion === 4);
  if (!migrated.ok) return;
  check('latest applicable cut reconstructs deterministic Early Bird rights',
    player(migrated.file, cutFa).birdRights?.teamId === f.aId &&
    player(migrated.file, cutFa).birdRights?.type === 'early_bird');
  check('seeded free agent without applicable cut has no rights',
    player(migrated.file, seededFa).birdRights === undefined);
  check('normalization clears rights from rostered players',
    player(migrated.file, f.a[0]).birdRights === undefined);
  check('migration does not rewrite append-only transaction entries',
    snap(migrated.file.season.transactionLog) === logBefore);
  check('canonical non-hard-capped teams omit the field',
    migrated.file.teams.every((candidate) => !('hardCappedAtApron' in candidate)));

  const roundTrip = JSON.parse(JSON.stringify(migrated.file)) as SaveFile;
  const second = migrateSaveFile(roundTrip);
  check('migration run twice reports no-op and is byte-identical',
    second.ok && !second.migrated && snap(second.file) === snap(roundTrip));
  const v1Season = structuredClone(v3.season) as unknown as Record<string, unknown>;
  delete v1Season.freeAgentPool;
  delete v1Season.transactionLog;
  const fullChain = migrateSaveFile({
    ...structuredClone(v3),
    schemaVersion: 1,
    season: v1Season,
  } as unknown as SaveFile);
  check('complete v1 -> v4 migration chain succeeds',
    fullChain.ok && fullChain.file.schemaVersion === SAVE_SCHEMA_VERSION);
  const future = migrateSaveFile({ ...roundTrip, schemaVersion: SAVE_SCHEMA_VERSION + 1 });
  check('future save version is rejected', !future.ok);
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  sourceTeams = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf8'));
  sourcePlayers = JSON.parse(await readFile(path.join(dataDir, 'players.json'), 'utf8'));
  testExpandedFormula();
  testProjectionsAndMatching();
  testTradeGate();
  testRightsAndSignings();
  testWarningsAndAtomicity();
  testMigration();
  console.log(`\n${failures === 0 ? 'PASS — all Phase 4 checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
