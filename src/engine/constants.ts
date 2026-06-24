import { PlayType, ShotZone } from '@/models/game';

export const QUARTER_LENGTH_SECONDS = 720; // 12 minutes
export const SHOT_CLOCK_SECONDS = 24;
export const OVERTIME_LENGTH_SECONDS = 300; // 5 minutes
export const MAX_FOULS = 6;
export const TEAM_FOUL_BONUS_THRESHOLD = 5; // per quarter

export const BASE_FG_PCT_BY_ZONE: Record<ShotZone, number> = {
  rim: 0.63,
  short_midrange: 0.42,
  long_midrange: 0.40,
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
  isolation: 0.10,
  pick_and_roll: 0.45,
  post_up: 0.15,
  spot_up: 0.90,
  transition: 0.50,
  cut: 0.95,
  off_screen: 0.85,
  handoff: 0.80,
  putback: 0.05,
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

// Turnover rate by play type
export const PLAY_TYPE_TURNOVER_RATE: Record<PlayType, number> = {
  isolation: 0.10,
  pick_and_roll: 0.09,
  post_up: 0.08,
  spot_up: 0.04,
  transition: 0.12,
  cut: 0.05,
  off_screen: 0.05,
  handoff: 0.07,
  putback: 0.03,
};

// Foul rate on shot attempts by zone
export const SHOOTING_FOUL_RATE_BY_ZONE: Record<ShotZone, number> = {
  rim: 0.18,
  short_midrange: 0.06,
  long_midrange: 0.04,
  corner_three: 0.04,
  above_break_three: 0.04,
  deep_three: 0.02,
};

// Fatigue
export const BASE_FATIGUE_PER_POSSESSION = 0.012;
export const BENCH_RECOVERY_PER_MINUTE = 0.06;
export const FATIGUE_PERFORMANCE_PENALTY = 0.15;
export const FATIGUE_SUB_THRESHOLD = 0.40;
export const FATIGUE_FORCE_SUB_THRESHOLD = 0.70;

// Rebounding
export const BASE_OFFENSIVE_REBOUND_RATE = 0.27;

// Possession timing
export const BASE_POSSESSION_TIME_MIN = 6;
export const BASE_POSSESSION_TIME_MAX = 22;
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
