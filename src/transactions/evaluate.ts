import { TradeProposal } from '@/models/transaction';
import { RosterWorld } from './world';
import { applyTrade, TransactionResult } from './gate';

/**
 * CPU trade desirability — the single chokepoint for "does the CPU *want* this deal?".
 *
 * Legality vs. desirability is a permanent boundary (AGENTS.md): deterministic, shared
 * legality lives in the validate-then-mutate gate (`applyTrade`) and applies to every trade
 * regardless of proposer. This function is DESIRABILITY-ONLY and may assume legality has
 * already passed — do not move legality checks in here. Phase 6 swaps the body for a real
 * valuation model; keeping the seam clean is the whole point of defining it now.
 */

export interface CpuTradeEvaluation {
  accept: boolean;
  reason: string;
}

/**
 * Phase 1 stub: accept every proposal. Returns a reason so the seam reads the same as the
 * eventual real implementation (which will reject with a reason).
 */
export function evaluateTradeForCpu(
  _world: RosterWorld,
  _proposal: TradeProposal,
  _cpuTeamId: string,
): CpuTradeEvaluation {
  return {
    accept: true,
    reason: 'accept-all stub (transactions Phase 1; CPU valuation arrives in Phase 6)',
  };
}

/**
 * Orchestrate a trade proposed to a CPU team: consult the CPU's desirability, then run the
 * shared legality gate (which performs the atomic mutation). Demonstrates and enforces the
 * boundary — desirability gates *whether we offer*, the gate decides *whether it's legal* and
 * applies it. Legality runs for the trade regardless of the verdict's source.
 */
export function executeCpuTrade(
  world: RosterWorld,
  proposal: TradeProposal,
  cpuTeamId: string,
): TransactionResult {
  const verdict = evaluateTradeForCpu(world, proposal, cpuTeamId);
  if (!verdict.accept) return { ok: false, reason: `CPU declined: ${verdict.reason}` };
  return applyTrade(world, proposal);
}
