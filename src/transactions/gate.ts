import { SeasonState } from '@/models/season';
import {
  TradeProposal,
  TransactionEntry,
  TradeEntry,
  SignEntry,
  CutEntry,
} from '@/models/transaction';
import { RosterWorld, getTeam } from './world';
import { playerIdsOf } from './assets';
import { FREE_AGENT_TEAM_ID } from './constants';
import {
  runValidators,
  teamExists,
  playerExists,
  teamsDistinct,
  playerOnRoster,
  playerInFreeAgentPool,
  noDuplicatePlayers,
  rosterWithinBounds,
} from './validators';

/**
 * The atomic validate-then-mutate gate — the single chokepoint every roster transaction
 * passes through (AGENTS.md). For each operation: roster-legality validators run first and
 * compose; mutation happens only if all pass; nothing is ever half-applied.
 *
 * Atomicity is structural: a `RosterWorld` is never mutated in place. On failure the gate
 * returns `{ ok: false, reason }` having touched nothing (the input is byte-identical
 * afterward). On success it returns a brand-new `RosterWorld` with new arrays for the
 * affected teams/players/season and structural sharing for everything untouched.
 *
 * This gate is desirability-agnostic: legality applies to every transaction regardless of
 * proposer. CPU willingness lives separately in `evaluateTradeForCpu` (evaluate.ts).
 */

export type TransactionResult =
  | { ok: true; world: RosterWorld; entry: TransactionEntry }
  | { ok: false; reason: string };

export interface SignOp {
  teamId: string;
  playerId: string;
}

export interface CutOp {
  teamId: string;
  playerId: string;
}

/** Base fields shared by every log entry, stamped at append time. */
function entryBase(season: SeasonState): { seq: number; date: string; season: string } {
  return {
    seq: season.transactionLog.length, // monotonic; the log is append-only
    date: season.currentDate,
    season: season.seasonId,
  };
}

/** Append an entry to the log (and optionally swap in a new FA pool), immutably. */
function commitSeason(
  season: SeasonState,
  entry: TransactionEntry,
  freeAgentPool?: string[],
): SeasonState {
  return {
    ...season,
    freeAgentPool: freeAgentPool ?? season.freeAgentPool,
    transactionLog: [...season.transactionLog, entry],
  };
}

// --- trade ---

/**
 * Execute a trade between two teams. Supports uneven counts (e.g. 2-for-1). Both rosters
 * must remain within size bounds afterward; every traded player must be on the giving team's
 * roster; no player may appear twice.
 */
export function applyTrade(world: RosterWorld, proposal: TradeProposal): TransactionResult {
  const { teamA, teamB } = proposal;
  const idsFromA = playerIdsOf(proposal.assetsFromA);
  const idsFromB = playerIdsOf(proposal.assetsFromB);

  const a = getTeam(world, teamA);
  const b = getTeam(world, teamB);
  const projectedA = a ? a.roster.length - idsFromA.length + idsFromB.length : 0;
  const projectedB = b ? b.roster.length - idsFromB.length + idsFromA.length : 0;

  const check = runValidators([
    () => teamExists(world, teamA),
    () => teamExists(world, teamB),
    () => teamsDistinct(teamA, teamB),
    () => noDuplicatePlayers([...idsFromA, ...idsFromB]),
    ...idsFromA.map((id) => () => playerOnRoster(world, teamA, id)),
    ...idsFromB.map((id) => () => playerOnRoster(world, teamB, id)),
    () => rosterWithinBounds(teamA, projectedA),
    () => rosterWithinBounds(teamB, projectedB),
  ]);
  if (!check.ok) return check;

  // Legality proven — build the new world immutably.
  const leavingA = new Set(idsFromA);
  const leavingB = new Set(idsFromB);

  const teams = world.teams.map((t) => {
    if (t.id === teamA) {
      return { ...t, roster: [...t.roster.filter((id) => !leavingA.has(id)), ...idsFromB] };
    }
    if (t.id === teamB) {
      return { ...t, roster: [...t.roster.filter((id) => !leavingB.has(id)), ...idsFromA] };
    }
    return t;
  });

  const players = world.players.map((p) => {
    if (leavingA.has(p.id)) return { ...p, teamId: teamB };
    if (leavingB.has(p.id)) return { ...p, teamId: teamA };
    return p;
  });

  const entry: TradeEntry = {
    ...entryBase(world.season),
    type: 'trade',
    teamA,
    teamB,
    assetsFromA: proposal.assetsFromA,
    assetsFromB: proposal.assetsFromB,
  };

  return { ok: true, world: { teams, players, season: commitSeason(world.season, entry) }, entry };
}

// --- sign free agent ---

/**
 * Sign a free agent onto a team. Legal iff the player is actually in the FA pool and the
 * team stays within the ceiling afterward.
 */
export function applySignFreeAgent(world: RosterWorld, op: SignOp): TransactionResult {
  const { teamId, playerId } = op;
  const team = getTeam(world, teamId);
  const projected = team ? team.roster.length + 1 : 0;

  const check = runValidators([
    () => teamExists(world, teamId),
    () => playerExists(world, playerId),
    () => playerInFreeAgentPool(world, playerId),
    () => rosterWithinBounds(teamId, projected),
  ]);
  if (!check.ok) return check;

  const teams = world.teams.map((t) =>
    t.id === teamId ? { ...t, roster: [...t.roster, playerId] } : t,
  );
  const players = world.players.map((p) => (p.id === playerId ? { ...p, teamId } : p));

  const entry: SignEntry = {
    ...entryBase(world.season),
    type: 'sign',
    playerId,
    toTeamId: teamId,
  };
  const freeAgentPool = world.season.freeAgentPool.filter((id) => id !== playerId);

  return {
    ok: true,
    world: { teams, players, season: commitSeason(world.season, entry, freeAgentPool) },
    entry,
  };
}

// --- cut / waive (collapsed in Phase 1: straight to the FA pool, for free) ---

/**
 * Cut a player. Legal iff the player is on the team's roster and the team stays at/above the
 * floor afterward — a team at the minimum must sign a replacement before it can cut. The
 * player goes straight to the FA pool (the real waiver process is deferred). The cut entry
 * records who was cut by whom and when, so a later phase can attribute consequences.
 */
export function applyCut(world: RosterWorld, op: CutOp): TransactionResult {
  const { teamId, playerId } = op;
  const team = getTeam(world, teamId);
  const projected = team ? team.roster.length - 1 : 0;

  const check = runValidators([
    () => teamExists(world, teamId),
    () => playerOnRoster(world, teamId, playerId),
    () => rosterWithinBounds(teamId, projected),
  ]);
  if (!check.ok) return check;

  const teams = world.teams.map((t) =>
    t.id === teamId ? { ...t, roster: t.roster.filter((id) => id !== playerId) } : t,
  );
  const players = world.players.map((p) =>
    p.id === playerId ? { ...p, teamId: FREE_AGENT_TEAM_ID } : p,
  );

  const entry: CutEntry = {
    ...entryBase(world.season),
    type: 'cut',
    playerId,
    fromTeamId: teamId,
  };
  const freeAgentPool = [...world.season.freeAgentPool, playerId];

  return {
    ok: true,
    world: { teams, players, season: commitSeason(world.season, entry, freeAgentPool) },
    entry,
  };
}
