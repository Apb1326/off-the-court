/** Focused executable acceptance harness for transactions Phase 5a. */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { SaveFile, derivePhase, SAVE_SCHEMA_VERSION } from '../src/models/save';
import { CutEntry, SignEntry } from '../src/models/transaction';
import { createSeasonState } from '../src/engine/season';
import { migrateSaveFile } from '../src/data/saves/migrations';
import {
  addOneCalendarYear,
  analyzeTradeMatchingForTeam,
  applyCut,
  applySignFreeAgent,
  applyTrade,
  BI_ANNUAL_EXCEPTION,
  buildPlayerTrade,
  capYearForDate,
  capYearOffset,
  computeApronPayroll,
  computeCapRoomSalary,
  computeDeadMoney,
  computeTaxPayroll,
  computeTeamPayroll,
  computeTradeExceptionRemaining,
  computeTradeExceptionUsed,
  FIRST_APRON,
  FREE_AGENT_TEAM_ID,
  generateDesiredContract,
  getActiveTradeExceptions,
  getAvailableSigningExceptions,
  NON_TAXPAYER_MLE,
  processContractRollover,
  projectPostSigningApronPayroll,
  projectPostSigningCapRoomSalary,
  projectPostTradeApronPayroll,
  projectPostTradeCapRoomSalary,
  ROOM_MLE,
  RosterWorld,
} from '../src/transactions';

let failures = 0;
let sourceTeams: Team[];
let sourcePlayers: Player[];

function check(label: string, ok: boolean): void {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}
function close(a: number, b: number, tolerance = 1e-8): boolean {
  return Math.abs(a - b) <= tolerance;
}
function snap(value: unknown): string { return JSON.stringify(value); }
function player(world: RosterWorld, id: string): Player {
  return world.players.find((candidate) => candidate.id === id)!;
}
function team(world: RosterWorld, id: string): Team {
  return world.teams.find((candidate) => candidate.id === id)!;
}

interface Fixture { world: RosterWorld; aId: string; bId: string; a: string[]; b: string[]; fa: string[] }
function fixture(aCount = 15, bCount = 15, faCount = 0, salary = 10): Fixture {
  const teamA = structuredClone(sourceTeams[0]);
  const teamB = structuredClone(sourceTeams[1]);
  const selected = sourcePlayers.slice(0, aCount + bCount + faCount).map((p) => structuredClone(p));
  const a = selected.slice(0, aCount).map((p) => p.id);
  const b = selected.slice(aCount, aCount + bCount).map((p) => p.id);
  const fa = selected.slice(aCount + bCount).map((p) => p.id);
  teamA.roster = [...a]; teamB.roster = [...b];
  delete teamA.hardCappedAtApron; delete teamB.hardCappedAtApron;
  for (const p of selected) {
    p.teamId = a.includes(p.id) ? teamA.id : b.includes(p.id) ? teamB.id : FREE_AGENT_TEAM_ID;
    p.contract = { type: 'veteran', salarySchedule: [salary], noTradeClause: false };
    p.desiredContract = fa.includes(p.id)
      ? { type: 'veteran', desiredSalary: 5, desiredYears: 1 }
      : undefined;
    delete p.birdRights;
  }
  const season = createSeasonState([teamA, teamB], selected, { seed: 1, startDate: '2025-10-21' });
  season.currentDate = '2025-10-20';
  season.markers = season.markers.filter((marker) => marker.type !== 'trade_deadline');
  season.markers.push({ type: 'trade_deadline', date: '2026-02-05', label: 'Trade Deadline' });
  season.freeAgentPool = [...fa];
  return { world: { teams: [teamA, teamB], players: selected, season }, aId: teamA.id, bId: teamB.id, a, b, fa };
}
function setSalary(world: RosterWorld, id: string, salary: number, years = 1): void {
  player(world, id).contract = { type: 'veteran', salarySchedule: Array(years).fill(salary), noTradeClause: false };
}
function setPayroll(world: RosterWorld, teamId: string, total: number, overrides: Record<string, number> = {}): void {
  const ids = team(world, teamId).roster;
  const rest = ids.filter((id) => !(id in overrides));
  const remaining = total - Object.values(overrides).reduce((sum, salary) => sum + salary, 0);
  for (const id of ids) setSalary(world, id, overrides[id] ?? remaining / rest.length);
}
function setDesired(world: RosterWorld, id: string, salary: number, years: number): void {
  player(world, id).desiredContract = { type: 'veteran', desiredSalary: salary, desiredYears: years };
}

function testDatesAndDeadMoney(): void {
  console.log('\nA. Date helpers and dead money');
  check('January maps to prior cap-year start', capYearForDate('2026-01-15') === 2025);
  check('July maps to current cap-year start', capYearForDate('2026-07-01') === 2026);
  check('February 29 anniversary is explicitly February 28', addOneCalendarYear('2024-02-29') === '2025-02-28');
  check('cap-year offsets cross July boundaries', capYearOffset('2025-06-30', '2025-07-01') === 1);

  const f = fixture(15, 15);
  check('no qualifying cuts means zero dead money', computeDeadMoney(f.world, f.aId) === 0);
  const base = { type: 'cut' as const, fromTeamId: f.aId, season: f.world.season.seasonId };
  const cuts: CutEntry[] = [
    { ...base, seq: 1, date: '2025-10-20', playerId: 'legacy', contractAtCut: { type: 'veteran', salarySchedule: [7, 9], noTradeClause: false } },
    { ...base, seq: 0, date: '2025-10-20', playerId: 'no-snapshot' },
    { ...base, seq: 2, date: '2025-10-20', playerId: 'stretched', stretchApplied: true, contractAtCut: { type: 'veteran', salarySchedule: [5, 10], noTradeClause: false } },
    { ...base, seq: 3, date: '2025-10-20', playerId: 'two-way', contractAtCut: { type: 'two_way', salarySchedule: [99], noTradeClause: false } },
  ];
  f.world.season.transactionLog = [...cuts].reverse();
  check('unstretched non-flat schedule uses current cap-year amount', close(computeDeadMoney(f.world, f.aId), 7 + 3));
  check('next cap year uses next schedule amount plus stretched share', close(computeDeadMoney(f.world, f.aId, '2026-10-20'), 9 + 3));
  check('stretch runs exactly 2n+1 years', close(computeDeadMoney(f.world, f.aId, '2029-10-20'), 3) && computeDeadMoney(f.world, f.aId, '2030-10-20') === 0);
  const dead = computeDeadMoney(f.world, f.aId);
  check('cap, tax, and apron bases add dead money without collapsing holds/charges',
    close(computeTaxPayroll(f.world, f.aId), computeTeamPayroll(f.world, f.aId) + dead) &&
    close(computeApronPayroll(f.world, f.aId), computeTeamPayroll(f.world, f.aId) + dead) &&
    computeCapRoomSalary(f.world, f.aId) >= computeTaxPayroll(f.world, f.aId));
  check('trade and signing projections carry dead money',
    close(projectPostTradeApronPayroll(f.world, f.aId, [], []), computeApronPayroll(f.world, f.aId)) &&
    close(projectPostTradeCapRoomSalary(f.world, f.aId, [], []), computeCapRoomSalary(f.world, f.aId)));
  const signing = fixture(14, 14, 1);
  const signingWithoutDead = structuredClone(signing.world);
  signing.world.season.transactionLog.push({
    ...base, seq: 0, date: '2025-10-20', playerId: 'signing-dead',
    contractAtCut: { type: 'veteran', salarySchedule: [6], noTradeClause: false },
  });
  check('signing cap-room and apron projections add the same derived dead money',
    close(
      projectPostSigningCapRoomSalary(signing.world, signing.aId, signing.fa[0]) -
      projectPostSigningCapRoomSalary(signingWithoutDead, signing.aId, signing.fa[0]),
      6,
    ) && close(
      projectPostSigningApronPayroll(signing.world, signing.aId, signing.fa[0]) -
      projectPostSigningApronPayroll(signingWithoutDead, signing.aId, signing.fa[0]),
      6,
    ));

  const cut = fixture(15, 15);
  const cutResult = applyCut(cut.world, { teamId: cut.aId, playerId: cut.a[0], stretch: true });
  check('successful stretch election is recorded only on the new cut', cutResult.ok && cutResult.entry.type === 'cut' && cutResult.entry.stretchApplied === true);
  const twoWay = fixture(15, 15);
  player(twoWay.world, twoWay.a[0]).contract.type = 'two_way';
  const before = snap(twoWay.world);
  const rejected = applyCut(twoWay.world, { teamId: twoWay.aId, playerId: twoWay.a[0], stretch: true });
  check('two-way stretch is explicitly rejected atomically', !rejected.ok && /two-way/.test(rejected.reason) && snap(twoWay.world) === before);
}

function bankedTpeWorld(): { result: Extract<ReturnType<typeof applyTrade>, { ok: true }>; f: Fixture } {
  const f = fixture(15, 15);
  setPayroll(f.world, f.aId, 160, { [f.a[0]]: 10 });
  setPayroll(f.world, f.bId, 140, { [f.b[0]]: 5 });
  const result = applyTrade(f.world, buildPlayerTrade(f.aId, f.bId, [f.a[0]], [f.b[0]]));
  if (!result.ok) throw new Error(result.reason);
  return { result, f };
}

function testTradeExceptions(): void {
  console.log('\nB. Banked Standard TPEs');
  const { result, f } = bankedTpeWorld();
  const grants = result.world.season.tradeExceptions;
  check('standard trade banks deterministic residual and source-player ID',
    grants.length === 1 && grants[0].sourcePlayerId === f.a[0] &&
    grants[0].id === `tpe_0_${f.aId}_${f.a[0]}` && close(grants[0].amount, 5.25));
  check('grant ID is recorded on the immutable trade entry', result.entry.type === 'trade' && result.entry.createdTradeExceptionIds?.[0] === grants[0].id);
  check('room-side plan creates no banked TPE', !grants.some((grant) => grant.teamId === f.bId));
  check('active query derives full balance', getActiveTradeExceptions(result.world, f.aId).length === 1 && computeTradeExceptionUsed(result.world, grants[0].id) === 0);

  const above = fixture();
  setPayroll(above.world, above.aId, FIRST_APRON + 1, { [above.a[0]]: 10 });
  setSalary(above.world, above.b[0], 10);
  const abovePlan = analyzeTradeMatchingForTeam(above.world, above.aId, [above.a[0]], [above.b[0]]);
  check('allowance is zero above first apron', abovePlan.ok && close(abovePlan.plan.maximumIncomingSalary, 10));

  const aggregate = fixture(15, 14);
  setPayroll(aggregate.world, aggregate.aId, 160, { [aggregate.a[0]]: 5, [aggregate.a[1]]: 5 });
  setSalary(aggregate.world, aggregate.b[0], 10.25);
  const aggregateResult = applyTrade(aggregate.world, buildPlayerTrade(aggregate.aId, aggregate.bId, [aggregate.a[0], aggregate.a[1]], [aggregate.b[0]]));
  check('aggregated plan creates no banked TPE', aggregateResult.ok && aggregateResult.world.season.tradeExceptions.length === 0);

  const useWorld = structuredClone(result.world);
  const ownedByB = f.a[0];
  const ownedByA = f.b[0];
  setSalary(useWorld, ownedByB, 4);
  setSalary(useWorld, ownedByA, 5);
  setPayroll(useWorld, f.bId, 140, { [ownedByB]: 4 });
  const use = applyTrade(
    useWorld,
    buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]),
    { tpeUsages: [{ teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB }] },
  );
  check('one player is absorbed while ordinary matching handles the remainder', use.ok);
  if (use.ok) {
    check('usage is append-only and remaining balance is derived',
      close(computeTradeExceptionUsed(use.world, grants[0].id), 4) &&
      close(computeTradeExceptionRemaining(use.world, grants[0].id), 1.25));
    check('same-cap-year TPE use does not itself trigger a hard cap', !team(use.world, f.aId).hardCappedAtApron);
  }

  const duplicateBefore = snap(useWorld);
  const duplicate = applyTrade(useWorld, buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]), {
    tpeUsages: [
      { teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB },
      { teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB },
    ],
  });
  check('duplicate allocation and two uses of one TPE reject atomically', !duplicate.ok && snap(useWorld) === duplicateBefore);

  const insufficientWorld = structuredClone(useWorld);
  setSalary(insufficientWorld, ownedByB, grants[0].amount + 0.001);
  const insufficientBefore = snap(insufficientWorld);
  const insufficient = applyTrade(insufficientWorld, buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]), {
    tpeUsages: [{ teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB }],
  });
  check('insufficient balance rejects without consuming the ledger', !insufficient.ok && snap(insufficientWorld) === insufficientBefore);

  for (const [label, usage] of [
    ['wrong team', { teamId: f.bId, tpeId: grants[0].id, incomingPlayerId: ownedByB }],
    ['unknown ID', { teamId: f.aId, tpeId: 'missing', incomingPlayerId: ownedByB }],
    ['non-incoming player', { teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByA }],
  ] as const) {
    const before = snap(useWorld);
    const rejected = applyTrade(useWorld, buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]), { tpeUsages: [usage] });
    check(`${label} TPE allocation rejects atomically`, !rejected.ok && snap(useWorld) === before);
  }
  const expired = structuredClone(result.world);
  expired.season.currentDate = grants[0].expiresDate;
  check('expiry is strict and does not delete grant history', getActiveTradeExceptions(expired, f.aId).length === 0 && expired.season.tradeExceptions.length === 1);
  const expiredBefore = snap(expired);
  const expiredUse = applyTrade(expired, buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]), {
    tpeUsages: [{ teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB }],
  });
  check('expired allocation rejects atomically', !expiredUse.ok && snap(expired) === expiredBefore);

  const exhaustedWorld = structuredClone(useWorld);
  exhaustedWorld.season.tradeExceptions[0].amount = 4;
  const exhausted = applyTrade(exhaustedWorld, buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]), {
    tpeUsages: [{ teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB }],
  });
  check('exact use exhausts the derived balance and removes it from active queries',
    exhausted.ok && close(computeTradeExceptionRemaining(exhausted.world, grants[0].id), 0) &&
    !getActiveTradeExceptions(exhausted.world, f.aId).some((grant) => grant.id === grants[0].id));

  const multi = fixture(15, 14);
  setPayroll(multi.world, multi.aId, 160, { [multi.a[0]]: 10, [multi.a[1]]: 10 });
  setPayroll(multi.world, multi.bId, 139, { [multi.b[0]]: 5 });
  const multiResult = applyTrade(multi.world, buildPlayerTrade(multi.aId, multi.bId, [multi.a[1], multi.a[0]], [multi.b[0]]));
  const expectedSource = [multi.a[0], multi.a[1]].sort()[0];
  check('multi-outgoing Standard plan chooses highest salary with stable ID tie-break',
    multiResult.ok && multiResult.world.season.tradeExceptions[0]?.sourcePlayerId === expectedSource);

  const expanded = fixture();
  setPayroll(expanded.world, expanded.aId, 160, { [expanded.a[0]]: 10 });
  setPayroll(expanded.world, expanded.bId, 140, { [expanded.b[0]]: 18 });
  const expandedResult = applyTrade(expanded.world, buildPlayerTrade(expanded.aId, expanded.bId, [expanded.a[0]], [expanded.b[0]]));
  check('Expanded plan does not bank a Standard TPE for its user',
    expandedResult.ok && !expandedResult.world.season.tradeExceptions.some((grant) => grant.teamId === expanded.aId));

  const prior = structuredClone(result.world);
  prior.season.currentDate = '2026-10-20';
  prior.season.markers = [{ type: 'trade_deadline', date: '2027-02-05', label: 'Trade Deadline' }];
  prior.season.tradeExceptions[0].expiresDate = '2027-01-01';
  setSalary(prior, ownedByB, 4); setSalary(prior, ownedByA, 5); setPayroll(prior, f.bId, 140, { [ownedByB]: 4 });
  const priorUse = applyTrade(prior, buildPlayerTrade(f.aId, f.bId, [ownedByA], [ownedByB]), {
    tpeUsages: [{ teamId: f.aId, tpeId: grants[0].id, incomingPlayerId: ownedByB }],
  });
  check('prior-cap-year TPE use triggers a first-apron hard cap regardless of tax status',
    priorUse.ok && team(priorUse.world, f.aId).hardCappedAtApron === 'first_apron');
}

function exceptionFixture(playersToSign = 2): Fixture {
  const f = fixture(13, 14, playersToSign, 12);
  setPayroll(f.world, f.aId, 160);
  return f;
}

function testSigningExceptions(): void {
  console.log('\nC. MLE / Room MLE / BAE signings');
  const f = exceptionFixture(3);
  setDesired(f.world, f.fa[0], 5, 4);
  const ntmle = applySignFreeAgent(f.world, { teamId: f.aId, playerId: f.fa[0], exception: 'non_taxpayer_mle' });
  check('NTMLE exact term is legal and triggers first-apron hard cap',
    ntmle.ok && team(ntmle.world, f.aId).hardCappedAtApron === 'first_apron' && ntmle.entry.type === 'sign' && ntmle.entry.signingMechanism === 'non_taxpayer_mle');
  if (!ntmle.ok) return;
  const availableAfter = getAvailableSigningExceptions(f.aId, ntmle.world);
  check('split usage is derived from sign entries and NTMLE may coexist with BAE',
    close(availableAfter.find((x) => x.type === 'non_taxpayer_mle')!.remainingAmount, NON_TAXPAYER_MLE - 5) &&
    availableAfter.some((x) => x.type === 'bae') && !availableAfter.some((x) => x.type === 'taxpayer_mle'));
  check('exception usage is isolated per team',
    close(getAvailableSigningExceptions(f.bId, ntmle.world).find((x) => x.type === 'non_taxpayer_mle')!.remainingAmount, NON_TAXPAYER_MLE));
  setDesired(ntmle.world, f.fa[1], BI_ANNUAL_EXCEPTION, 2);
  const bae = applySignFreeAgent(ntmle.world, { teamId: f.aId, playerId: f.fa[1], exception: 'bae' });
  check('BAE exact amount/term boundary succeeds without weakening hard cap',
    bae.ok && team(bae.world, f.aId).hardCappedAtApron === 'first_apron');

  const tmle = exceptionFixture(1);
  setDesired(tmle.world, tmle.fa[0], 5, 2);
  const tmleResult = applySignFreeAgent(tmle.world, { teamId: tmle.aId, playerId: tmle.fa[0], exception: 'taxpayer_mle' });
  check('TMLE triggers a second-apron hard cap', tmleResult.ok && team(tmleResult.world, tmle.aId).hardCappedAtApron === 'second_apron');

  const room = exceptionFixture(1);
  room.world.season.teamExceptionStates = [{ teamId: room.aId, capYear: 2025, operatedUnderCap: true }];
  const roomAvailable = getAvailableSigningExceptions(room.aId, room.world);
  check('operated-under-cap history offers only Room MLE after payroll rises',
    roomAvailable.length === 1 && roomAvailable[0].type === 'room_mle' && close(roomAvailable[0].remainingAmount, ROOM_MLE));
  setDesired(room.world, room.fa[0], ROOM_MLE, 3);
  const roomSigning = applySignFreeAgent(room.world, { teamId: room.aId, playerId: room.fa[0], exception: 'room_mle' });
  check('Room MLE exact amount/term succeeds without a new hard cap', roomSigning.ok && !team(roomSigning.world, room.aId).hardCappedAtApron);

  const capRoom = fixture(14, 14, 1, 5);
  check('positive cap room must be used before an MLE/BAE', getAvailableSigningExceptions(capRoom.aId, capRoom.world).length === 0);
  setDesired(capRoom.world, capRoom.fa[0], 5, 1);
  const ordinary = applySignFreeAgent(capRoom.world, { teamId: capRoom.aId, playerId: capRoom.fa[0] });
  check('no explicit exception preserves Phase 4 room analysis and records mechanism', ordinary.ok && ordinary.entry.type === 'sign' && ordinary.entry.signingMechanism === 'room');

  const priorBae = exceptionFixture(1);
  priorBae.world.season.transactionLog.push({
    type: 'sign', seq: 0, date: '2024-10-20', season: 'prior', playerId: 'old', toTeamId: priorBae.aId,
    signingMechanism: 'bae', contractSigned: { type: 'veteran', salarySchedule: [4], noTradeClause: false },
  } as SignEntry);
  check('BAE is unavailable in consecutive cap years', !getAvailableSigningExceptions(priorBae.aId, priorBae.world).some((x) => x.type === 'bae'));

  const failed = exceptionFixture(1);
  setDesired(failed.world, failed.fa[0], NON_TAXPAYER_MLE + 0.001, 4);
  const before = snap(failed.world);
  const rejected = applySignFreeAgent(failed.world, { teamId: failed.aId, playerId: failed.fa[0], exception: 'non_taxpayer_mle' });
  check('failed exception signing consumes nothing and sets no hard-cap/event state', !rejected.ok && snap(failed.world) === before);

  const hardCapFailure = exceptionFixture(1);
  setPayroll(hardCapFailure.world, hardCapFailure.aId, FIRST_APRON - 1);
  setDesired(hardCapFailure.world, hardCapFailure.fa[0], 2, 1);
  const hardBefore = snap(hardCapFailure.world);
  const hardRejected = applySignFreeAgent(hardCapFailure.world, { teamId: hardCapFailure.aId, playerId: hardCapFailure.fa[0], exception: 'non_taxpayer_mle' });
  check('new exception hard-cap trigger validates projected Team Salary before mutation', !hardRejected.ok && snap(hardCapFailure.world) === hardBefore);
}

function testRollover(): void {
  console.log('\nD. Pure contract rollover seam');
  const f = fixture(15, 15);
  const [continues, futureOption, playerExercise, teamDecline, natural, playerEqual, teamEqual] = f.a.slice(0, 7);
  player(f.world, continues).contract = { type: 'veteran', salarySchedule: [10, 11], noTradeClause: false };
  player(f.world, futureOption).contract = { type: 'veteran', salarySchedule: [10, 11, 12], noTradeClause: false, option: { type: 'team', year: 2 } };
  player(f.world, playerExercise).contract = { type: 'veteran', salarySchedule: [10, 100], noTradeClause: false, option: { type: 'player', year: 1 } };
  player(f.world, teamDecline).contract = { type: 'veteran', salarySchedule: [10, 100], noTradeClause: false, option: { type: 'team', year: 1 } };
  player(f.world, natural).contract = { type: 'veteran', salarySchedule: [7], noTradeClause: false };
  const playerEqualMarket = generateDesiredContract(player(f.world, playerEqual)).desiredSalary;
  player(f.world, playerEqual).contract = { type: 'veteran', salarySchedule: [10, playerEqualMarket], noTradeClause: false, option: { type: 'player', year: 1 } };
  const teamEqualMarket = generateDesiredContract(player(f.world, teamEqual)).desiredSalary;
  player(f.world, teamEqual).contract = { type: 'veteran', salarySchedule: [10, teamEqualMarket], noTradeClause: false, option: { type: 'team', year: 1 } };
  f.world.season.transactionLog.push({ type: 'cut', seq: 0, date: '2025-10-01', season: 'old', playerId: 'historic', fromTeamId: f.aId });
  f.world.season.tradeExceptions.push({ id: 'historic-tpe', teamId: f.aId, sourceTradeSeq: 0, sourcePlayerId: 'x', amount: 1, createdDate: '2025-01-01', expiresDate: '2026-01-01', createdSeason: 'old' });
  f.world.season.teamExceptionStates.push({ teamId: f.aId, capYear: 2025, operatedUnderCap: true });
  team(f.world, f.aId).hardCappedAtApron = 'first_apron';
  const next = createSeasonState(f.world.teams, f.world.players, { seed: 2, seasonId: 'next', startDate: '2026-10-21' });
  const before = snap(f.world);
  const rolled = processContractRollover(f.world, next);
  check('rollover leaves both inputs byte-identical', snap(f.world) === before && next.transactionLog.length === 0);
  check('ordinary schedule shifts exactly once', snap(player(rolled, continues).contract.salarySchedule) === '[11]');
  check('future option index decrements without early resolution', player(rolled, futureOption).contract.option?.year === 1);
  check('due player option exercises at favorable salary', player(rolled, playerExercise).contract.salarySchedule[0] === 100 && !player(rolled, playerExercise).contract.option);
  check('option equality exercises for both player and team options',
    player(rolled, playerEqual).teamId === f.aId && player(rolled, teamEqual).teamId === f.aId);
  check('due team option declines and emits one event',
    player(rolled, teamDecline).teamId === FREE_AGENT_TEAM_ID &&
    rolled.season.transactionLog.filter((entry) => 'playerId' in entry && entry.playerId === teamDecline).filter((entry) => entry.type === 'option_declined').length === 1 &&
    !rolled.season.transactionLog.some((entry) => entry.type === 'contract_expired' && entry.playerId === teamDecline));
  check('natural expiration becomes a signable FA with rights',
    rolled.season.freeAgentPool.includes(natural) && player(rolled, natural).desiredContract !== undefined && player(rolled, natural).birdRights?.teamId === f.aId);
  const lifecycle = rolled.season.transactionLog.slice(1);
  const lifecyclePlayerIds = lifecycle.map((entry) => 'playerId' in entry ? entry.playerId : '');
  check('rollover events are stable by player ID', lifecyclePlayerIds.every((id, i) => i === 0 || lifecyclePlayerIds[i - 1].localeCompare(id) <= 0));
  check('old log, TPE grants, and exception history survive while hard caps reset',
    rolled.season.transactionLog[0].type === 'cut' && rolled.season.tradeExceptions[0].id === 'historic-tpe' &&
    rolled.season.teamExceptionStates.length === 1 && rolled.teams.every((candidate) => !candidate.hardCappedAtApron));
  check('expired TPE remains history but is inactive', getActiveTradeExceptions(rolled, f.aId).length === 0 && rolled.season.tradeExceptions.length === 1);
  let rejected = false;
  try { processContractRollover(rolled, next); } catch { rejected = true; }
  check('accidental second rollover of the same boundary is rejected', rejected);
}

function testMigration(): void {
  console.log('\nE. Schema v5 migration');
  const f = fixture(15, 15);
  const oldCut: CutEntry = { type: 'cut', seq: 0, date: f.world.season.currentDate, season: f.world.season.seasonId, playerId: f.a[0], fromTeamId: f.aId, contractAtCut: { type: 'veteran', salarySchedule: [8], noTradeClause: false } };
  f.world.season.transactionLog = [oldCut];
  const v4Season = structuredClone(f.world.season) as unknown as Record<string, unknown>;
  delete v4Season.tradeExceptions; delete v4Season.teamExceptionStates;
  const now = new Date(0).toISOString();
  const v4 = { schemaVersion: 4, phase: derivePhase(f.world.season), season: v4Season, teams: f.world.teams, players: f.world.players, createdAt: now, updatedAt: now } as unknown as SaveFile;
  const logBefore = snap(v4.season.transactionLog);
  const migrated = migrateSaveFile(v4);
  check('v4 loads to v5 with empty new ledgers', migrated.ok && migrated.file.schemaVersion === 5 && migrated.file.season.tradeExceptions.length === 0 && migrated.file.season.teamExceptionStates.length === 0);
  if (!migrated.ok) return;
  check('old cut remains byte-identical and contributes dead money', snap(migrated.file.season.transactionLog) === logBefore && close(computeDeadMoney(migrated.file, f.aId), 8));
  const roundTrip = JSON.parse(JSON.stringify(migrated.file)) as SaveFile;
  const again = migrateSaveFile(roundTrip);
  check('migration run twice and fresh v5 round-trip are byte-identical', again.ok && !again.migrated && snap(again.file) === snap(roundTrip) && SAVE_SCHEMA_VERSION === 5);
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  sourceTeams = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf8'));
  sourcePlayers = JSON.parse(await readFile(path.join(dataDir, 'players.json'), 'utf8'));
  testDatesAndDeadMoney();
  testTradeExceptions();
  testSigningExceptions();
  testRollover();
  testMigration();
  console.log(`\n${failures === 0 ? 'PASS — all Phase 5a checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((error) => { console.error(error); process.exit(1); });
