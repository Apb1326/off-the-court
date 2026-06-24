import {
  QUARTER_LENGTH_SECONDS,
  OVERTIME_LENGTH_SECONDS,
  SHOT_CLOCK_SECONDS,
} from './constants';

export interface ClockState {
  quarter: number;
  gameClock: number; // seconds remaining in period
  shotClock: number;
}

export function initClock(): ClockState {
  return {
    quarter: 1,
    gameClock: QUARTER_LENGTH_SECONDS,
    shotClock: SHOT_CLOCK_SECONDS,
  };
}

export function advanceClock(clock: ClockState, elapsed: number): ClockState {
  const newGameClock = Math.max(0, clock.gameClock - elapsed);
  const newShotClock = Math.max(0, clock.shotClock - elapsed);
  return {
    ...clock,
    gameClock: newGameClock,
    shotClock: newShotClock,
  };
}

export function resetShotClock(clock: ClockState, full: boolean = true): ClockState {
  const resetTo = full ? SHOT_CLOCK_SECONDS : 14;
  return {
    ...clock,
    shotClock: Math.min(resetTo, clock.gameClock),
  };
}

export function isEndOfPeriod(clock: ClockState): boolean {
  return clock.gameClock <= 0;
}

export function nextPeriod(clock: ClockState): ClockState | null {
  const nextQ = clock.quarter + 1;
  if (nextQ <= 4) {
    return {
      quarter: nextQ,
      gameClock: QUARTER_LENGTH_SECONDS,
      shotClock: SHOT_CLOCK_SECONDS,
    };
  }
  // Overtime
  return {
    quarter: nextQ,
    gameClock: OVERTIME_LENGTH_SECONDS,
    shotClock: SHOT_CLOCK_SECONDS,
  };
}

export function isShotClockViolation(clock: ClockState): boolean {
  return clock.shotClock <= 0 && clock.gameClock > 0;
}

export function isRegulationOver(quarter: number): boolean {
  return quarter > 4;
}
