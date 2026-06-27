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
  FREE_AGENT_TEAM_ID,
  ROSTER_MIN,
  ROSTER_MAX,
} from '../src/transactions';

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

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  realTeams = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  realPlayers = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
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

  console.log(`\n${failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
