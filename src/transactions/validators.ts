import { RosterWorld, getTeam, getPlayer } from './world';
import { ROSTER_MIN, ROSTER_MAX } from './constants';
import { validateDesiredContract } from './contracts';
import { TradeProposal } from '@/models/transaction';
import { Team } from '@/models/team';
import { TradeMatchingAnalysis, TradeMatchingPlan } from './cap';
import { maximumSalaryForRights, SigningAnalysis, SigningPlan } from './financial';
import {
  BIRD_MAX_YEARS,
  EARLY_BIRD_MAX_YEARS,
  EARLY_BIRD_MIN_YEARS,
  FIRST_APRON,
  MINIMUM_EXCEPTION_MAX_YEARS,
  NON_BIRD_MAX_YEARS,
  ROOKIE_MINIMUM_SALARY,
  SECOND_APRON,
} from './constants';
import { currentSalary } from './contracts';

/**
 * Roster-legality validators for the transaction gate.
 *
 * Each validator is an independent predicate returning a unified `ValidationResult` — never
 * a nested conditional. The gate composes them with `runValidators`, which returns the first
 * failure (with its reason) or success. Phase 1 is roster-legality only; later phases add
 * cap-, apron-, and temporal-legality predicate sets composed the same way.
 */

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export const VALID: ValidationResult = { ok: true };

export function invalid(reason: string): ValidationResult {
  return { ok: false, reason };
}

/**
 * Run independent predicates in order; return the first failure or `VALID`. Predicates are
 * supplied as thunks so the gate can build the list (including per-player checks) declaratively.
 */
export function runValidators(checks: Array<() => ValidationResult>): ValidationResult {
  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }
  return VALID;
}

// --- individual predicates ---

export function teamExists(world: RosterWorld, teamId: string): ValidationResult {
  return getTeam(world, teamId) ? VALID : invalid(`team "${teamId}" does not exist`);
}

export function playerExists(world: RosterWorld, playerId: string): ValidationResult {
  return getPlayer(world, playerId) ? VALID : invalid(`player "${playerId}" does not exist`);
}

export function teamsDistinct(teamA: string, teamB: string): ValidationResult {
  return teamA !== teamB
    ? VALID
    : invalid(`a trade needs two different teams (both sides were "${teamA}")`);
}

export function playerOnRoster(
  world: RosterWorld,
  teamId: string,
  playerId: string,
): ValidationResult {
  const team = getTeam(world, teamId);
  if (!team) return invalid(`team "${teamId}" does not exist`);
  return team.roster.includes(playerId)
    ? VALID
    : invalid(`player "${playerId}" is not on ${teamId}'s roster`);
}

export function playerInFreeAgentPool(world: RosterWorld, playerId: string): ValidationResult {
  return world.season.freeAgentPool.includes(playerId)
    ? VALID
    : invalid(`player "${playerId}" is not in the free-agent pool`);
}

export function playerHasTeamId(
  world: RosterWorld,
  playerId: string,
  expectedTeamId: string,
): ValidationResult {
  const player = getPlayer(world, playerId);
  if (!player) return invalid(`player "${playerId}" does not exist`);
  return player.teamId === expectedTeamId
    ? VALID
    : invalid(`player "${playerId}" has stale teamId "${player.teamId}"`);
}

export function playerAbsentFromAllRosters(
  world: RosterWorld,
  playerId: string,
): ValidationResult {
  const owner = world.teams.find((team) => team.roster.includes(playerId));
  return owner
    ? invalid(`player "${playerId}" is still rostered by ${owner.id}`)
    : VALID;
}

export function playerHasValidDesiredContract(
  world: RosterWorld,
  playerId: string,
): ValidationResult {
  const player = getPlayer(world, playerId);
  if (!player) return invalid(`player "${playerId}" does not exist`);
  if (!player.desiredContract) {
    return invalid(`player "${playerId}" has no desired contract`);
  }
  const result = validateDesiredContract(player.desiredContract);
  return result.ok
    ? VALID
    : invalid(`player "${playerId}" has invalid desired contract: ${result.reason}`);
}

/** No player id may appear more than once across the assets/ids being moved. */
export function noDuplicatePlayers(playerIds: string[]): ValidationResult {
  const seen = new Set<string>();
  for (const id of playerIds) {
    if (seen.has(id)) return invalid(`player "${id}" appears more than once in the transaction`);
    seen.add(id);
  }
  return VALID;
}

/**
 * The resulting roster size must stay within the standard bounds. Checks the ceiling and the
 * floor independently so the failure reason names the right limit.
 */
export function rosterWithinBounds(teamId: string, projectedSize: number): ValidationResult {
  if (projectedSize > ROSTER_MAX) {
    return invalid(
      `${teamId} would carry ${projectedSize} players, over the ${ROSTER_MAX}-man roster limit`,
    );
  }
  if (projectedSize < ROSTER_MIN) {
    return invalid(
      `${teamId} would carry ${projectedSize} players, under the ${ROSTER_MIN}-man roster minimum`,
    );
  }
  return VALID;
}

// --- Phase 4 financial / temporal peers ---

const CANONICAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Trading is legal through the deadline date and fails closed on invalid season state. */
export function tradeWindowOpen(world: RosterWorld): ValidationResult {
  const deadlines = world.season.markers.filter((marker) => marker.type === 'trade_deadline');
  if (deadlines.length !== 1) {
    return invalid(`season must contain exactly one trade-deadline marker (found ${deadlines.length})`);
  }
  const deadline = deadlines[0].date;
  if (!isCanonicalDate(world.season.currentDate) || !isCanonicalDate(deadline)) {
    return invalid('trade window requires canonical YYYY-MM-DD current and deadline dates');
  }
  return world.season.currentDate <= deadline
    ? VALID
    : invalid(`trading closed after the ${deadline} trade deadline`);
}

/** Only an NTC player leaving the controlled team requires explicit consent in Phase 4. */
export function noControlledTeamNtc(
  world: RosterWorld,
  proposal: TradeProposal,
  controlledTeamId?: string,
): ValidationResult {
  if (!controlledTeamId) return VALID;
  const outgoing = proposal.teamA === controlledTeamId
    ? proposal.assetsFromA
    : proposal.teamB === controlledTeamId
      ? proposal.assetsFromB
      : [];
  for (const asset of outgoing) {
    if (asset.kind !== 'player') continue;
    const player = getPlayer(world, asset.playerId);
    if (player?.contract.noTradeClause) {
      return invalid(`player "${player.id}" has a no-trade clause and cannot leave the controlled team`);
    }
  }
  return VALID;
}

export function tradeMatchingLegal(
  teamId: string,
  analysis: TradeMatchingAnalysis,
): ValidationResult {
  return analysis.ok ? VALID : invalid(`salary matching failed for ${teamId}: ${analysis.reason}`);
}

/** Mechanism-specific apron restrictions remain a peer of salary arithmetic. */
export function tradeMechanismApronLegal(
  teamId: string,
  plan: TradeMatchingPlan,
): ValidationResult {
  if (plan.mode === 'expanded' && plan.projectedApronPayroll > FIRST_APRON + 1e-9) {
    return invalid(`${teamId} cannot use the Expanded TPE above the first apron`);
  }
  if (plan.mode === 'aggregated_standard' && plan.projectedApronPayroll > SECOND_APRON + 1e-9) {
    return invalid(`${teamId} cannot aggregate salaries above the second apron`);
  }
  return VALID;
}

/** First-apron is stricter and can never be replaced by a second-apron trigger. */
export function stricterHardCap(
  existing: Team['hardCappedAtApron'],
  triggered: Team['hardCappedAtApron'],
): Team['hardCappedAtApron'] {
  if (existing === 'first_apron' || triggered === 'first_apron') return 'first_apron';
  return existing ?? triggered;
}

export function hardCapLegal(
  teamId: string,
  projectedTeamSalary: number,
  existing: Team['hardCappedAtApron'],
  triggered?: Team['hardCappedAtApron'],
): ValidationResult {
  const effective = stricterHardCap(existing, triggered);
  if (!effective) return VALID;
  const threshold = effective === 'first_apron' ? FIRST_APRON : SECOND_APRON;
  return projectedTeamSalary <= threshold + 1e-9
    ? VALID
    : invalid(`${teamId} would exceed its ${effective.replace('_', '-')} hard cap in Team Salary`);
}

export function signingCapOrExceptionLegal(
  teamId: string,
  analysis: SigningAnalysis,
): ValidationResult {
  return analysis.ok
    ? VALID
    : invalid(`signing cap compliance failed for ${teamId}: ${analysis.reason}`);
}

/** Independent rights salary/term predicate for a selected signing plan. */
export function reSigningRightsLegal(
  world: RosterWorld,
  teamId: string,
  playerId: string,
  plan: SigningPlan,
): ValidationResult {
  if (
    plan.mechanism !== 'bird' &&
    plan.mechanism !== 'early_bird' &&
    plan.mechanism !== 'non_bird'
  ) return VALID;
  const player = getPlayer(world, playerId);
  if (!player?.desiredContract || player.birdRights?.teamId !== teamId ||
      player.birdRights.type !== plan.mechanism) {
    return invalid(`player "${playerId}" lacks ${plan.mechanism} rights for ${teamId}`);
  }
  const years = player.desiredContract.desiredYears;
  const validTerm = plan.mechanism === 'bird'
    ? years <= BIRD_MAX_YEARS
    : plan.mechanism === 'early_bird'
      ? years >= EARLY_BIRD_MIN_YEARS && years <= EARLY_BIRD_MAX_YEARS
      : years <= NON_BIRD_MAX_YEARS;
  if (!validTerm) return invalid(`${plan.mechanism} rights do not permit a ${years}-year contract`);
  const maximum = maximumSalaryForRights(
    plan.mechanism,
    player.experience,
    currentSalary(player.contract),
  );
  return player.desiredContract.desiredSalary <= maximum + 1e-9
    ? VALID
    : invalid(`${plan.mechanism} rights permit at most $${maximum.toFixed(3)}M in year one`);
}

export function stretchElectionLegal(
  world: RosterWorld,
  playerId: string,
  stretch: boolean,
): ValidationResult {
  if (!stretch) return VALID;
  const player = getPlayer(world, playerId);
  return player?.contract.type === 'two_way'
    ? invalid('two-way contracts cannot use the stretch provision')
    : VALID;
}

/** Independent minimum-salary-exception predicate for a selected signing plan. */
export function minimumSalaryExceptionLegal(
  world: RosterWorld,
  playerId: string,
  plan: SigningPlan,
): ValidationResult {
  if (plan.mechanism !== 'minimum_exception') return VALID;
  const desired = getPlayer(world, playerId)?.desiredContract;
  if (!desired) return invalid(`player "${playerId}" has no desired contract`);
  return desired.type === 'minimum' &&
    desired.desiredYears <= MINIMUM_EXCEPTION_MAX_YEARS &&
    Math.abs(desired.desiredSalary - ROOKIE_MINIMUM_SALARY) <= 1e-9
    ? VALID
    : invalid('minimum salary exception requires a one- or two-year configured minimum contract');
}
