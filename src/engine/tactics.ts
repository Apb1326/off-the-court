import { ClockState } from './clock';

/**
 * Game-state awareness: lets the offense and defense adapt to score and time
 * the way real teams do — speeding up or milking clock, chasing threes when
 * desperate, and fouling on purpose to extend a game.
 */
export interface GameContext {
  scoreDiff: number;        // offense's perspective (+ = offense leading)
  secondsLeft: number;      // seconds remaining in the game (regulation/OT)
  quarter: number;
  isLate: boolean;          // final ~3 minutes
  isClutch: boolean;        // final 5 min, within one possession-ish
  trailingLate: boolean;    // offense down and late — push pace, hunt threes
  leadingLate: boolean;     // offense up and late — milk clock
}

export function buildContext(clock: ClockState, scoreDiff: number): GameContext {
  const periodsLeftBefore = clock.quarter <= 4 ? 4 - clock.quarter : 0;
  const secondsLeft = clock.quarter <= 4
    ? periodsLeftBefore * 720 + clock.gameClock
    : clock.gameClock;

  const isLate = secondsLeft <= 180;
  const isClutch = secondsLeft <= 300 && Math.abs(scoreDiff) <= 6;

  return {
    scoreDiff,
    secondsLeft,
    quarter: clock.quarter,
    isLate,
    isClutch,
    trailingLate: isLate && scoreDiff < 0,
    leadingLate: isLate && scoreDiff > 0,
  };
}

/**
 * Multiplier on possession length. A team protecting a late lead burns clock;
 * a team chasing the game hurries. Returns ~0.6 (rush) to ~1.4 (milk).
 */
export function clockUsageMultiplier(ctx: GameContext): number {
  if (ctx.trailingLate) {
    const urgency = Math.min(1, -ctx.scoreDiff / 12);
    return 1 - 0.4 * urgency; // down to ~0.6
  }
  if (ctx.leadingLate) {
    const comfort = Math.min(1, ctx.scoreDiff / 12);
    return 1 + 0.4 * comfort; // up to ~1.4
  }
  return 1;
}

/**
 * Extra weight on three-point attempts. Trailing teams late chuck threes to
 * catch up; teams protecting a lead avoid the volatility.
 */
export function threePointBias(ctx: GameContext): number {
  if (ctx.trailingLate) return 1 + Math.min(0.6, -ctx.scoreDiff / 16);
  if (ctx.leadingLate) return 0.85;
  return 1;
}

/**
 * Whether the defense should intentionally foul to stop the clock: it trails by
 * 1-3 possessions inside the final ~25 seconds, so it trades a stoppage for the
 * chance to get the ball back.
 */
export function shouldIntentionalFoul(defenseScoreDiff: number, secondsLeft: number): boolean {
  return secondsLeft <= 25 && defenseScoreDiff < 0 && defenseScoreDiff >= -9;
}
