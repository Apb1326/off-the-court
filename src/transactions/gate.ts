import { SeasonState } from '@/models/season';
import {
  TradeProposal,
  TransactionEntry,
  TradeEntry,
  SignEntry,
  CutEntry,
} from '@/models/transaction';
import {
  RosterWorld,
  getPlayer,
  projectStandardRosterCount,
  projectStandardRosterCountForSigning,
} from './world';
import { playerIdsOf } from './assets';
import { FREE_AGENT_TEAM_ID } from './constants';
import { generateDesiredContract, instantiateContract } from './contracts';
import {
  runValidators,
  teamExists,
  playerExists,
  teamsDistinct,
  playerOnRoster,
  playerInFreeAgentPool,
  playerHasTeamId,
  playerAbsentFromAllRosters,
  playerHasValidDesiredContract,
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
): { season: SeasonState; entry: TransactionEntry } {
  const storedEntry = structuredClone(entry);
  return {
    season: {
      ...season,
      freeAgentPool: [...(freeAgentPool ?? season.freeAgentPool)],
      transactionLog: [
        ...season.transactionLog.map((priorEntry) => structuredClone(priorEntry)),
        storedEntry,
      ],
    },
    // Callers may mutate their result object; never expose the append-only stored object.
    entry: structuredClone(storedEntry),
  };
}

// --- trade ---

/**
 * Execute a trade between two teams. Supports uneven counts (e.g. 2-for-1). Both rosters
 * must remain within size bounds afterward; every traded player must be on the giving team's
 * roster; no player may appear twice.
 *
 * Phase 1 allows zero-asset sides (including 0-for-0). This is intentional — roster-legality
 * is the only constraint here. Salary-matching (Phase 4) will naturally require non-trivial
 * compensation once it exists. A 0-for-0 trade is a harmless no-op that appends a log entry.
 */
export function applyTrade(world: RosterWorld, proposal: TradeProposal): TransactionResult {
  const { teamA, teamB } = proposal;
  const idsFromA = playerIdsOf(proposal.assetsFromA);
  const idsFromB = playerIdsOf(proposal.assetsFromB);

  const check = runValidators([
    () => teamExists(world, teamA),
    () => teamExists(world, teamB),
    () => teamsDistinct(teamA, teamB),
    () => noDuplicatePlayers([...idsFromA, ...idsFromB]),
    ...idsFromA.map((id) => () => playerExists(world, id)),
    ...idsFromB.map((id) => () => playerExists(world, id)),
    ...idsFromA.map((id) => () => playerOnRoster(world, teamA, id)),
    ...idsFromB.map((id) => () => playerOnRoster(world, teamB, id)),
    () => rosterWithinBounds(
      teamA,
      projectStandardRosterCount(world, teamA, idsFromA, idsFromB),
    ),
    () => rosterWithinBounds(
      teamB,
      projectStandardRosterCount(world, teamB, idsFromB, idsFromA),
    ),
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
  // NOTE (downstream, not Phase 1 scope): a traded player remains in the old team's
  // rotation.starters / rotationOrder and is absent from the new team's. The existing
  // adjustRotation in engine/injury.ts handles this gracefully (treats a missing player
  // like an injured one), but a traded-in star won't start until someone goes down.
  // When trades become user-facing, reconcile rotation settings as part of the mutation
  // or as a post-trade caller responsibility.

  const players = world.players.map((p) => {
    if (leavingA.has(p.id)) return { ...p, teamId: teamB };
    if (leavingB.has(p.id)) return { ...p, teamId: teamA };
    return p;
  });
  // NOTE (downstream, not Phase 1 scope): PlayerSeasonStats.teamId in
  // SeasonState.playerStats is not updated here — stats continue accumulating under
  // the old team's id. The real NBA tracks split stats (separate lines per team per
  // season). Address when trades become user-facing; not this phase's concern.

  const entry: TradeEntry = {
    ...entryBase(world.season),
    type: 'trade',
    teamA,
    teamB,
    assetsFromA: proposal.assetsFromA,
    assetsFromB: proposal.assetsFromB,
  };
  const committed = commitSeason(world.season, entry);

  return { ok: true, world: { teams, players, season: committed.season }, entry: committed.entry };
}

// --- sign free agent ---

/**
 * Sign a free agent onto a team. Legal iff the player is actually in the FA pool and the
 * team stays within the ceiling afterward.
 */
export function applySignFreeAgent(world: RosterWorld, op: SignOp): TransactionResult {
  const { teamId, playerId } = op;
  const check = runValidators([
    () => teamExists(world, teamId),
    () => playerExists(world, playerId),
    () => playerInFreeAgentPool(world, playerId),
    () => playerHasTeamId(world, playerId, FREE_AGENT_TEAM_ID),
    () => playerAbsentFromAllRosters(world, playerId),
    () => playerHasValidDesiredContract(world, playerId),
    () => rosterWithinBounds(
      teamId,
      projectStandardRosterCountForSigning(world, teamId, playerId),
    ),
  ]);
  if (!check.ok) return check;

  const teams = world.teams.map((t) =>
    t.id === teamId ? { ...t, roster: [...t.roster, playerId] } : t,
  );

  const signingPlayer = getPlayer(world, playerId)!;
  const newContract = instantiateContract(signingPlayer.desiredContract!);

  const players = world.players.map((p) => {
    if (p.id === playerId) {
      return {
        ...p,
        teamId,
        contract: newContract,
        desiredContract: undefined,
      };
    }
    return p;
  });

  const entry: SignEntry = {
    ...entryBase(world.season),
    type: 'sign',
    playerId,
    toTeamId: teamId,
    contractSigned: structuredClone(newContract),
  };
  const freeAgentPool = world.season.freeAgentPool.filter((id) => id !== playerId);
  const committed = commitSeason(world.season, entry, freeAgentPool);

  return {
    ok: true,
    world: { teams, players, season: committed.season },
    entry: committed.entry,
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
  const check = runValidators([
    () => teamExists(world, teamId),
    () => playerExists(world, playerId),
    () => playerOnRoster(world, teamId, playerId),
    () => rosterWithinBounds(
      teamId,
      projectStandardRosterCount(world, teamId, [playerId], []),
    ),
  ]);
  if (!check.ok) return check;

  const teams = world.teams.map((t) =>
    t.id === teamId ? { ...t, roster: t.roster.filter((id) => id !== playerId) } : t,
  );

  const cutPlayer = world.players.find(p => p.id === playerId);

  const players = world.players.map((p) => {
    if (p.id === playerId) {
      return {
        ...p,
        teamId: FREE_AGENT_TEAM_ID,
        desiredContract: generateDesiredContract(p),
      };
    }
    return p;
  });

  const entry: CutEntry = {
    ...entryBase(world.season),
    type: 'cut',
    playerId,
    fromTeamId: teamId,
    contractAtCut: cutPlayer?.contract ? structuredClone(cutPlayer.contract) : undefined,
  };
  const freeAgentPool = [...world.season.freeAgentPool, playerId];
  const committed = commitSeason(world.season, entry, freeAgentPool);

  return {
    ok: true,
    world: { teams, players, season: committed.season },
    entry: committed.entry,
  };
}
