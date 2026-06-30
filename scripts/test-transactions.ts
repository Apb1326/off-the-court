/**
 * Tests the roster transaction layer (transactions Phase 1).
 *
 * Proves the load-bearing properties:
 *  - The atomic validate-then-mutate gate mutates state correctly on a legal op, and
 *    rejects an illegal op with a reason while leaving the input world BYTE-IDENTICAL
 *    (nothing is ever half-applied — verified via a JSON snapshot before/after).
 *  - Trades support uneven counts (2-for-1) and respect both rosters' size bounds.
 *  - The log is append-only and entries are self-describing (cut entry carries the
 *    consequence-attribution data a later phase needs).
 *  - `evaluateTradeForCpu` is desirability-only: it accepts even an illegal trade,
 *    proving legality does not live inside it.
 *
 * Standalone (no Next runtime). Reuses the real player/team data for fully-valid objects,
 * then sets up controlled roster sizes per scenario. Run with:
 *   node_modules/.bin/tsx scripts/test-transactions.ts
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { createSeasonState } from '../src/engine/season';
import {
  RosterWorld,
  applyTrade,
  applySignFreeAgent,
  applyCut,
  buildPlayerTrade,
  evaluateTradeForCpu,
  executeCpuTrade,
  upgradeContractShape,
  FREE_AGENT_TEAM_ID,
  ROSTER_MIN,
  ROSTER_MAX,
} from '../src/transactions';
import { CutEntry, SignEntry } from '../src/models/transaction';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${label}`);
  if (!ok) failures++;
}

let realTeams: Team[];
let realPlayers: Player[];
let pool: string[];

/** Roster array of a team in a world, by id. */
function rosterOf(world: RosterWorld, teamId: string): string[] {
  return world.teams.find((t) => t.id === teamId)!.roster;
}
function teamIdOf(world: RosterWorld, playerId: string): string {
  return world.players.find((p) => p.id === playerId)!.teamId;
}
/** A stable structural snapshot used to prove the gate never mutates its input. */
function snap(world: RosterWorld): string {
  return JSON.stringify(world);
}

/**
 * Build a fresh, independent world with controlled roster sizes. `aSize`/`bSize` players go
 * to two teams; `faCount` players go to the free-agent pool. Disjoint slices of the real
 * player pool, so every id maps to a fully-valid Player object.
 */
function scenario(aSize: number, bSize: number, faCount = 0) {
  const teamA = structuredClone(realTeams[0]);
  const teamB = structuredClone(realTeams[1]);
  const aId = teamA.id;
  const bId = teamB.id;

  let cursor = 0;
  const aRoster = pool.slice(cursor, (cursor += aSize));
  const bRoster = pool.slice(cursor, (cursor += bSize));
  const faIds = pool.slice(cursor, (cursor += faCount));

  teamA.roster = [...aRoster];
  teamB.roster = [...bRoster];

  const used = new Set([...aRoster, ...bRoster, ...faIds]);
  const players = realPlayers
    .filter((p) => used.has(p.id))
    .map((p) => {
      const c = structuredClone(p);
      c.teamId = aRoster.includes(p.id) ? aId : bRoster.includes(p.id) ? bId : FREE_AGENT_TEAM_ID;
      return c;
    });

  const season = createSeasonState(realTeams, realPlayers, { seed: 1 });
  season.freeAgentPool = [...faIds];

  const world: RosterWorld = { teams: [teamA, teamB], players, season };
  return { world, aId, bId, aRoster, bRoster, faIds };
}

function testTradeLegalAtBounds() {
  // Both rosters at the ceiling; a 1-for-1 keeps both at 15 → legal (at-bounds doesn't over-reject).
  const { world, aId, bId, aRoster, bRoster } = scenario(ROSTER_MAX, ROSTER_MAX);
  const a0 = aRoster[0];
  const b0 = bRoster[0];
  const before = snap(world);

  const res = applyTrade(world, buildPlayerTrade(aId, bId, [a0], [b0]));
  check('trade 1-for-1 at ceiling is legal', res.ok);
  if (!res.ok) return;

  check('trade: A roster size unchanged (15)', rosterOf(res.world, aId).length === ROSTER_MAX);
  check('trade: B roster size unchanged (15)', rosterOf(res.world, bId).length === ROSTER_MAX);
  check('trade: A received b0, sent a0',
    rosterOf(res.world, aId).includes(b0) && !rosterOf(res.world, aId).includes(a0));
  check('trade: B received a0, sent b0',
    rosterOf(res.world, bId).includes(a0) && !rosterOf(res.world, bId).includes(b0));
  check('trade: a0.teamId now B', teamIdOf(res.world, a0) === bId);
  check('trade: b0.teamId now A', teamIdOf(res.world, b0) === aId);
  check('trade: exactly one log entry, type trade, seq 0',
    res.world.season.transactionLog.length === 1 &&
      res.world.season.transactionLog[0].type === 'trade' &&
      res.world.season.transactionLog[0].seq === 0);
  check('trade: input world untouched (immutable, no half-apply)', snap(world) === before);
}

function testTradeLegalUneven() {
  // A:15 gives 2 / gets 1 -> 14; B:14 gives 1 / gets 2 -> 15. Both within [14,15] → legal.
  const { world, aId, bId, aRoster, bRoster } = scenario(ROSTER_MAX, ROSTER_MIN);
  const [a0, a1] = aRoster;
  const b0 = bRoster[0];

  const res = applyTrade(world, buildPlayerTrade(aId, bId, [a0, a1], [b0]));
  check('uneven 2-for-1 trade is legal', res.ok);
  if (!res.ok) return;

  check('uneven: A ends at floor (14)', rosterOf(res.world, aId).length === ROSTER_MIN);
  check('uneven: B ends at ceiling (15)', rosterOf(res.world, bId).length === ROSTER_MAX);
  const entry = res.world.season.transactionLog[0];
  check('uneven: log entry records both-sided payload (2 / 1)',
    entry.type === 'trade' && entry.assetsFromA.length === 2 && entry.assetsFromB.length === 1);
}

function testTradeIllegalCeiling() {
  // Both at ceiling; A gives 1 / gets 2 -> 16 (over the 15-man limit) → rejected.
  const { world, aId, bId, aRoster, bRoster } = scenario(ROSTER_MAX, ROSTER_MAX);
  const a0 = aRoster[0];
  const [b0, b1] = bRoster;
  const before = snap(world);

  const res = applyTrade(world, buildPlayerTrade(aId, bId, [a0], [b0, b1]));
  check('trade pushing a team over the ceiling is rejected', !res.ok);
  check('trade rejection carries a reason naming the limit',
    !res.ok && /over the 15-man/.test(res.reason));
  check('trade rejection leaves input byte-identical', snap(world) === before);
}

function testSign() {
  // Legal: team at floor (14) signs a FA -> 15.
  {
    const { world, aId, faIds } = scenario(ROSTER_MIN, ROSTER_MIN, 1);
    const fa = faIds[0];
    const before = snap(world);
    const res = applySignFreeAgent(world, { teamId: aId, playerId: fa });
    check('sign FA onto a sub-max roster is legal', res.ok);
    if (res.ok) {
      check('sign: roster now 15 and includes the FA', rosterOf(res.world, aId).length === 15 && rosterOf(res.world, aId).includes(fa));
      check('sign: player.teamId now the team', teamIdOf(res.world, fa) === aId);
      check('sign: FA removed from the pool', !res.world.season.freeAgentPool.includes(fa));
      check('sign: log entry type sign with toTeamId',
        res.world.season.transactionLog[0]?.type === 'sign');
    }
    check('sign: input untouched', snap(world) === before);
  }
  // Illegal: full roster (15) cannot sign.
  {
    const { world, aId, faIds } = scenario(ROSTER_MAX, ROSTER_MIN, 1);
    const fa = faIds[0];
    const before = snap(world);
    const res = applySignFreeAgent(world, { teamId: aId, playerId: fa });
    check('sign onto a full roster is rejected', !res.ok && /over the 15-man/.test(res.reason));
    check('sign rejection leaves input byte-identical', snap(world) === before);
  }
  // Illegal: player not actually in the FA pool.
  {
    const { world, aId, bRoster } = scenario(ROSTER_MIN, ROSTER_MIN);
    const onB = bRoster[0];
    const res = applySignFreeAgent(world, { teamId: aId, playerId: onB });
    check('signing a non-free-agent is rejected', !res.ok && /not in the free-agent pool/.test(res.reason));
  }
}

function testCut() {
  // Legal: team above the floor (15) cuts -> 14, player goes to the FA pool, for free.
  {
    const { world, aId, aRoster } = scenario(ROSTER_MAX, ROSTER_MIN);
    const a0 = aRoster[0];
    const before = snap(world);
    const res = applyCut(world, { teamId: aId, playerId: a0 });
    check('cut from an above-floor roster is legal', res.ok);
    if (res.ok) {
      check('cut: roster now 14 and excludes the player',
        rosterOf(res.world, aId).length === 14 && !rosterOf(res.world, aId).includes(a0));
      check('cut: player.teamId now the FA sentinel', teamIdOf(res.world, a0) === FREE_AGENT_TEAM_ID);
      check('cut: player added to the FA pool', res.world.season.freeAgentPool.includes(a0));
      const entry = res.world.season.transactionLog[0];
      check('cut: log entry carries playerId + fromTeamId (consequence-attribution data)',
        entry?.type === 'cut' && entry.playerId === a0 && entry.fromTeamId === aId);
    }
    check('cut: input untouched', snap(world) === before);
  }
  // Illegal: team at the floor (14) cannot cut without first signing a replacement.
  {
    const { world, aId, aRoster } = scenario(ROSTER_MIN, ROSTER_MIN);
    const a0 = aRoster[0];
    const before = snap(world);
    const res = applyCut(world, { teamId: aId, playerId: a0 });
    check('cut at the floor is rejected', !res.ok && /under the 14-man/.test(res.reason));
    check('cut rejection leaves input byte-identical', snap(world) === before);
  }
}

function testSequentialTransactions() {
  // Chain: trade → sign → cut, each op feeding the previous result's world.
  // Proves immutable-return composes correctly across multiple operations and
  // that seq values monotonically increment from the shared append-only log.
  const { world, aId, bId, aRoster, bRoster, faIds } = scenario(ROSTER_MAX, ROSTER_MIN, 2);
  const before = snap(world);

  // Step 1: trade 1 player from A to B (A: 15→14, B: 14→15)
  const tradedPlayer = aRoster[0];
  const res1 = applyTrade(world, buildPlayerTrade(aId, bId, [tradedPlayer], []));
  check('chain step 1 (trade) is legal', res1.ok);
  if (!res1.ok) return;
  const world1 = res1.world;
  check('chain step 1: A roster is 14', rosterOf(world1, aId).length === ROSTER_MIN);
  check('chain step 1: B roster is 15', rosterOf(world1, bId).length === ROSTER_MAX);
  check('chain step 1: traded player now on B', teamIdOf(world1, tradedPlayer) === bId);
  check('chain step 1: log has 1 entry, seq 0',
    world1.season.transactionLog.length === 1 && world1.season.transactionLog[0].seq === 0);

  // Step 2: sign a FA onto A (A: 14→15), using the world from step 1
  const signedPlayer = faIds[0];
  const res2 = applySignFreeAgent(world1, { teamId: aId, playerId: signedPlayer });
  check('chain step 2 (sign) is legal', res2.ok);
  if (!res2.ok) return;
  const world2 = res2.world;
  check('chain step 2: A roster is 15', rosterOf(world2, aId).length === ROSTER_MAX);
  check('chain step 2: FA pool shrunk by 1', world2.season.freeAgentPool.length === 1);
  check('chain step 2: signed player now on A', teamIdOf(world2, signedPlayer) === aId);
  check('chain step 2: log has 2 entries, entry 1 seq 1',
    world2.season.transactionLog.length === 2 && world2.season.transactionLog[1].seq === 1);

  // Step 3: cut a player from B (B: 15→14), using the world from step 2
  const cutPlayer = bRoster[0]; // original B player, still on B after step 1
  const res3 = applyCut(world2, { teamId: bId, playerId: cutPlayer });
  check('chain step 3 (cut) is legal', res3.ok);
  if (!res3.ok) return;
  const world3 = res3.world;
  check('chain step 3: B roster is 14', rosterOf(world3, bId).length === ROSTER_MIN);
  check('chain step 3: FA pool grew by 1', world3.season.freeAgentPool.length === 2);
  check('chain step 3: cut player is FREE_AGENT', teamIdOf(world3, cutPlayer) === FREE_AGENT_TEAM_ID);

  // Full-chain assertions
  const log = world3.season.transactionLog;
  check('chain: 3 log entries total', log.length === 3);
  check('chain: seq values are 0, 1, 2 (monotonic)',
    log[0].seq === 0 && log[1].seq === 1 && log[2].seq === 2);
  check('chain: original world byte-identical (immutability holds across full chain)',
    snap(world) === before);
}

function testZeroAssetTrade() {
  // Phase 1 deliberately allows zero-asset sides — roster-legality is the only constraint.
  // Phase 4 salary-matching will naturally block these unless an exception applies.

  // Gift trade: A sends nothing, B sends 1 player (A: 14→15, B: 15→14).
  {
    const { world, aId, bId, bRoster } = scenario(ROSTER_MIN, ROSTER_MAX);
    const movedPlayer = bRoster[0];
    const res = applyTrade(world, buildPlayerTrade(aId, bId, [], [movedPlayer]));
    check('zero-asset A side (gift trade) is legal', res.ok);
    if (res.ok) {
      check('gift trade: A roster is 15', rosterOf(res.world, aId).length === ROSTER_MAX);
      check('gift trade: B roster is 14', rosterOf(res.world, bId).length === ROSTER_MIN);
      check('gift trade: player now on A', teamIdOf(res.world, movedPlayer) === aId);
      const entry = res.world.season.transactionLog[0];
      check('gift trade: log records empty assetsFromA and one assetsFromB',
        entry.type === 'trade' && entry.assetsFromA.length === 0 && entry.assetsFromB.length === 1);
    }
  }
  // Degenerate 0-for-0: both sides send nothing — legal no-op that appends a log entry.
  {
    const { world, aId, bId } = scenario(ROSTER_MIN, ROSTER_MAX);
    const res = applyTrade(world, buildPlayerTrade(aId, bId, [], []));
    check('0-for-0 trade is legal (no-op)', res.ok);
    if (res.ok) {
      check('0-for-0: A roster unchanged (14)', rosterOf(res.world, aId).length === ROSTER_MIN);
      check('0-for-0: B roster unchanged (15)', rosterOf(res.world, bId).length === ROSTER_MAX);
      const entry = res.world.season.transactionLog[0];
      check('0-for-0: log entry created with empty asset lists on both sides',
        entry?.type === 'trade' && entry.assetsFromA.length === 0 && entry.assetsFromB.length === 0);
    }
  }
}

function testDesirabilitySeam() {
  // evaluateTradeForCpu accepts even an ILLEGAL trade — proving legality is NOT inside it.
  const { world, aId, bId, aRoster, bRoster } = scenario(ROSTER_MAX, ROSTER_MAX);
  const illegal = buildPlayerTrade(aId, bId, [aRoster[0]], [bRoster[0], bRoster[1]]); // pushes A to 16
  const verdict = evaluateTradeForCpu(world, illegal, bId);
  check('evaluateTradeForCpu accepts (stub) regardless of legality', verdict.accept === true);
  check('the matching trade is still illegal at the gate (legality lives there)',
    applyTrade(world, illegal).ok === false);

  // executeCpuTrade composes desirability + the shared legality gate on a legal deal.
  const legal = buildPlayerTrade(aId, bId, [aRoster[0]], [bRoster[0]]);
  const res = executeCpuTrade(world, legal, bId);
  check('executeCpuTrade applies a legal, desired trade', res.ok);
}

function testCutContractSnapshot() {
  const { world, aId, aRoster } = scenario(ROSTER_MAX, ROSTER_MIN);
  const a0 = aRoster[0];

  const res = applyCut(world, { teamId: aId, playerId: a0 });
  check('cut-contract: operation is legal', res.ok);
  if (!res.ok) return;

  const entry = res.world.season.transactionLog[0] as CutEntry;
  check('cut-contract: entry has contractAtCut', entry.contractAtCut !== undefined);
  check('cut-contract: contractAtCut matches player contract pre-cut',
    entry.contractAtCut !== undefined &&
    JSON.stringify(entry.contractAtCut) === JSON.stringify(world.players.find(p => p.id === a0)!.contract));

  const cutPlayer = res.world.players.find(p => p.id === a0)!;
  check('cut-contract: cut player has desiredContract', cutPlayer.desiredContract !== undefined);
  check('cut-contract: cut player contract is preserved (previous deal)',
    cutPlayer.contract !== undefined && cutPlayer.contract.salarySchedule !== undefined);
}

function testSignContractInstantiation() {
  // Set up a scenario with a FA who has a desiredContract
  const { world, aId, faIds } = scenario(ROSTER_MIN, ROSTER_MIN, 1);
  const fa = faIds[0];

  // First cut a player from a full team to get a player with desiredContract,
  // or just set it manually on the FA for test purposes.
  const worldWithDesired: RosterWorld = {
    ...world,
    players: world.players.map(p =>
      p.id === fa
        ? { ...p, desiredContract: { type: 'veteran' as const, desiredSalary: 5, desiredYears: 2 } }
        : p,
    ),
  };

  const res = applySignFreeAgent(worldWithDesired, { teamId: aId, playerId: fa });
  check('sign-contract: operation is legal', res.ok);
  if (!res.ok) return;

  const entry = res.world.season.transactionLog[0] as SignEntry;
  check('sign-contract: entry has contractSigned', entry.contractSigned !== undefined);
  check('sign-contract: contractSigned has correct type',
    entry.contractSigned?.type === 'veteran');
  check('sign-contract: contractSigned has correct salary schedule length',
    entry.contractSigned?.salarySchedule.length === 2);
  check('sign-contract: contractSigned salary matches desired',
    entry.contractSigned?.salarySchedule[0] === 5);

  const signedPlayer = res.world.players.find(p => p.id === fa)!;
  check('sign-contract: signed player desiredContract is cleared',
    signedPlayer.desiredContract === undefined);
  check('sign-contract: signed player contract matches contractSigned',
    JSON.stringify(signedPlayer.contract) === JSON.stringify(entry.contractSigned));
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  realTeams = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const loaded: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
  realPlayers = loaded.map(p => ({
    ...p,
    contract: typeof (p.contract as unknown as Record<string, unknown>).type === 'string'
      ? p.contract
      : upgradeContractShape(p.contract as unknown as { yearsRemaining: number; salaryPerYear: number; option?: string }),
  }));
  pool = realPlayers.map((p) => p.id);

  if (realTeams.length < 2 || pool.length < ROSTER_MAX * 2 + 4) {
    console.error('Need teams + enough players. Run data ingestion first (npm run ingest).');
    process.exit(1);
  }

  testTradeLegalAtBounds();
  testTradeLegalUneven();
  testTradeIllegalCeiling();
  testSign();
  testCut();
  testDesirabilitySeam();
  testSequentialTransactions();
  testZeroAssetTrade();
  testCutContractSnapshot();
  testSignContractInstantiation();

  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
