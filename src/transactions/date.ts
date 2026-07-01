const CANONICAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate a real proleptic-Gregorian date without local-time Date behavior. */
export function isCanonicalDate(value: string): boolean {
  const match = CANONICAL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function parts(value: string): [number, number, number] {
  if (!isCanonicalDate(value)) throw new Error(`invalid canonical date "${value}"`);
  const [year, month, day] = value.split('-').map(Number);
  return [year, month, day];
}

/** Salary-cap year is identified by the calendar year in which July 1 occurs. */
export function capYearForDate(date: string): number {
  const [year, month] = parts(date);
  return month < 7 ? year - 1 : year;
}

/** Add one calendar year; February 29 becomes February 28 in a non-leap year. */
export function addOneCalendarYear(date: string): string {
  const [year, month, day] = parts(date);
  const nextYear = year + 1;
  const nextDay = month === 2 && day === 29 ? 28 : day;
  return `${String(nextYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

export function capYearOffset(earlierDate: string, laterDate: string): number {
  return capYearForDate(laterDate) - capYearForDate(earlierDate);
}
