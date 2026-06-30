/**
 * Contract utilities (transactions Phase 2).
 *
 * Helpers for working with the expanded contract model: current-year salary,
 * years remaining, contract instantiation from desired-contract, and the
 * cap-hold stub.
 */

import { Contract, DesiredContract, Player, PlayerRatings } from '@/models/player';
import { FREE_AGENT_TEAM_ID } from './constants';
import {
  CONTRACT_MINIMUM_SALARY,
  CONTRACT_REFERENCE_CAP,
  CONTRACT_MAX_PCT_0_6,
} from './constants';

/**
 * Structural invariants every Contract must satisfy. Call this in tests and
 * at contract-creation boundaries. Returns a reason on failure.
 */
export function validateContract(c: Contract): { ok: true } | { ok: false; reason: string } {
  if (c.salarySchedule.length === 0)
    return { ok: false, reason: 'salarySchedule must be non-empty' };
  if (!Number.isInteger(c.salarySchedule.length))
    return { ok: false, reason: 'years must be an integer' };
  for (let i = 0; i < c.salarySchedule.length; i++) {
    const s = c.salarySchedule[i];
    if (!Number.isFinite(s) || s < 0)
      return { ok: false, reason: `salarySchedule[${i}] must be finite and non-negative` };
  }
  if (c.option) {
    if (c.type === 'two_way')
      return { ok: false, reason: 'two-way contracts cannot have options' };
    if (c.option.year < 0 || c.option.year >= c.salarySchedule.length)
      return { ok: false, reason: `option year ${c.option.year} is out of range [0, ${c.salarySchedule.length - 1}]` };
  }
  return { ok: true };
}

/** Current-year salary in millions. */
export function currentSalary(contract: Contract): number {
  return contract.salarySchedule[0] ?? 0;
}

/** Years remaining on the contract (derived from schedule length). */
export function yearsRemaining(contract: Contract): number {
  return contract.salarySchedule.length;
}

/** Total guaranteed money remaining (sum of schedule). */
export function totalRemaining(contract: Contract): number {
  return contract.salarySchedule.reduce((sum, s) => sum + s, 0);
}

/**
 * Build a flat-salary contract from desired-contract parameters. Used when a
 * free agent signs. Phase 4+ may make this more sophisticated (raises, etc.).
 * Asserts validity before returning.
 */
export function instantiateContract(desired: DesiredContract): Contract {
  const c: Contract = {
    type: desired.type,
    salarySchedule: Array.from(
      { length: Math.max(1, Math.round(desired.desiredYears)) },
      () => Math.max(0, desired.desiredSalary),
    ),
    noTradeClause: false,
    option: undefined,
  };
  const v = validateContract(c);
  if (!v.ok) throw new Error(`instantiateContract produced invalid contract: ${v.reason}`);
  return c;
}

/**
 * Cap-hold stub (Phase 2). Returns a placeholder cap-hold NUMBER for a player.
 *
 * This is NOT a Bird-rights-aware calculation — it knows nothing about the team's
 * relationship to the player or their years of service. It is a PLACEHOLDER value
 * that Phase 3 will replace with real cap-hold logic. Does NOT do anything yet —
 * no system reads this value in Phase 2.
 */
export function computeCapHoldStub(contract: Contract): number {
  const prev = currentSalary(contract);
  return Math.max(prev * 1.5, CONTRACT_MINIMUM_SALARY);
}

/**
 * Generate a DesiredContract for a player entering the FA pool.
 * Uses the player's previous contract and their overall quality to set
 * market-rate expectations. FAs typically can't command the same deal
 * they had — this applies a discount floored at the minimum.
 */
export function generateDesiredContract(
  player: { contract: Contract; ratings: PlayerRatings },
): DesiredContract {
  const prev = currentSalary(player.contract);
  const overall = computeOverallForContract(player.ratings);

  const discountFactor = overall >= 55 ? 0.9 : overall >= 45 ? 0.8 : 0.7;
  const desired = Math.max(prev * discountFactor, CONTRACT_MINIMUM_SALARY);
  const years = overall >= 55 ? 3 : overall >= 40 ? 2 : 1;

  return {
    type: desired >= CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_0_6 ? 'max' : 'veteran',
    desiredSalary: roundSalary(desired),
    desiredYears: years,
  };
}

/**
 * Convert a legacy contract shape (pre-Phase-2 placeholder) to the new Contract
 * model. Used at the SaveFile write boundary and in test/data script fixes.
 */
export function upgradeContractShape(old: {
  yearsRemaining: number;
  salaryPerYear: number;
  option?: string;
}): Contract {
  return {
    type: 'veteran',
    salarySchedule: Array.from(
      { length: Math.max(1, old.yearsRemaining) },
      () => Math.max(0, old.salaryPerYear),
    ),
    noTradeClause: false,
    option: old.option && old.option !== 'none'
      ? { type: old.option as 'player' | 'team', year: Math.max(0, old.yearsRemaining - 1) }
      : undefined,
  };
}

/**
 * Ensure every player in a SaveFile has a valid new-shape Contract. Called
 * at the SaveFile write boundary so fresh saves from legacy data don't
 * claim the current schema version with stale contract shapes.
 *
 * - If a player's contract already has a `type` field, it's already new-shape.
 * - Otherwise, upgrade it via upgradeContractShape.
 * - Also repairs FA pool: ensures any player with teamId === '' is in the pool.
 */
export function normalizePlayersForSave(
  players: Player[],
  freeAgentPool: string[],
): { players: Player[]; freeAgentPool: string[] } {
  const poolSet = new Set(freeAgentPool);
  const repairedPool = [...freeAgentPool];

  const normalized = players.map((p) => {
    // Repair FA pool membership
    if (p.teamId === FREE_AGENT_TEAM_ID && !poolSet.has(p.id)) {
      poolSet.add(p.id);
      repairedPool.push(p.id);
    }

    // Already new-shape: has a string `type` field
    if (typeof (p.contract as unknown as Record<string, unknown>).type === 'string') {
      return p;
    }

    // Legacy shape — upgrade
    const old = p.contract as unknown as {
      yearsRemaining: number;
      salaryPerYear: number;
      option?: string;
    };
    return { ...p, contract: upgradeContractShape(old) };
  });

  return { players: normalized, freeAgentPool: repairedPool };
}

/** Average of all rating values — for contract tier purposes only, NOT for sim. */
function computeOverallForContract(ratings: PlayerRatings): number {
  const values = Object.values(ratings) as number[];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Round salary to the nearest $100K (0.1M). Salaries in millions with
 * sub-$100K precision are unrealistic and noisy.
 */
function roundSalary(millions: number): number {
  return Math.round(millions * 10) / 10;
}
