import { ReSigningRightsType } from '@/models/player';
import { SigningException, SigningMechanism } from '@/models/transaction';
import { getPlayer, RosterWorld } from './world';
import {
  BIRD_MAX_YEARS,
  CONTRACT_MAX_PCT_0_6,
  CONTRACT_MAX_PCT_10_PLUS,
  CONTRACT_MAX_PCT_7_9,
  EARLY_BIRD_AVERAGE_SALARY_MULTIPLIER,
  EARLY_BIRD_MAX_YEARS,
  EARLY_BIRD_MIN_YEARS,
  EARLY_BIRD_PREVIOUS_SALARY_MULTIPLIER,
  ESTIMATED_AVERAGE_PLAYER_SALARY_2024_25,
  MINIMUM_EXCEPTION_MAX_YEARS,
  MAX_PREVIOUS_SALARY_MULTIPLIER,
  NON_BIRD_MAX_YEARS,
  NON_BIRD_SALARY_MULTIPLIER,
  ROOKIE_MINIMUM_SALARY,
  ROOM_SIGNING_MAX_YEARS,
  SALARY_CAP,
} from './constants';
import { currentSalary } from './contracts';
import {
  projectPostSigningApronPayroll,
  projectPostSigningCapRoomSalary,
} from './cap';
import { getAvailableSigningExceptions } from './exceptions';

const MONEY_EPSILON = 1e-9;

export interface SigningPlan {
  mechanism: SigningMechanism;
  projectedCapRoomSalary: number;
  projectedApronPayroll: number;
  maximumSalary?: number;
  triggeredHardCap?: 'first_apron' | 'second_apron';
}

export type SigningAnalysis =
  | { ok: true; plan: SigningPlan }
  | { ok: false; reason: string };

/** General first-year maximum salary under the simplified contract model. */
export function maximumSalaryForPlayer(experience: number, priorSalary: number): number {
  const percentage = experience >= 10
    ? CONTRACT_MAX_PCT_10_PLUS
    : experience >= 7
      ? CONTRACT_MAX_PCT_7_9
      : CONTRACT_MAX_PCT_0_6;
  return Math.max(SALARY_CAP * percentage, priorSalary * MAX_PREVIOUS_SALARY_MULTIPLIER);
}

export function maximumSalaryForRights(
  rightsType: ReSigningRightsType,
  experience: number,
  priorSalary: number,
): number {
  const generalMaximum = maximumSalaryForPlayer(experience, priorSalary);
  if (rightsType === 'bird') return generalMaximum;
  if (rightsType === 'early_bird') {
    return Math.min(
      generalMaximum,
      Math.max(
        priorSalary * EARLY_BIRD_PREVIOUS_SALARY_MULTIPLIER,
        ESTIMATED_AVERAGE_PLAYER_SALARY_2024_25 *
          EARLY_BIRD_AVERAGE_SALARY_MULTIPLIER,
      ),
    );
  }
  return Math.min(
    generalMaximum,
    Math.max(
      priorSalary * NON_BIRD_SALARY_MULTIPLIER,
      ROOKIE_MINIMUM_SALARY * NON_BIRD_SALARY_MULTIPLIER,
    ),
  );
}

function rightsTermIsValid(type: ReSigningRightsType, years: number): boolean {
  if (type === 'bird') return years <= BIRD_MAX_YEARS;
  if (type === 'early_bird') {
    return years >= EARLY_BIRD_MIN_YEARS && years <= EARLY_BIRD_MAX_YEARS;
  }
  return years <= NON_BIRD_MAX_YEARS;
}

function validMinimumException(
  type: string,
  salary: number,
  years: number,
): boolean {
  // The current game model intentionally has one flat configured minimum
  // rather than the CBA's experience-indexed minimum salary scale.
  return type === 'minimum' &&
    years <= MINIMUM_EXCEPTION_MAX_YEARS &&
    Math.abs(salary - ROOKIE_MINIMUM_SALARY) <= MONEY_EPSILON;
}

/**
 * Choose the least restrictive legal signing mechanism. Room comes first;
 * over-cap teams then try their own explicit rights and finally the minimum
 * salary exception. MLE/BAE/Room MLE remain Phase 5a.
 */
export function analyzeSigning(
  world: RosterWorld,
  teamId: string,
  playerId: string,
  exception?: SigningException,
): SigningAnalysis {
  const player = getPlayer(world, playerId);
  if (!player?.desiredContract) {
    return { ok: false, reason: `player "${playerId}" has no desired contract` };
  }

  const projectedCapRoomSalary = projectPostSigningCapRoomSalary(world, teamId, playerId);
  const projectedApronPayroll = projectPostSigningApronPayroll(world, teamId, playerId);
  const desired = player.desiredContract;
  const priorSalary = currentSalary(player.contract);
  const generalMaximum = maximumSalaryForPlayer(player.experience, priorSalary);
  if (desired.desiredSalary > generalMaximum + MONEY_EPSILON) {
    return {
      ok: false,
      reason: `player "${playerId}" may receive at most $${generalMaximum.toFixed(3)}M in year one`,
    };
  }
  if (exception) {
    if (desired.type === 'two_way') {
      return { ok: false, reason: `${exception} cannot be used for a two-way contract` };
    }
    const available = getAvailableSigningExceptions(teamId, world)
      .find((candidate) => candidate.type === exception);
    if (!available) return { ok: false, reason: `${exception} is not available to ${teamId}` };
    if (desired.desiredSalary > available.remainingAmount + MONEY_EPSILON) {
      return { ok: false, reason: `${exception} has only $${available.remainingAmount.toFixed(3)}M remaining` };
    }
    if (desired.desiredYears > available.maxYears) {
      return { ok: false, reason: `${exception} permits at most ${available.maxYears} years` };
    }
    const triggeredHardCap = exception === 'non_taxpayer_mle' || exception === 'bae'
      ? 'first_apron' as const
      : exception === 'taxpayer_mle'
        ? 'second_apron' as const
        : undefined;
    return { ok: true, plan: {
      mechanism: exception,
      projectedCapRoomSalary,
      projectedApronPayroll,
      maximumSalary: available.remainingAmount,
      ...(triggeredHardCap ? { triggeredHardCap } : {}),
    } };
  }
  if (
    projectedCapRoomSalary <= SALARY_CAP + MONEY_EPSILON &&
    desired.desiredYears <= ROOM_SIGNING_MAX_YEARS
  ) {
    return { ok: true, plan: {
      mechanism: 'room', projectedCapRoomSalary, projectedApronPayroll,
    } };
  }

  const rights = player.birdRights?.teamId === teamId ? player.birdRights : undefined;
  let rightsFailure: string | undefined;
  if (rights) {
    const maximumSalary = maximumSalaryForRights(rights.type, player.experience, priorSalary);
    if (!rightsTermIsValid(rights.type, desired.desiredYears)) {
      rightsFailure = `${rights.type} rights do not permit a ${desired.desiredYears}-year contract`;
    } else if (desired.desiredSalary > maximumSalary + MONEY_EPSILON) {
      rightsFailure = `${rights.type} rights permit at most $${maximumSalary.toFixed(3)}M in year one`;
    } else {
      return { ok: true, plan: {
        mechanism: rights.type,
        projectedCapRoomSalary,
        projectedApronPayroll,
        maximumSalary,
      } };
    }
  }

  if (validMinimumException(desired.type, desired.desiredSalary, desired.desiredYears)) {
    return { ok: true, plan: {
      mechanism: 'minimum_exception', projectedCapRoomSalary, projectedApronPayroll,
      maximumSalary: ROOKIE_MINIMUM_SALARY,
    } };
  }

  const fallbackReason = projectedCapRoomSalary <= SALARY_CAP + MONEY_EPSILON
    ? `room signings may not exceed ${ROOM_SIGNING_MAX_YEARS} years`
    : `${teamId} has insufficient cap room and no applicable signing exception for ${playerId}`;
  return { ok: false, reason: rightsFailure ?? fallbackReason };
}
