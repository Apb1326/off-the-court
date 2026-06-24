import { PlayType, ShotZone } from '@/models/game';

export const QUARTER_LENGTH_SECONDS = 720; // 12 minutes
export const SHOT_CLOCK_SECONDS = 24;
export const OVERTIME_LENGTH_SECONDS = 300; // 5 minutes
export const MAX_FOULS = 6;
export const TEAM_FOUL_BONUS_THRESHOLD = 5; // per quarter

export const BASE_FG_PCT_BY_ZONE: Record<ShotZone, number> = {
  rim: 0.645,
  short_midrange: 0.435,
  long_midrange: 0.415,
  corner_three: 0.39,
  above_break_three: 0.36,
  deep_three: 0.32,
};

export const POINTS_BY_ZONE: Record<ShotZone, number> = {
  rim: 2,
  short_midrange: 2,
  long_midrange: 2,
  corner_three: 3,
  above_break_three: 3,
  deep_three: 3,
};

export const PLAY_TYPE_EFFICIENCY_MOD: Record<PlayType, number> = {
  isolation: -0.03,
  pick_and_roll: 0.02,
  post_up: -0.01,
  spot_up: 0.03,
  transition: 0.06,
  cut: 0.08,
  off_screen: 0.02,
  handoff: 0.01,
  putback: 0.10,
};

export const PLAY_TYPE_ASSIST_RATE: Record<PlayType, number> = {
  isolation: 0.12,
  pick_and_roll: 0.52,
  post_up: 0.18,
  spot_up: 0.93,
  transition: 0.58,
  cut: 0.97,
  off_screen: 0.90,
  handoff: 0.86,
  putback: 0.06,
};

// Shot zone probabilities by play type
export const PLAY_TYPE_SHOT_ZONES: Record<PlayType, { zone: ShotZone; weight: number }[]> = {
  isolation: [
    { zone: 'rim', weight: 0.35 },
    { zone: 'short_midrange', weight: 0.25 },
    { zone: 'long_midrange', weight: 0.15 },
    { zone: 'above_break_three', weight: 0.20 },
    { zone: 'deep_three', weight: 0.05 },
  ],
  pick_and_roll: [
    { zone: 'rim', weight: 0.40 },
    { zone: 'short_midrange', weight: 0.20 },
    { zone: 'long_midrange', weight: 0.10 },
    { zone: 'above_break_three', weight: 0.25 },
    { zone: 'corner_three', weight: 0.05 },
  ],
  post_up: [
    { zone: 'rim', weight: 0.55 },
    { zone: 'short_midrange', weight: 0.35 },
    { zone: 'long_midrange', weight: 0.10 },
  ],
  spot_up: [
    { zone: 'corner_three', weight: 0.35 },
    { zone: 'above_break_three', weight: 0.45 },
    { zone: 'long_midrange', weight: 0.15 },
    { zone: 'deep_three', weight: 0.05 },
  ],
  transition: [
    { zone: 'rim', weight: 0.55 },
    { zone: 'above_break_three', weight: 0.25 },
    { zone: 'short_midrange', weight: 0.10 },
    { zone: 'corner_three', weight: 0.10 },
  ],
  cut: [
    { zone: 'rim', weight: 0.85 },
    { zone: 'short_midrange', weight: 0.15 },
  ],
  off_screen: [
    { zone: 'above_break_three', weight: 0.45 },
    { zone: 'long_midrange', weight: 0.30 },
    { zone: 'corner_three', weight: 0.15 },
    { zone: 'short_midrange', weight: 0.10 },
  ],
  handoff: [
    { zone: 'above_break_three', weight: 0.40 },
    { zone: 'long_midrange', weight: 0.25 },
    { zone: 'rim', weight: 0.20 },
    { zone: 'short_midrange', weight: 0.15 },
  ],
  putback: [
    { zone: 'rim', weight: 0.95 },
    { zone: 'short_midrange', weight: 0.05 },
  ],
};

// Turnover rate by play type (~14% of possessions — real TOV ~14/team/game).
// These carry the full turnover load now that phantom shot-clock violations
// are eliminated.
export const PLAY_TYPE_TURNOVER_RATE: Record<PlayType, number> = {
  isolation: 0.15,
  pick_and_roll: 0.14,
  post_up: 0.13,
  spot_up: 0.07,
  transition: 0.18,
  cut: 0.08,
  off_screen: 0.08,
  handoff: 0.11,
  putback: 0.05,
};

// Foul rate on shot attempts by zone. Rim attacks draw contact most often;
// these are tuned alongside bonus/penalty free throws to land near the real
// ~22 FTA per team per game.
export const SHOOTING_FOUL_RATE_BY_ZONE: Record<ShotZone, number> = {
  rim: 0.24,
  short_midrange: 0.07,
  long_midrange: 0.045,
  corner_three: 0.05,
  above_break_three: 0.05,
  deep_three: 0.03,
};

// Per-possession chance of a non-shooting defensive foul (reach-in, off-ball,
// loose-ball). Only yields free throws once the defense is in the penalty,
// which is how a big share of real FTA is generated.
export const NON_SHOOTING_FOUL_RATE = 0.075;

// Fatigue
export const BASE_FATIGUE_PER_POSSESSION = 0.012;
export const BENCH_RECOVERY_PER_MINUTE = 0.06;
export const FATIGUE_PERFORMANCE_PENALTY = 0.15;
export const FATIGUE_SUB_THRESHOLD = 0.40;
export const FATIGUE_FORCE_SUB_THRESHOLD = 0.70;

// Rebounding. Real offensive-rebound rate is ~25%, but the per-miss live-ball
// share that turns into a *player* rebound is lower, so 0.22 lands team OREB
// near the real ~10/game (vs ~24% true rate including tip-outs).
export const BASE_OFFENSIVE_REBOUND_RATE = 0.22;

// Share of rebounds that are uncredited "team rebounds" (ball out of bounds,
// kicked, etc.). Without this, every miss becomes a player rebound and team
// totals run ~3/game above the real ~43.
export const TEAM_REBOUND_RATE = 0.07;

// Possession timing. Mean ~15s lands the league near the real ~99 possessions
// per team per game (fewer possessions => fewer shots => realistic rebound and
// FGA totals).
export const BASE_POSSESSION_TIME_MIN = 8;
export const BASE_POSSESSION_TIME_MAX = 23;
export const TRANSITION_POSSESSION_TIME_MIN = 3;
export const TRANSITION_POSSESSION_TIME_MAX = 8;

// League averages for calibration
export const LEAGUE_AVG = {
  pace: 100,
  pointsPerGame: 112,
  fieldGoalPct: 0.471,
  threePointPct: 0.365,
  freeThrowPct: 0.781,
  turnoversPerGame: 14,
  reboundsPerGame: 44,
  assistsPerGame: 25,
  stealsPerGame: 7.5,
  blocksPerGame: 5,
  foulsPerGame: 20,
};
