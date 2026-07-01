import { CutEntry } from '@/models/transaction';
import { RosterWorld } from './world';
import { capYearOffset, isCanonicalDate } from './date';

/** Derive waived-contract charges from immutable cuts in stable reduction order. */
export function computeDeadMoney(
  world: RosterWorld,
  teamId: string,
  asOfDate = world.season.currentDate,
): number {
  if (!isCanonicalDate(asOfDate)) throw new Error(`cannot compute dead money for invalid date "${asOfDate}"`);
  const cuts = world.season.transactionLog
    .filter((entry): entry is CutEntry =>
      entry.type === 'cut' && entry.fromTeamId === teamId && entry.contractAtCut !== undefined)
    .sort((a, b) =>
      a.date.localeCompare(b.date) || a.seq - b.seq || a.playerId.localeCompare(b.playerId));

  return cuts.reduce((total, entry) => {
    const contract = entry.contractAtCut!;
    if (contract.type === 'two_way') return total;
    const offset = capYearOffset(entry.date, asOfDate);
    if (offset < 0) return total;
    if (!entry.stretchApplied) return total + (contract.salarySchedule[offset] ?? 0);
    const years = contract.salarySchedule.length;
    const stretchYears = 2 * years + 1;
    if (offset >= stretchYears) return total;
    const guaranteed = contract.salarySchedule.reduce((sum, salary) => sum + salary, 0);
    return total + guaranteed / stretchYears;
  }, 0);
}
