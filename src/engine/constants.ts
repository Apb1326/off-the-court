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

// ---------------------------------------------------------------------------
// Lineup spacing (engine/spacing.ts). Roster construction has to matter: a
// lineup's output should not be the bare sum of five individual ratings. The
// spacing model derives a single CENTERED value from the four OFF-BALL players
// on a possession (everyone except the finisher) and feeds it into two existing
// offensive hooks (shot-mix in selectShotZone, openness in resolveShot) and one
// defensive hook (mismatch resistance in selectDefender).
//
// Every number here is centered so that an average lineup nets ~zero effect —
// the goal is roster-to-roster DIFFERENCES, not a league-wide efficiency shift.
// The baselines below were derived empirically (scripts/calibrate-spacing.ts)
// and the hook coefficients were tuned against the neutrality profile
// (scripts/profile-engine.ts) until the league aggregate did not drift.

// Scoring-threat floor (normalized 0-1, i.e. max(interior, mid, outside)/80)
// below which an off-ball player is NOT honored: his man can sag off to help,
// so his cutting/movement is a spacing NEGATIVE, not a positive. Above it,
// movement adds gravity. ~0.55 ≈ a 44 scoring rating. Tuned so genuine
// non-shooting, non-scoring bigs read as floor-cloggers while two-way wings do
// not.
export const SPACING_THREAT_FLOOR = 0.55;

// Weight on the off-ball MOVEMENT term (offensiveIQ × cutFreq, gated by the
// threat floor above). Deliberately small: shooting gravity is the primary
// driver per the design; movement is a minor, conditional adjustment.
export const SPACING_MOVEMENT_WEIGHT = 1.5;

// League-average off-ball-FOUR group gravity, and its spread, used to center
// and normalize spacing to a ~unit-variance z-score. Measured as the live
// POSSESSION-WEIGHTED mean of the off-ball four (finisher excluded) over a
// representative slice of simulated games — so it correctly includes bench
// minutes, which dilute on-court spacing below the starters-only mean (0.337),
// and it bakes in the finisher-exclusion bias (the finisher is usually the
// lineup's best shooter, so an off-ball-four mean sits below a five-man mean).
// scripts/calibrate-spacing.ts shows the roster-level derivation; the live value
// here is what the engine actually centers on. computeSpacing is pure
// arithmetic — it never touches state.rng — so this stays fully deterministic.
//
// NOTE (drift limitation): this is a STATIC baseline tuned against today's
// league. It will slowly drift as the draft/player development changes the
// league pool over a franchise's lifetime. A dynamic per-season snapshot
// (deterministically computed, never via rng) would track that drift; it is
// intentionally deferred — a static constant is acceptable for this task.
export const SPACING_BASELINE_OFFBALL_FOUR = 0.3171;
export const SPACING_SPREAD = 0.0622;

// Clamp on the spacing z-score so a pathological lineup can't run the hooks off
// the rails (keeps the additive offsets bounded, which matters because the shot
// weights and the contest path are both clamped downstream).
export const SPACING_CLAMP = 2.2;

// --- Offensive hook coefficients (additive, centered offsets) ---
// selectShotZone shot-mix reshape, modeled on the real Moreyball pattern: good
// spacing opens driving lanes (rim↑) and the deterred mid-range is the donor
// (mid↓), while threes stay flat-to-up (drive-and-kick, three↑ slightly). Poor
// spacing packs the paint (rim↓) and pushes settle-for pull-ups (mid↑, three↓).
// All three are additive offsets to the per-zone weight, scaled by the centered
// spacing z, so spacing=0 changes nothing. Bounded by the rim/mid/three shot-mix
// targets in the profile, which is the binding constraint on their size.
export const SPACING_RIM_FREQ_COEF = 0.030;
export const SPACING_MID_FREQ_COEF = 0.034;
export const SPACING_THREE_FREQ_COEF = 0.006;
// Additive offset to the rim-PROTECTION term specifically: good spacing reduces
// how much elite rim protection deters drives (the help defender is occupied),
// scaled by how much deterrence is present. Centered on spacing.
export const SPACING_RIM_DETER_RELIEF_COEF = 0.040;

// resolveShot openness: more spacing → less help on the ball → the contest runs
// softer. Routed through the existing contest / contestBonus path as a centered
// subtraction from the effective pressure bonus (good spacing lowers contest
// difficulty). Small — shot QUALITY is a lighter lever than shot FREQUENCY here.
export const SPACING_OPENNESS_COEF = 0.010;

// ---------------------------------------------------------------------------
// Defensive versatility (the deliberately-LIGHTER mirror of spacing). The
// offense's mismatch-hunting in selectDefender attacks the single softest
// defender every possession, relentlessly — so what stops it is the FLOOR of
// the lineup (the worst perimeter defender), NOT the mean. A lineup with four
// studs and one sieve has a high average but gets hunted into the ground. So
// versatility is driven by a WEAK-LINK (the min perimeter defender) plus a LOW
// SPREAD in mobility/size (everyone can credibly switch), with defensive IQ a
// minor contributor and rim protection at most a minor term — five immobile rim
// protectors are the OPPOSITE of switch-everything.
//
// Weights on the versatility components. W_FLOOR dominates by design.
export const VERSATILITY_W_FLOOR = 1.0;       // weak-link: min perimeter D (the hunted guy)
export const VERSATILITY_W_DEFIQ = 0.30;      // team defensive IQ, minor
export const VERSATILITY_W_ATH_SPREAD = 0.55; // penalty on athleticism spread (can't all switch)
export const VERSATILITY_W_SIZE_SPREAD = 0.20;// penalty on height spread
export const VERSATILITY_W_RIM = 0.12;        // rim protection — minor, must not dominate

// Center + normalize versatility to a z-score, measured as the live
// possession-weighted mean/spread of the on-court defensive five (same static-
// baseline tradeoff and drift caveat as the spacing baseline above).
export const VERSATILITY_BASELINE = 0.6789;
export const VERSATILITY_SPREAD = 0.0928;
export const VERSATILITY_CLAMP = 2.2;

// Additive, centered offset to the mismatch-hunt probability in selectDefender:
// a switchable (high-floor, low-spread) defense shifts selection AWAY from
// finding a soft target. Centered, so an average defense (z≈0) leaves the hunt
// rate unchanged. Kept light. The hunt base rate is 0.45; this is bounded so the
// rate stays in a sane band.
export const VERSATILITY_HUNT_COEF = 0.085;

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
