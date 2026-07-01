/** Focused executable acceptance harness for transactions Phase 5b. */
import { readFile } from 'fs/promises';
import path from 'path';
import { createSeasonState } from '../src/engine/season';
import { Player, ContractType, ReSigningRightsType } from '../src/models/player';
import { Team } from '../src/models/team';
import { SignAndTradeEntry, SignEntry, TradeAsset } from '../src/models/transaction';
import {
  applySignAndTrade,
  applyTrade,
  buildPlayerTrade,
  computeCapHolds,
  computeDeadMoney,
  computeTradeExceptionRemaining,
  FIRST_APRON,
  FREE_AGENT_TEAM_ID,
  maximumSalaryForRights,
  ROSTER_MAX,
  ROSTER_MIN,
  RosterWorld,
  SECOND_APRON,
  SIGN_AND_TRADE_MAX_YEARS,
  SIGN_AND_TRADE_MIN_YEARS,
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
function playerAsset(playerId: string): TradeAsset { return { kind: 'player', playerId }; }

interface Fixture {
  world: RosterWorld;
  aId: string;
  bId: string;
  a: string[];
  b: string[];
  fa: string[];
}

function fixture(aCount = 14, bCount = 14, faCount = 1, salary = 10): Fixture {
  const teamA = structuredClone(sourceTeams[0]);
  const teamB = structuredClone(sourceTeams[1]);
  const selected = sourcePlayers
    .slice(0, aCount + bCount + faCount)
    .map((candidate) => structuredClone(candidate));
  const a = selected.slice(0, aCount).map((candidate) => candidate.id);
  const b = selected.slice(aCount, aCount + bCount).map((candidate) => candidate.id);
  const fa = selected.slice(aCount + bCount).map((candidate) => candidate.id);
  teamA.roster = [...a];
  teamB.roster = [...b];
  delete teamA.hardCappedAtApron;
  delete teamB.hardCappedAtApron;

  for (const candidate of selected) {
    candidate.teamId = a.includes(candidate.id)
      ? teamA.id
      : b.includes(candidate.id)
        ? teamB.id
        : FREE_AGENT_TEAM_ID;
    candidate.contract = {
      type: 'veteran',
      salarySchedule: [salary],
      noTradeClause: false,
    };
    if (fa.includes(candidate.id)) {
      candidate.desiredContract = {
        type: 'veteran',
        desiredSalary: salary,
        desiredYears: SIGN_AND_TRADE_MIN_YEARS,
      };
      candidate.birdRights = { teamId: teamA.id, type: 'bird' };
    } else {
      delete candidate.desiredContract;
      delete candidate.birdRights;
    }
  }

  const season = createSeasonState([teamA, teamB], selected, {
    seed: 1,
    startDate: '2025-10-21',
  });
  season.currentDate = '2025-10-20';
  season.markers = season.markers.filter((marker) => marker.type !== 'trade_deadline');
  season.markers.push({
    type: 'trade_deadline',
    date: '2026-02-05',
    label: 'Trade Deadline',
  });
  season.freeAgentPool = [...fa];
  season.transactionLog = [];
  season.tradeExceptions = [];
  season.teamExceptionStates = [];
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

/** Works across and above both apron levels; overrides make boundary fixtures exact. */
function setPayroll(
  world: RosterWorld,
  teamId: string,
  total: number,
  overrides: Record<string, number> = {},
): void {
  const ids = team(world, teamId).roster;
  const remainderIds = ids.filter((id) => !(id in overrides));
  const fixed = Object.values(overrides).reduce((sum, salary) => sum + salary, 0);
  const remainder = remainderIds.length ? (total - fixed) / remainderIds.length : 0;
  for (const id of ids) setContract(world, id, overrides[id] ?? remainder);
}

function setDesired(
  world: RosterWorld,
  id: string,
  salary: number,
  years: number,
  type: ContractType = 'veteran',
  rightsType: ReSigningRightsType = 'bird',
  rightsTeamId?: string,
): void {
  const candidate = player(world, id);
  candidate.desiredContract = { type, desiredSalary: salary, desiredYears: years };
  candidate.birdRights = { teamId: rightsTeamId ?? world.teams[0].id, type: rightsType };
}

function defaultOp(f: Fixture) {
  return {
    signingTeamId: f.aId,
    receivingTeamId: f.bId,
    playerId: f.fa[0],
    assetsFromReceiving: [playerAsset(f.b[0])],
  };
}

function testHappyPaths(): void {
  console.log('\nA. Happy paths and shadow-roster composition');

  const room = fixture();
  setPayroll(room.world, room.aId, 120, { [room.a[0]]: 5 });
  setPayroll(room.world, room.bId, 120, { [room.b[0]]: 5 });
  setDesired(room.world, room.fa[0], 5, 3);
  const roomResult = applySignAndTrade(room.world, defaultOp(room));
  check('cap-room receiver completes S&T and becomes first-apron hard-capped',
    roomResult.ok &&
    team(roomResult.world, room.bId).hardCappedAtApron === 'first_apron' &&
    player(roomResult.world, room.fa[0]).teamId === room.bId);
  check('successful S&T removes player from FA pool and signing-team cap holds',
    roomResult.ok && !roomResult.world.season.freeAgentPool.includes(room.fa[0]) &&
    computeCapHolds(roomResult.world, room.aId) === 0);

  const overCap = fixture();
  setPayroll(overCap.world, overCap.aId, 160, { [overCap.a[0]]: 10 });
  setPayroll(overCap.world, overCap.bId, 160, { [overCap.b[0]]: 10 });
  const overCapResult = applySignAndTrade(overCap.world, defaultOp(overCap));
  check('over-cap receiver succeeds through ordinary matching', overCapResult.ok);

  const multi = fixture(15, 14);
  const multiOp = {
    ...defaultOp(multi),
    additionalAssetsFromSigning: [playerAsset(multi.a[0])],
    assetsFromReceiving: [playerAsset(multi.b[0])],
  };
  const multiResult = applySignAndTrade(multi.world, multiOp);
  check('additional signing-team and return assets all move in one atomic operation',
    multiResult.ok &&
    team(multiResult.world, multi.bId).roster.includes(multi.fa[0]) &&
    team(multiResult.world, multi.bId).roster.includes(multi.a[0]) &&
    team(multiResult.world, multi.aId).roster.includes(multi.b[0]));

  const early = fixture();
  player(early.world, early.fa[0]).experience = 5;
  setContract(early.world, early.fa[0], 5);
  const earlyMaximum = maximumSalaryForRights('early_bird', 5, 5);
  setDesired(early.world, early.fa[0], earlyMaximum, 3, 'veteran', 'early_bird');
  setContract(early.world, early.b[0], earlyMaximum);
  const earlyResult = applySignAndTrade(early.world, defaultOp(early));
  check('Early Bird three-year S&T succeeds at the exact rights maximum',
    earlyResult.ok && (earlyResult.entry as SignAndTradeEntry).rightsType === 'early_bird');

  const richSender = fixture();
  setPayroll(richSender.world, richSender.aId, SECOND_APRON + 5, {
    [richSender.a[0]]: 10,
  });
  setPayroll(richSender.world, richSender.bId, 140, { [richSender.b[0]]: 10 });
  const richSenderResult = applySignAndTrade(richSender.world, defaultOp(richSender));
  check('signing team above second apron may complete a non-aggregated S&T',
    richSenderResult.ok);

  const temporarySixteen = fixture(ROSTER_MAX, ROSTER_MIN);
  const temporaryResult = applySignAndTrade(temporarySixteen.world, {
    ...defaultOp(temporarySixteen),
    additionalAssetsFromSigning: [playerAsset(temporarySixteen.a[0])],
  });
  check('signing team may temporarily reach 16 in shadow when final roster is 15',
    temporaryResult.ok &&
    team(temporaryResult.world, temporarySixteen.aId).roster.length === ROSTER_MAX &&
    team(temporaryResult.world, temporarySixteen.bId).roster.length === ROSTER_MAX);
}

function testEligibilityAndAtomicity(): void {
  console.log('\nB. Eligibility and atomic rejection');

  for (const [label, mutate, reason] of [
    ['missing rights', (f: Fixture) => { delete player(f.world, f.fa[0]).birdRights; }, /Bird or Early Bird/],
    ['wrong-team rights', (f: Fixture) => { player(f.world, f.fa[0]).birdRights!.teamId = f.bId; }, /Bird or Early Bird/],
    ['non-Bird rights', (f: Fixture) => { player(f.world, f.fa[0]).birdRights!.type = 'non_bird'; }, /Bird or Early Bird/],
  ] as const) {
    const f = fixture();
    mutate(f);
    const before = snap(f.world);
    const result = applySignAndTrade(f.world, defaultOp(f));
    check(`${label} rejects clearly and byte-identically`,
      !result.ok && reason.test(result.reason) && snap(f.world) === before);
  }

  for (const years of [2, 5]) {
    const f = fixture();
    setDesired(f.world, f.fa[0], 10, years);
    const before = snap(f.world);
    const result = applySignAndTrade(f.world, defaultOp(f));
    check(`${years}-year S&T contract rejects atomically`,
      !result.ok && /must cover 3 or 4 years/.test(result.reason) && snap(f.world) === before);
  }
  const twoWay = fixture();
  setDesired(twoWay.world, twoWay.fa[0], 1, 3, 'two_way');
  check('two-way S&T is explicitly rejected',
    !applySignAndTrade(twoWay.world, defaultOp(twoWay)).ok);

  const high = fixture();
  player(high.world, high.fa[0]).experience = 5;
  const maximum = maximumSalaryForRights('bird', 5, 10);
  setDesired(high.world, high.fa[0], maximum + 0.001, 3);
  const highBefore = snap(high.world);
  const highResult = applySignAndTrade(high.world, defaultOp(high));
  check('salary above the retained-contract rights maximum rejects atomically',
    !highResult.ok && /at most/.test(highResult.reason) && snap(high.world) === highBefore);

  for (const [label, mutate] of [
    ['missing pool membership', (f: Fixture) => { f.world.season.freeAgentPool = []; }],
    ['stale teamId', (f: Fixture) => { player(f.world, f.fa[0]).teamId = f.aId; }],
    ['still rostered', (f: Fixture) => { team(f.world, f.aId).roster.push(f.fa[0]); }],
  ] as const) {
    const f = fixture();
    mutate(f);
    const before = snap(f.world);
    const result = applySignAndTrade(f.world, defaultOp(f));
    check(`noncanonical FA state (${label}) rejects byte-identically`,
      !result.ok && snap(f.world) === before);
  }

  for (const [label, op] of [
    ['S&T player repeated in additional assets', (f: Fixture) => ({
      ...defaultOp(f), additionalAssetsFromSigning: [playerAsset(f.fa[0])],
    })],
    ['return player repeated in additional assets', (f: Fixture) => ({
      ...defaultOp(f), additionalAssetsFromSigning: [playerAsset(f.b[0])],
    })],
    ['duplicate return asset', (f: Fixture) => ({
      ...defaultOp(f), assetsFromReceiving: [playerAsset(f.b[0]), playerAsset(f.b[0])],
    })],
  ] as const) {
    const f = fixture();
    const before = snap(f.world);
    const result = applySignAndTrade(f.world, op(f));
    check(`${label} rejects before shadow mutation`,
      !result.ok && /more than once/.test(result.reason) && snap(f.world) === before);
  }

  const closed = fixture();
  closed.world.season.currentDate = '2026-02-06';
  const closedBefore = snap(closed.world);
  const closedResult = applySignAndTrade(closed.world, defaultOp(closed));
  check('closed trade window rejects byte-identically',
    !closedResult.ok && /trading closed/.test(closedResult.reason) &&
    snap(closed.world) === closedBefore);

  const floor = fixture(ROSTER_MIN, ROSTER_MIN);
  const floorResult = applySignAndTrade(floor.world, {
    signingTeamId: floor.aId,
    receivingTeamId: floor.bId,
    playerId: floor.fa[0],
    additionalAssetsFromSigning: [playerAsset(floor.a[0])],
  });
  check('final standard-roster floor violation rejects',
    !floorResult.ok && /under the 14-man/.test(floorResult.reason));
  const ceiling = fixture(ROSTER_MIN, ROSTER_MAX);
  const ceilingResult = applySignAndTrade(ceiling.world, {
    signingTeamId: ceiling.aId,
    receivingTeamId: ceiling.bId,
    playerId: ceiling.fa[0],
  });
  check('final standard-roster ceiling violation rejects',
    !ceilingResult.ok && /over the 15-man/.test(ceilingResult.reason));

  const ntcSigning = fixture(15, 14);
  player(ntcSigning.world, ntcSigning.a[0]).contract.noTradeClause = true;
  const signingNtcResult = applySignAndTrade(ntcSigning.world, {
    ...defaultOp(ntcSigning),
    additionalAssetsFromSigning: [playerAsset(ntcSigning.a[0])],
    controlledTeamId: ntcSigning.aId,
  });
  check('NTC blocks an ordinary asset leaving a controlled signing team',
    !signingNtcResult.ok && /no-trade clause/.test(signingNtcResult.reason));
  const ntcReceiving = fixture();
  player(ntcReceiving.world, ntcReceiving.b[0]).contract.noTradeClause = true;
  const receivingNtcResult = applySignAndTrade(ntcReceiving.world, {
    ...defaultOp(ntcReceiving), controlledTeamId: ntcReceiving.bId,
  });
  check('NTC blocks an ordinary asset leaving a controlled receiving team',
    !receivingNtcResult.ok && /no-trade clause/.test(receivingNtcResult.reason));
}

function testApronAndExceptionComposition(): void {
  console.log('\nC. Apron, taxpayer-MLE, and hard-cap composition');

  const boundary = fixture();
  setPayroll(boundary.world, boundary.aId, 160, { [boundary.a[0]]: 10 });
  setPayroll(boundary.world, boundary.bId, FIRST_APRON + 0.001, {
    [boundary.b[0]]: 10,
  });
  setDesired(boundary.world, boundary.fa[0], 10, 3);
  const boundaryBefore = snap(boundary.world);
  const above = applySignAndTrade(boundary.world, defaultOp(boundary));
  check('receiver just above first apron rejects on the S&T-specific predicate',
    !above.ok && /receive a sign-and-trade player above the first apron/.test(above.reason) &&
    snap(boundary.world) === boundaryBefore);
  setDesired(boundary.world, boundary.fa[0], 9.999, 3);
  const atApron = applySignAndTrade(boundary.world, defaultOp(boundary));
  check('same structure succeeds after only contract salary crosses to first apron', atApron.ok);

  const tmle = fixture();
  tmle.world.season.transactionLog.push({
    type: 'sign', seq: 0, date: tmle.world.season.currentDate,
    season: tmle.world.season.seasonId, playerId: 'historic-tmle',
    toTeamId: tmle.bId, signingMechanism: 'taxpayer_mle',
    contractSigned: { type: 'veteran', salarySchedule: [1], noTradeClause: false },
  } as SignEntry);
  const tmleResult = applySignAndTrade(tmle.world, defaultOp(tmle));
  check('same-cap-year taxpayer-MLE use blocks receiver even below first apron',
    !tmleResult.ok && /taxpayer MLE/.test(tmleResult.reason));
  const priorTmle = fixture();
  priorTmle.world.season.transactionLog.push({
    type: 'sign', seq: 0, date: '2024-10-20', season: '2024-25',
    playerId: 'historic-tmle', toTeamId: priorTmle.bId,
    signingMechanism: 'taxpayer_mle',
    contractSigned: { type: 'veteran', salarySchedule: [1], noTradeClause: false },
  } as SignEntry);
  check('prior-cap-year taxpayer-MLE use does not block S&T',
    applySignAndTrade(priorTmle.world, defaultOp(priorTmle)).ok);

  const monotonic = fixture();
  team(monotonic.world, monotonic.bId).hardCappedAtApron = 'first_apron';
  const monotonicResult = applySignAndTrade(monotonic.world, defaultOp(monotonic));
  check('receiver first-apron hard cap is set and can never be weakened',
    monotonicResult.ok &&
    team(monotonicResult.world, monotonic.bId).hardCappedAtApron === 'first_apron');

  const existingSenderCap = fixture();
  team(existingSenderCap.world, existingSenderCap.aId).hardCappedAtApron = 'first_apron';
  setPayroll(existingSenderCap.world, existingSenderCap.aId, FIRST_APRON + 1, {
    [existingSenderCap.a[0]]: 10,
  });
  setPayroll(existingSenderCap.world, existingSenderCap.bId, 140, {
    [existingSenderCap.b[0]]: 10,
  });
  const senderCapBefore = snap(existingSenderCap.world);
  const senderCapResult = applySignAndTrade(existingSenderCap.world, defaultOp(existingSenderCap));
  check('existing signing-team hard cap is still enforced atomically',
    !senderCapResult.ok && /hard cap/.test(senderCapResult.reason) &&
    snap(existingSenderCap.world) === senderCapBefore);

  const aggregate = fixture(15, 14);
  setPayroll(aggregate.world, aggregate.aId, 160, { [aggregate.a[0]]: 5 });
  setPayroll(aggregate.world, aggregate.bId, 140, { [aggregate.b[0]]: 10.25 });
  setContract(aggregate.world, aggregate.fa[0], 5);
  setDesired(aggregate.world, aggregate.fa[0], 5, 3);
  const aggregateResult = applySignAndTrade(aggregate.world, {
    ...defaultOp(aggregate),
    additionalAssetsFromSigning: [playerAsset(aggregate.a[0])],
  });
  check('signing-team aggregated matching still triggers a second-apron hard cap',
    aggregateResult.ok &&
    team(aggregateResult.world, aggregate.aId).hardCappedAtApron === 'second_apron');
}

function testLogAndStateCorrectness(): void {
  console.log('\nD. Log, cloning, holds, and append-only state');
  const f = fixture(15, 14);
  const oldEntry = {
    type: 'cut' as const,
    seq: 0,
    date: f.world.season.currentDate,
    season: f.world.season.seasonId,
    playerId: 'historic-cut',
    fromTeamId: f.aId,
    contractAtCut: {
      type: 'veteran' as const,
      salarySchedule: [7],
      noTradeClause: false,
    },
  };
  f.world.season.transactionLog.push(oldEntry);
  const deadBefore = computeDeadMoney(f.world, f.aId);
  const priorLogBefore = snap(f.world.season.transactionLog);
  const additional = [playerAsset(f.a[0])];
  const receiving = [playerAsset(f.b[0])];
  const op = {
    signingTeamId: f.aId,
    receivingTeamId: f.bId,
    playerId: f.fa[0],
    additionalAssetsFromSigning: additional,
    assetsFromReceiving: receiving,
  };
  const result = applySignAndTrade(f.world, op);
  check('log/state fixture succeeds', result.ok);
  if (!result.ok) return;
  const entry = result.entry as SignAndTradeEntry;
  const stored = result.world.season.transactionLog.at(-1) as SignAndTradeEntry;
  check('entry is self-describing with seq, teams, assets, rights, and contract',
    entry.type === 'sign_and_trade' && entry.seq === 1 &&
    entry.playerId === f.fa[0] && entry.signingTeamId === f.aId &&
    entry.receivingTeamId === f.bId && entry.rightsType === 'bird' &&
    entry.additionalAssetsFromSigning.length === 1 &&
    entry.assetsFromReceiving.length === 1 &&
    entry.contractSigned.salarySchedule.length === 3);
  const signedPlayer = player(result.world, f.fa[0]);
  check('contract values are deep-equal but player/log/result objects do not alias',
    snap(signedPlayer.contract) === snap(entry.contractSigned) &&
    signedPlayer.contract !== entry.contractSigned &&
    stored.contractSigned !== entry.contractSigned &&
    stored.contractSigned !== signedPlayer.contract);
  const storedBeforeMutation = snap(result.world.season.transactionLog);
  additional.push(playerAsset(f.a[1]));
  receiving[0].playerId = f.b[1];
  entry.additionalAssetsFromSigning.push(playerAsset(f.a[2]));
  entry.contractSigned.salarySchedule[0] = 999;
  check('caller arrays and returned-entry mutation cannot rewrite stored log',
    snap(result.world.season.transactionLog) === storedBeforeMutation);
  check('old log entry remains byte-identical and dead money is unchanged',
    snap(result.world.season.transactionLog.slice(0, 1)) === priorLogBefore &&
    close(computeDeadMoney(result.world, f.aId), deadBefore));
  check('player appears exactly once and only on receiver roster',
    result.world.teams.flatMap((candidate) => candidate.roster)
      .filter((id) => id === f.fa[0]).length === 1 &&
    team(result.world, f.bId).roster.includes(f.fa[0]) &&
    !team(result.world, f.aId).roster.includes(f.fa[0]));
  check('successful S&T clears rights, desired deal, and signing-team hold',
    signedPlayer.birdRights === undefined && signedPlayer.desiredContract === undefined &&
    computeCapHolds(result.world, f.aId) === 0);
  check('applySignAndTrade contains exactly one contract-instantiation call',
    (String(applySignAndTrade).match(/instantiateContract/g) ?? []).length === 1);
}

function createSignAndTradeTpe(): {
  f: Fixture;
  result: Extract<ReturnType<typeof applySignAndTrade>, { ok: true }>;
  tpeId: string;
} {
  const f = fixture();
  setPayroll(f.world, f.aId, 160, { [f.a[0]]: 15 });
  setPayroll(f.world, f.bId, 140, { [f.b[0]]: 10 });
  setContract(f.world, f.fa[0], 15);
  setDesired(f.world, f.fa[0], 15, 3);
  const result = applySignAndTrade(f.world, defaultOp(f));
  if (!result.ok) throw new Error(result.reason);
  const tpeId = result.world.season.tradeExceptions.find(
    (grant) => grant.teamId === f.aId,
  )?.id;
  if (!tpeId) throw new Error('expected S&T-created TPE');
  return { f, result, tpeId };
}

function laterTpeUse(
  base: Extract<ReturnType<typeof applySignAndTrade>, { ok: true }>,
  f: Fixture,
  tpeId: string,
) {
  const world = structuredClone(base.world);
  const outgoing = f.a[0];
  const incoming = f.b[1];
  setContract(world, outgoing, 5);
  setContract(world, incoming, 4);
  return {
    world,
    outgoing,
    incoming,
    run: () => applyTrade(
      world,
      buildPlayerTrade(f.aId, f.bId, [outgoing], [incoming]),
      { tpeUsages: [{ teamId: f.aId, tpeId, incomingPlayerId: incoming }] },
    ),
  };
}

function testTpeComposition(): void {
  console.log('\nE. TPE creation, use, and hard-cap provenance');

  const created = createSignAndTradeTpe();
  const grant = created.result.world.season.tradeExceptions.find(
    (candidate) => candidate.id === created.tpeId,
  )!;
  check('$15M S&T for $10M return creates exact shipped $5.25M Standard TPE',
    close(grant.amount, 5.25) &&
    (created.result.entry as SignAndTradeEntry).createdTradeExceptionIds?.includes(grant.id) === true);

  const receiverUse = fixture();
  setDesired(receiverUse.world, receiverUse.fa[0], 4, 3);
  setContract(receiverUse.world, receiverUse.fa[0], 4);
  setContract(receiverUse.world, receiverUse.b[0], 5);
  receiverUse.world.season.tradeExceptions.push({
    id: 'receiver-tpe', teamId: receiverUse.bId, sourceTradeSeq: 999,
    sourcePlayerId: 'historic', amount: 5, createdDate: '2025-08-01',
    expiresDate: '2026-08-01', createdSeason: receiverUse.world.season.seasonId,
  });
  const receiverResult = applySignAndTrade(receiverUse.world, {
    ...defaultOp(receiverUse),
    tpeUsages: [{
      teamId: receiverUse.bId,
      tpeId: 'receiver-tpe',
      incomingPlayerId: receiverUse.fa[0],
    }],
  });
  check('receiver may allocate banked TPE to S&T player and usage derives balance',
    receiverResult.ok &&
    (receiverResult.entry as SignAndTradeEntry).tpeUsages?.[0].incomingPlayerId === receiverUse.fa[0] &&
    close(computeTradeExceptionRemaining(receiverResult.world, 'receiver-tpe'), 1));

  const priorUse = fixture();
  priorUse.world.season.tradeExceptions.push({
    id: 'sender-prior-tpe', teamId: priorUse.aId, sourceTradeSeq: 999,
    sourcePlayerId: 'historic', amount: 11, createdDate: '2024-10-20',
    expiresDate: '2026-01-01', createdSeason: '2024-25',
  });
  const priorResult = applySignAndTrade(priorUse.world, {
    ...defaultOp(priorUse),
    tpeUsages: [{
      teamId: priorUse.aId,
      tpeId: 'sender-prior-tpe',
      incomingPlayerId: priorUse.b[0],
    }],
  });
  check('prior-year TPE use within S&T preserves first-apron trigger',
    priorResult.ok && team(priorResult.world, priorUse.aId).hardCappedAtApron === 'first_apron');

  const later = laterTpeUse(created.result, created.f, created.tpeId);
  const laterResult = later.run();
  check('later normal trade using S&T-created TPE triggers second-apron hard cap',
    laterResult.ok && team(laterResult.world, created.f.aId).hardCappedAtApron === 'second_apron');

  const priorCreated = laterTpeUse(created.result, created.f, created.tpeId);
  priorCreated.world.season.currentDate = '2026-10-20';
  priorCreated.world.season.markers = [{
    type: 'trade_deadline', date: '2027-02-05', label: 'Trade Deadline',
  }];
  priorCreated.world.season.tradeExceptions.find(
    (candidate) => candidate.id === created.tpeId,
  )!.expiresDate = '2027-01-01';
  const priorCreatedResult = priorCreated.run();
  check('prior-year and S&T-source TPE triggers compose to stricter first apron',
    priorCreatedResult.ok &&
    team(priorCreatedResult.world, created.f.aId).hardCappedAtApron === 'first_apron');

  const blocked = laterTpeUse(created.result, created.f, created.tpeId);
  setPayroll(blocked.world, created.f.aId, SECOND_APRON + 2, {
    [blocked.outgoing]: 5,
  });
  const blockedBefore = snap(blocked.world);
  const blockedResult = blocked.run();
  check('S&T-source TPE use above effective second-apron cap rejects atomically',
    !blockedResult.ok && /hard cap/.test(blockedResult.reason) &&
    snap(blocked.world) === blockedBefore);

  const historic = fixture();
  setPayroll(historic.world, historic.aId, 160, { [historic.a[0]]: 10 });
  setPayroll(historic.world, historic.bId, 140, { [historic.b[0]]: 5 });
  const historicGrant = applyTrade(
    historic.world,
    buildPlayerTrade(historic.aId, historic.bId, [historic.a[0]], [historic.b[0]]),
  );
  check('historic normal-trade TPE setup succeeds', historicGrant.ok);
  if (historicGrant.ok) {
    const normalTpe = historicGrant.world.season.tradeExceptions[0];
    const useWorld = structuredClone(historicGrant.world);
    setContract(useWorld, historic.b[1], 4);
    setContract(useWorld, historic.b[0], 5);
    const normalUse = applyTrade(
      useWorld,
      buildPlayerTrade(historic.aId, historic.bId, [historic.b[0]], [historic.b[1]]),
      { tpeUsages: [{
        teamId: historic.aId,
        tpeId: normalTpe.id,
        incomingPlayerId: historic.b[1],
      }] },
    );
    check('same-year non-S&T TPE behavior remains unchanged with no new hard cap',
      normalUse.ok && !team(normalUse.world, historic.aId).hardCappedAtApron);
  }
}

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  sourceTeams = JSON.parse(await readFile(path.join(dataDir, 'teams.json'), 'utf8'));
  sourcePlayers = JSON.parse(await readFile(path.join(dataDir, 'players.json'), 'utf8'));
  check('configured S&T term constants are exactly three through four years',
    SIGN_AND_TRADE_MIN_YEARS === 3 && SIGN_AND_TRADE_MAX_YEARS === 4);
  testHappyPaths();
  testEligibilityAndAtomicity();
  testApronAndExceptionComposition();
  testLogAndStateCorrectness();
  testTpeComposition();
  console.log(`\n${failures === 0 ? 'PASS — all Phase 5b checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
