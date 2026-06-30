/**
 * Contract utilities (transactions Phase 2).
 *
 * Helpers for working with the expanded contract model: current-year salary,
 * years remaining, contract instantiation from desired-contract, and the
 * cap-hold stub.
 */

import { Contract, DesiredContract, Player, PlayerRatings } from '@/models/player';
import { SeededRNG } from '@/lib/rng';
import { fnv1a } from '@/lib/hash';
import {
  FREE_AGENT_TEAM_ID,
  CONTRACT_MINIMUM_SALARY,
  CONTRACT_TWO_WAY_SALARY,
  CONTRACT_TWO_WAY_MAX_YEARS,
  CONTRACT_ROOKIE_SCALE_YEARS,
  CONTRACT_MAX_YEARS,
  CONTRACT_REFERENCE_CAP,
  CONTRACT_MAX_PCT_0_6,
  CONTRACT_MAX_PCT_7_9,
  CONTRACT_MAX_PCT_10_PLUS,
  CONTRACT_NTC_MIN_EXPERIENCE,
  CONTRACT_NTC_SALARY_FLOOR,
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
  if (c.type === 'two_way' && c.salarySchedule.length > CONTRACT_TWO_WAY_MAX_YEARS)
    return { ok: false, reason: `two-way contract exceeds ${CONTRACT_TWO_WAY_MAX_YEARS}-year limit (got ${c.salarySchedule.length})` };
  if (c.salarySchedule.length > CONTRACT_MAX_YEARS)
    return { ok: false, reason: `contract exceeds ${CONTRACT_MAX_YEARS}-year limit (got ${c.salarySchedule.length})` };
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
  const maxYears = desired.type === 'two_way' ? CONTRACT_TWO_WAY_MAX_YEARS : CONTRACT_MAX_YEARS;
  const years = Math.min(Math.max(1, Math.round(desired.desiredYears)), maxYears);
  const c: Contract = {
    type: desired.type,
    salarySchedule: Array.from(
      { length: years },
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
 *
 * Phase 3 must: accept a rights-owning teamId, look up Bird/Early-Bird/Non-Bird
 * status and years of service, and return a hold that can be charged to that
 * team's cap sheet. This stub establishes the seam; the signature will change.
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
 * Generate a plausible contract for a player based on their ratings, age, and
 * experience. Deterministic: seeded per-player from fnv1a(player.id).
 *
 * Strict precedence: two-way → rookie-scale → minimum → max → veteran.
 * Used by both the v2→v3 migration and the fresh-save normalization path
 * so every player gets the same tier-appropriate contract regardless of
 * which code path creates it.
 */
export function generateContractForPlayer(player: Player): Contract {
  const rng = new SeededRNG(fnv1a(player.id));
  const overall = computeOverallForContract(player.ratings);
  const { age, experience } = player;
  const maxEligible = maxEligibleSalary(experience);

  // 1. TWO-WAY: low-rated young players
  if (overall < 32 && experience <= 2) {
    return {
      type: 'two_way',
      salarySchedule: Array.from(
        { length: rng.nextInt(1, CONTRACT_TWO_WAY_MAX_YEARS) },
        () => CONTRACT_TWO_WAY_SALARY,
      ),
      noTradeClause: false,
    };
  }

  // 2. ROOKIE-SCALE: young, inexperienced
  if (experience <= 3 && age <= 23) {
    const salary = roundSalary(
      CONTRACT_MINIMUM_SALARY + (overall / 80) * (0.15 * CONTRACT_REFERENCE_CAP - CONTRACT_MINIMUM_SALARY),
    );
    const hasOption = rng.nextBool(0.5);
    const years = CONTRACT_ROOKIE_SCALE_YEARS;
    return {
      type: 'rookie_scale',
      salarySchedule: Array.from({ length: years }, () => salary),
      noTradeClause: false,
      option: hasOption ? { type: 'team', year: years - 1 } : undefined,
    };
  }

  // 3. MINIMUM: low-rated or old
  if (overall < 35 || age >= 36) {
    const years = ageAdjustedYears(rng.nextInt(1, 2), age);
    return {
      type: 'minimum',
      salarySchedule: Array.from({ length: years }, () => CONTRACT_MINIMUM_SALARY),
      noTradeClause: false,
    };
  }

  // 4. MAX: stars
  if (overall >= 60) {
    const salary = roundSalary(maxEligible);
    const baseYears = rng.nextInt(3, CONTRACT_MAX_YEARS);
    const years = ageAdjustedYears(baseYears, age);

    const ntcEligible =
      experience >= CONTRACT_NTC_MIN_EXPERIENCE &&
      salary >= CONTRACT_NTC_SALARY_FLOOR * maxEligible;
    const noTradeClause = ntcEligible && rng.nextBool(0.5);

    const hasOption = rng.nextBool(0.3);
    const optionType = rng.nextBool(0.5) ? 'player' as const : 'team' as const;

    return {
      type: 'max',
      salarySchedule: Array.from({ length: years }, () => salary),
      noTradeClause,
      option: hasOption && years > 1 ? { type: optionType, year: years - 1 } : undefined,
    };
  }

  // 5. VETERAN: everything else
  {
    const fraction = (overall - 35) / (60 - 35);
    const salary = roundSalary(
      CONTRACT_MINIMUM_SALARY + fraction * (0.8 * maxEligible - CONTRACT_MINIMUM_SALARY),
    );
    const baseYears = rng.nextInt(1, CONTRACT_MAX_YEARS);
    const years = ageAdjustedYears(baseYears, age);

    const hasOption = rng.nextBool(0.2);
    const optionType = rng.nextBool(0.5) ? 'player' as const : 'team' as const;

    return {
      type: 'veteran',
      salarySchedule: Array.from({ length: years }, () => salary),
      noTradeClause: false,
      option: hasOption && years > 1 ? { type: optionType, year: years - 1 } : undefined,
    };
  }
}

/** Max-eligible salary by experience bracket. */
function maxEligibleSalary(experience: number): number {
  if (experience >= 10) return CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_10_PLUS;
  if (experience >= 7) return CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_7_9;
  return CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_0_6;
}

/** Clamp years by age: older players get fewer remaining years. */
function ageAdjustedYears(years: number, age: number): number {
  return Math.min(years, Math.max(1, CONTRACT_MAX_YEARS - Math.max(0, age - 30)));
}

/**
 * Ensure every player in a SaveFile has a valid new-shape Contract. Called
 * at the SaveFile write boundary so fresh saves from legacy data don't
 * claim the current schema version with stale contract shapes.
 *
 * - If a player's contract already has a `type` field, it's already new-shape.
 * - Otherwise, runs the full tier-based contract generation (same logic as
 *   the v2→v3 migration) so players get plausible contracts, not generic veterans.
 * - FA-pool players get a desiredContract.
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

    // Legacy shape — run full tier-based generation
    const contract = generateContractForPlayer(p);
    const isFreeAgent = p.teamId === FREE_AGENT_TEAM_ID;
    const desiredContract = isFreeAgent
      ? generateDesiredContract({ contract, ratings: p.ratings })
      : undefined;

    return { ...p, contract, desiredContract };
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
