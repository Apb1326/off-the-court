import { ScheduledGame, SeasonMarker } from '@/models/season';

/**
 * Maps the schedule's ordinal "day" slots onto a real NBA-style calendar
 * (late October through mid-April) and places the season's milestone markers —
 * tip-off, trade deadline, the All-Star break, and the regular-season finale.
 */

export const DEFAULT_SEASON_START = '2024-10-22';

const DAYS_PER_SLOT = 1.05;         // ~160 game-days over ~170 calendar days (a few off-nights)
const BREAK_SLOT_FRACTION = 0.64;   // All-Star break lands ~64% through the slate
const ALL_STAR_BREAK_DAYS = 6;      // no games during the break

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive whole-day difference (b - a) in days. */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86_400_000);
}

export interface Calendar {
  startDate: string;
  endDate: string;
  markers: SeasonMarker[];
}

/**
 * Assigns a real date to every scheduled game (mutating `date` in place) and
 * returns the calendar bounds and markers.
 */
export function buildCalendar(schedule: ScheduledGame[], startDate = DEFAULT_SEASON_START): Calendar {
  const slots = schedule.reduce((m, g) => Math.max(m, g.day), 0) + 1;
  const breakSlot = Math.floor(slots * BREAK_SLOT_FRACTION);

  const slotOffset = (slot: number): number => {
    const base = Math.round(slot * DAYS_PER_SLOT);
    return slot >= breakSlot ? base + ALL_STAR_BREAK_DAYS : base;
  };

  for (const g of schedule) {
    g.date = addDays(startDate, slotOffset(g.day));
  }

  const endDate = addDays(startDate, slotOffset(slots - 1));
  const breakStart = Math.round(breakSlot * DAYS_PER_SLOT); // calendar offset where the gap opens

  const markers: SeasonMarker[] = [
    { type: 'season_start', date: addDays(startDate, slotOffset(0)), label: 'Season Tip-Off' },
    { type: 'trade_deadline', date: addDays(startDate, Math.max(0, breakStart - 4)), label: 'Trade Deadline' },
    { type: 'all_star_break', date: addDays(startDate, breakStart), label: 'All-Star Break' },
    { type: 'all_star_game', date: addDays(startDate, breakStart + 3), label: 'All-Star Game' },
    { type: 'season_end', date: endDate, label: 'Regular Season Finale' },
  ];

  return { startDate, endDate, markers };
}
