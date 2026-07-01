/**
 * Contract utilities (transactions Phase 2).
 *
 * Helpers for working with the expanded contract model: current-year salary,
 * years remaining, contract instantiation from desired-contract, and the
 * cap-hold stub.
 */

import {
  Contract,
  ContractType,
  DesiredContract,
  Player,
  PlayerRatings,
  ReSigningRights,
} from '@/models/player';
import { Team } from '@/models/team';
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
  CONTRACT_ROOKIE_SCALE_CAP_FRACTION,
  CONTRACT_VETERAN_MAX_FRACTION,
  MINIMUM_EXCEPTION_MAX_YEARS,
  ROOKIE_MINIMUM_SALARY,
} from './constants';

const CONTRACT_TYPES: ReadonlySet<ContractType> = new Set([
  'rookie_scale',
  'veteran',
  'max',
  'minimum',
  'two_way',
]);

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

/** Structural invariants required before a desired deal can be instantiated. */
export function validateDesiredContract(
  desired: DesiredContract,
): { ok: true } | { ok: false; reason: string } {
  if (!CONTRACT_TYPES.has(desired.type)) {
    return { ok: false, reason: `unknown desired contract type "${desired.type}"` };
  }
  if (!Number.isFinite(desired.desiredSalary) || desired.desiredSalary <= 0) {
    return { ok: false, reason: 'desiredSalary must be finite and positive' };
  }
  const maxYears = desired.type === 'two_way' ? CONTRACT_TWO_WAY_MAX_YEARS : CONTRACT_MAX_YEARS;
  if (
    !Number.isInteger(desired.desiredYears) ||
    desired.desiredYears < 1 ||
    desired.desiredYears > maxYears
  ) {
    return { ok: false, reason: `desiredYears must be an integer in [1, ${maxYears}]` };
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
  const desiredValidation = validateDesiredContract(desired);
  if (!desiredValidation.ok) {
    throw new Error(`cannot instantiate invalid desired contract: ${desiredValidation.reason}`);
  }
  const years = desired.desiredYears;
  const c: Contract = {
    type: desired.type,
    salarySchedule: Array.from(
      { length: years },
      () => desired.desiredSalary,
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
  // Preserve a genuine minimum-contract ask as a minimum ask. Phase 4's
  // minimum exception is keyed to contract type, so an arbitrary cheap veteran
  // deal must never be silently reclassified as minimum.
  if (player.contract.type === 'minimum') {
    return {
      type: 'minimum',
      desiredSalary: ROOKIE_MINIMUM_SALARY,
      desiredYears: Math.min(
        Math.max(1, player.contract.salarySchedule.length),
        MINIMUM_EXCEPTION_MAX_YEARS,
      ),
    };
  }
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
 * Phase 4's deterministic re-signing-rights proxy for a player being cut.
 *
 * The game does not yet retain team-tenure history, so contract type and NBA
 * experience stand in for it. This is a game simplification, not a claim that
 * real NBA Bird rights derive from contract type.
 */
export function deriveReSigningRightsForCut(
  contract: Contract,
  experience: number,
  teamId: string,
): ReSigningRights {
  let type: ReSigningRights['type'];

  switch (contract.type) {
    case 'rookie_scale':
    case 'max':
      type = 'bird';
      break;
    case 'veteran':
      type = experience >= 3
        ? 'bird'
        : experience >= 1
          ? 'early_bird'
          : 'non_bird';
      break;
    case 'two_way':
    case 'minimum':
    default:
      type = 'non_bird';
      break;
  }

  return { teamId, type };
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
      CONTRACT_MINIMUM_SALARY +
        (overall / 80) *
          (CONTRACT_ROOKIE_SCALE_CAP_FRACTION * CONTRACT_REFERENCE_CAP -
            CONTRACT_MINIMUM_SALARY),
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
      CONTRACT_MINIMUM_SALARY +
        fraction * (CONTRACT_VETERAN_MAX_FRACTION * maxEligible - CONTRACT_MINIMUM_SALARY),
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
 * - Unsigned players get a valid desiredContract; rostered players do not retain one.
 * - Rebuilds the canonical FA pool from roster ownership and repairs teamId back-references.
 * - Rejects missing roster players and players appearing on multiple rosters.
 */
export function normalizePlayersForSave(
  players: Player[],
  _freeAgentPool: string[],
  teams: Team[],
): { players: Player[]; freeAgentPool: string[] } {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const ownerByPlayerId = new Map<string, string>();

  for (const team of teams) {
    for (const playerId of team.roster) {
      if (!playersById.has(playerId)) {
        throw new Error(`cannot normalize roster: ${team.id} references missing player "${playerId}"`);
      }
      const existingOwner = ownerByPlayerId.get(playerId);
      if (existingOwner) {
        throw new Error(
          `cannot normalize roster: player "${playerId}" appears on multiple rosters (${existingOwner}, ${team.id})`,
        );
      }
      ownerByPlayerId.set(playerId, team.id);
    }
  }

  const normalized = players.map((p) => {
    const ownerTeamId = ownerByPlayerId.get(p.id);
    const isFreeAgent = ownerTeamId === undefined;
    const contract = typeof (p.contract as unknown as Record<string, unknown>).type === 'string'
      ? p.contract
      : generateContractForPlayer(p);
    const contractValidation = validateContract(contract);
    if (!contractValidation.ok) {
      throw new Error(`cannot normalize player "${p.id}": ${contractValidation.reason}`);
    }

    const existingDesiredValidation = p.desiredContract
      ? validateDesiredContract(p.desiredContract)
      : undefined;
    const staleMinimumAsk = contract.type === 'minimum' && (
      p.desiredContract?.type !== 'minimum' ||
      p.desiredContract.desiredSalary !== ROOKIE_MINIMUM_SALARY ||
      p.desiredContract.desiredYears > MINIMUM_EXCEPTION_MAX_YEARS
    );
    const desiredContract = isFreeAgent
      ? existingDesiredValidation?.ok && !staleMinimumAsk
        ? p.desiredContract
        : generateDesiredContract({ contract, ratings: p.ratings })
      : undefined;

    if (isFreeAgent) {
      return {
        ...p,
        teamId: FREE_AGENT_TEAM_ID,
        contract,
        desiredContract,
      };
    }

    // Rostered players can never carry free-agent re-signing rights. Omit the
    // key entirely so canonical JSON does not depend on serializing undefined.
    const withoutBirdRights = { ...p };
    delete withoutBirdRights.birdRights;
    return {
      ...withoutBirdRights,
      teamId: ownerTeamId,
      contract,
      desiredContract,
    };
  });

  // Rebuild from roster ownership: this removes stale, duplicate, and missing IDs and
  // includes every genuinely unsigned player in a deterministic order.
  const freeAgentPool = normalized
    .filter((player) => player.teamId === FREE_AGENT_TEAM_ID)
    .map((player) => player.id)
    .sort();

  return { players: normalized, freeAgentPool };
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
