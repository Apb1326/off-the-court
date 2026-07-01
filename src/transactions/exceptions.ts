import { SigningException, SigningMechanism } from '@/models/transaction';
import { capYearForDate } from './date';
import {
  BAE_MAX_YEARS,
  BI_ANNUAL_EXCEPTION,
  MONEY_EPSILON,
  NON_TAXPAYER_MLE,
  NON_TAXPAYER_MLE_MAX_YEARS,
  ROOM_MLE,
  ROOM_MLE_MAX_YEARS,
  TAXPAYER_MLE,
  TAXPAYER_MLE_MAX_YEARS,
} from './constants';
import { computeCapRoom } from './cap';
import { RosterWorld } from './world';

export interface AvailableSigningException {
  type: SigningException;
  remainingAmount: number;
  maxYears: number;
}

const DETAILS: Record<SigningException, { amount: number; maxYears: number }> = {
  non_taxpayer_mle: { amount: NON_TAXPAYER_MLE, maxYears: NON_TAXPAYER_MLE_MAX_YEARS },
  taxpayer_mle: { amount: TAXPAYER_MLE, maxYears: TAXPAYER_MLE_MAX_YEARS },
  room_mle: { amount: ROOM_MLE, maxYears: ROOM_MLE_MAX_YEARS },
  bae: { amount: BI_ANNUAL_EXCEPTION, maxYears: BAE_MAX_YEARS },
};

const ORDER: SigningException[] = ['non_taxpayer_mle', 'taxpayer_mle', 'room_mle', 'bae'];

export function computeSigningMechanismUsed(
  world: RosterWorld,
  teamId: string,
  mechanism: SigningMechanism,
  capYear: number,
): number {
  return [...world.season.transactionLog]
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)
    .reduce((sum, entry) => entry.type === 'sign' && entry.toTeamId === teamId &&
      entry.signingMechanism === mechanism && capYearForDate(entry.date) === capYear
      ? sum + (entry.contractSigned?.salarySchedule[0] ?? 0)
      : sum, 0);
}

export function getAvailableSigningExceptions(
  teamId: string,
  world: RosterWorld,
  asOfDate = world.season.currentDate,
): AvailableSigningException[] {
  if (computeCapRoom(world, teamId) > MONEY_EPSILON) return [];
  const year = capYearForDate(asOfDate);
  const operatedUnderCap = world.season.teamExceptionStates.some((state) =>
    state.teamId === teamId && state.capYear === year && state.operatedUnderCap);
  const used = (mechanism: SigningMechanism, atYear = year) =>
    computeSigningMechanismUsed(world, teamId, mechanism, atYear);
  const usedNtmle = used('non_taxpayer_mle') > MONEY_EPSILON;
  const usedTmle = used('taxpayer_mle') > MONEY_EPSILON;
  const usedRoom = used('room_mle') > MONEY_EPSILON;
  const usedBae = used('bae') > MONEY_EPSILON;
  const previousBae = used('bae', year - 1) > MONEY_EPSILON;

  return ORDER.flatMap((type): AvailableSigningException[] => {
    const details = DETAILS[type];
    const remainingAmount = Math.max(0, details.amount - used(type));
    if (remainingAmount <= MONEY_EPSILON) return [];
    if (operatedUnderCap) return type === 'room_mle' && !usedNtmle && !usedTmle && !usedBae
      ? [{ type, remainingAmount, maxYears: details.maxYears }]
      : [];
    if (type === 'room_mle') return usedRoom ? [{ type, remainingAmount, maxYears: details.maxYears }] : [];
    if (usedRoom) return [];
    if (type === 'non_taxpayer_mle' && usedTmle) return [];
    if (type === 'taxpayer_mle' && (usedNtmle || usedBae)) return [];
    if (type === 'bae' && (usedTmle || previousBae)) return [];
    return [{ type, remainingAmount, maxYears: details.maxYears }];
  });
}
