import { TradeException } from '@/models/season';
import { TradeExceptionUsage, TradeProposal } from '@/models/transaction';
import { currentSalary } from './contracts';
import { capYearForDate, isCanonicalDate } from './date';
import { MONEY_EPSILON } from './constants';
import { getPlayer, isStandardContractPlayer, RosterWorld } from './world';
import { playerIdsOf } from './assets';

function grantMap(world: RosterWorld): Map<string, TradeException> {
  const grants = new Map<string, TradeException>();
  for (const grant of world.season.tradeExceptions) {
    if (grants.has(grant.id)) throw new Error(`duplicate trade exception id "${grant.id}"`);
    if (!Number.isFinite(grant.amount) || grant.amount < 0) {
      throw new Error(`trade exception "${grant.id}" has invalid amount`);
    }
    if (!isCanonicalDate(grant.createdDate) || !isCanonicalDate(grant.expiresDate)) {
      throw new Error(`trade exception "${grant.id}" has invalid dates`);
    }
    grants.set(grant.id, grant);
  }
  return grants;
}

function allUsage(world: RosterWorld): Map<string, number> {
  const grants = grantMap(world);
  const used = new Map<string, number>();
  for (const entry of world.season.transactionLog) {
    if (entry.type !== 'trade') continue;
    for (const usage of entry.tpeUsages ?? []) {
      const grant = grants.get(usage.tpeId);
      if (!grant) throw new Error(`unknown trade exception usage id "${usage.tpeId}"`);
      if (grant.teamId !== usage.teamId) throw new Error(`trade exception "${usage.tpeId}" used by wrong team`);
      if (!Number.isFinite(usage.amount) || usage.amount < 0) {
        throw new Error(`trade exception "${usage.tpeId}" has invalid usage amount`);
      }
      const next = (used.get(usage.tpeId) ?? 0) + usage.amount;
      if (next > grant.amount + MONEY_EPSILON) {
        throw new Error(`trade exception "${usage.tpeId}" usage exceeds grant`);
      }
      used.set(usage.tpeId, next);
    }
  }
  return used;
}

export function computeTradeExceptionUsed(world: RosterWorld, tpeId: string): number {
  if (!grantMap(world).has(tpeId)) throw new Error(`unknown trade exception "${tpeId}"`);
  return allUsage(world).get(tpeId) ?? 0;
}

export function computeTradeExceptionRemaining(world: RosterWorld, tpeId: string): number {
  const grant = grantMap(world).get(tpeId);
  if (!grant) throw new Error(`unknown trade exception "${tpeId}"`);
  return Math.max(0, grant.amount - computeTradeExceptionUsed(world, tpeId));
}

export function getActiveTradeExceptions(
  world: RosterWorld,
  teamId: string,
  asOfDate = world.season.currentDate,
): TradeException[] {
  if (!isCanonicalDate(asOfDate)) throw new Error(`invalid TPE as-of date "${asOfDate}"`);
  const grants = [...grantMap(world).values()];
  allUsage(world); // validate the full immutable ledger before returning a view.
  return grants
    .filter((grant) =>
      grant.teamId === teamId && asOfDate < grant.expiresDate &&
      computeTradeExceptionRemaining(world, grant.id) > MONEY_EPSILON)
    .sort((a, b) => a.expiresDate.localeCompare(b.expiresDate) || a.id.localeCompare(b.id));
}

export interface RequestedTpeUsage {
  teamId: string;
  tpeId: string;
  incomingPlayerId: string;
}

export type TpeUsageAnalysis =
  | { ok: true; usages: TradeExceptionUsage[]; allocatedByTeam: Map<string, Set<string>>; triggeredFirstApron: Set<string> }
  | { ok: false; reason: string };

/** Independent TPE allocation analysis used by the shared legality gate. */
export function analyzeTpeUsages(
  world: RosterWorld,
  proposal: TradeProposal,
  requests: RequestedTpeUsage[] = [],
): TpeUsageAnalysis {
  try {
    const grants = grantMap(world);
    allUsage(world);
    const teamIds = new Set([proposal.teamA, proposal.teamB]);
    const incoming = new Map<string, Set<string>>([
      [proposal.teamA, new Set(playerIdsOf(proposal.assetsFromB))],
      [proposal.teamB, new Set(playerIdsOf(proposal.assetsFromA))],
    ]);
    const allocatedPlayers = new Set<string>();
    const usedTpes = new Set<string>();
    const allocatedByTeam = new Map<string, Set<string>>();
    const triggeredFirstApron = new Set<string>();
    const usages: TradeExceptionUsage[] = [];

    for (const request of requests) {
      if (!teamIds.has(request.teamId)) return { ok: false, reason: `${request.teamId} is not a side of this trade` };
      const grant = grants.get(request.tpeId);
      if (!grant) return { ok: false, reason: `unknown trade exception "${request.tpeId}"` };
      if (grant.teamId !== request.teamId) return { ok: false, reason: `trade exception "${request.tpeId}" belongs to another team` };
      if (world.season.currentDate >= grant.expiresDate) return { ok: false, reason: `trade exception "${request.tpeId}" is expired` };
      if (!incoming.get(request.teamId)!.has(request.incomingPlayerId)) {
        return { ok: false, reason: `player "${request.incomingPlayerId}" is not incoming to ${request.teamId}` };
      }
      if (allocatedPlayers.has(request.incomingPlayerId)) return { ok: false, reason: `player "${request.incomingPlayerId}" has duplicate TPE allocation` };
      if (usedTpes.has(request.tpeId)) return { ok: false, reason: `trade exception "${request.tpeId}" may absorb only one player per trade` };
      const player = getPlayer(world, request.incomingPlayerId);
      if (!player || !isStandardContractPlayer(player)) return { ok: false, reason: 'a TPE may absorb only an incoming standard-contract player' };
      const amount = currentSalary(player.contract);
      if (amount > computeTradeExceptionRemaining(world, request.tpeId) + MONEY_EPSILON) {
        return { ok: false, reason: `trade exception "${request.tpeId}" has insufficient remaining amount` };
      }
      allocatedPlayers.add(request.incomingPlayerId);
      usedTpes.add(request.tpeId);
      const teamAllocations = allocatedByTeam.get(request.teamId) ?? new Set<string>();
      teamAllocations.add(request.incomingPlayerId);
      allocatedByTeam.set(request.teamId, teamAllocations);
      usages.push({ ...request, amount });
      if (capYearForDate(grant.createdDate) < capYearForDate(world.season.currentDate)) {
        triggeredFirstApron.add(request.teamId);
      }
    }
    return { ok: true, usages, allocatedByTeam, triggeredFirstApron };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid trade exception ledger' };
  }
}
