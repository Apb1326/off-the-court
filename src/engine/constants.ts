import { PlayType, ShotZone } from '@/models/game';
import type { Position } from '@/models/player';

export const QUARTER_LENGTH_SECONDS = 720; // 12 minutes
export const SHOT_CLOCK_SECONDS = 24;
export const OVERTIME_LENGTH_SECONDS = 300; // 5 minutes
export const MAX_FOULS = 6;
export const TEAM_FOUL_BONUS_THRESHOLD = 5; // per quarter

// Postseason format. These are intentionally named even when they mirror the
// current NBA: F2 treats the format as a tunable game rule, not engine folklore.
export const PLAY_IN_ENABLED = true;
export const PLAY_IN_WINS_REQUIRED = 1;
export const PLAYOFF_SERIES_WINS_REQUIRED = 4;
export const PLAYOFF_HOME_COURT_PATTERN = [
  'higher', 'higher', 'lower', 'lower', 'higher', 'lower', 'higher',
] as const; // best-of-7, 2-2-1-1-1
export const PLAYOFF_START_REST_DAYS = 2;
export const PLAYOFF_GAME_INTERVAL_DAYS = 2;
export const PLAYOFF_ROUND_REST_DAYS = 3;
export const PLAYOFF_MAX_CALENDAR_DAYS = 90;

// Team possessions per minute of game time (~100 possessions / 48 minutes),
// used to estimate a player's usage rate from per-game counting stats. The
// denominator (mpg * this) approximates team possessions during the player's
// floor time; usage = true attempts / that share.
export const USAGE_TEAM_POSS_PER_MINUTE = 100 / 48;

// Free-throw rating <-> percentage scale contract. These constants define an
// INVERSE PAIR shared by ratings/derivation.ts (real pct -> rating) and
// engine/shot.ts (rating -> sim pct). Rating 40 is the league-average shooter.
// FT_DERIVE_SCALE is defined from FT_PCT_SLOPE so the round trip is exact by
// construction apart from integer rating rounding and endpoint clamps.
export const FT_LEAGUE_AVG_PCT = 0.7823;          // empirical 2023-26 FTA-weighted anchor
export const FT_PCT_SLOPE = 0.25;                 // pct swing across centered rating range +/-1
export const FT_DERIVE_SCALE = 40 / FT_PCT_SLOPE; // rating points per unit of real percentage
export const FT_SIM_PCT_MIN = 0.45;
export const FT_SIM_PCT_MAX = 0.95;

// ---------------------------------------------------------------------------
// Shot zones — settled six-zone mapping vs NBA shot-chart zones (Stage 1).
// The engine zone semantics correspond to real NBA shot-chart data as:
//
//   rim               = Restricted Area (at-basket finishes)
//   short_midrange    = In The Paint (Non-RA) + Mid-Range < 14 ft
//                       (floaters / short pull-ups / hooks)
//   long_midrange     = Mid-Range >= 14 ft
//   corner_three      = Left + Right Corner 3
//   above_break_three = Above the Break 3 < 27 ft
//   deep_three        = Above the Break 3 >= 27 ft (below the 32 ft heave cut)
//
// Full mapping rationale + heave-exclusion rule: docs/LEAGUE_TARGETS.md and
// scripts/derive-league-targets.ts (the single source for the empirical
// targets the profile enforces).
//
// BASE_FG_PCT_BY_ZONE values are TUNED KNOBS, not transcriptions of observed
// league FG%. Realized FG% = base + the average of the full modifier stack
// (contest rolls skew contested-or-worse, fatigue averages negative,
// play-type mods average slightly positive, etc.), which does not average to
// zero — the base-vs-target offset absorbs that stack and is tuned via
// `npm run profile`. Empirical targets (2023-24..2025-26 pooled shot_events,
// 655,666 post-heave FGA — docs/LEAGUE_TARGETS.md):
//   rim .6659 (n=188,112) | short_midrange .4412 (n=151,521)
//   long_midrange .4135 (n=47,966) | corner_three .3881 (n=69,306)
//   above_break_three .3603 (n=152,549) | deep_three .3379 (n=46,212)
export const BASE_FG_PCT_BY_ZONE: Record<ShotZone, number> = {
  rim: 0.689,
  short_midrange: 0.428,
  long_midrange: 0.421,
  corner_three: 0.356,
  above_break_three: 0.342,
  deep_three: 0.325,
};

// Per-zone frequency MULTIPLIERS inside shot-zone selection (play-types.ts) —
// they rescale relative zone weights only and never touch shot percentages.
// Sane range ~0.5-1.2 per zone; 1.0 disables a zone's factor. This table is
// the S2d successor to the former global THREE_POINT_FREQUENCY_DAMPENER
// (0.62 legacy / 0.72 candidate), folded here per zone: the engine's
// finisher-level zone selection (chain kick-outs finish spot-up-like more
// often than possession-level Synergy rows imply) systematically overweights
// rim and corner threes and underweights midrange, so the compensation is
// per-zone rather than one global three-zone scalar. Tuned against the
// profile's shot-mix rows; because it rescales zones uniformly across play
// types, keep it as close to 1.0 as the mix rows allow (pool-artifact rule).
export const SHOT_ZONE_FREQUENCY_FACTORS: Record<ShotZone, number> = {
  rim: 0.89,
  short_midrange: 1.06,
  long_midrange: 1.06,
  corner_three: 0.63,
  above_break_three: 0.76,
  deep_three: 0.76,
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

// Shot zone probabilities by play type. Pre-multiplier weights: selectShotZone
// scales these by player tendencies/ability and the global three-dampener
// before drawing, so realized league shares differ from the raw weights —
// they are tuned via `npm run profile` against the six-zone shot-mix targets
// (docs/LEAGUE_TARGETS.md: rim .2869, short_mid .2311, long_mid .0732,
// corner .1057, above-break .2327, deep .0705). Under the settled mapping
// `rim` is restricted-area finishes only — floaters, short rolls, hooks and
// runners belong to short_midrange — and each play type's profile must stay
// recognizable as that play type's real shot diet (pool-artifact rule).
//
// S2d production diets. Cut and spot-up were restored to their documented real
// ranges in S2c2 and are now the sole active table; there is no shaded fallback.
export const PLAY_TYPE_SHOT_ZONES: Record<PlayType, { zone: ShotZone; weight: number }[]> = {
  isolation: [
    // Self-created: drives that finish at the rim, plus heavy pull-up traffic
    // (short + long middies) and stepback/deep pull-up threes.
    { zone: 'rim', weight: 0.22 },
    { zone: 'short_midrange', weight: 0.33 },
    { zone: 'long_midrange', weight: 0.13 },
    { zone: 'above_break_three', weight: 0.22 },
    { zone: 'deep_three', weight: 0.10 },
  ],
  pick_and_roll: [
    // Ball-handler rim attacks + floater/short-roll finishes; pull-up threes
    // above the break with a small deep-pull-up tail; kick to the corner.
    { zone: 'rim', weight: 0.28 },
    { zone: 'short_midrange', weight: 0.34 },
    { zone: 'long_midrange', weight: 0.06 },
    { zone: 'above_break_three', weight: 0.23 },
    { zone: 'corner_three', weight: 0.05 },
    { zone: 'deep_three', weight: 0.04 },
  ],
  post_up: [
    // Deep seals finish at the rim; hooks/fadeaways live in the short mid.
    { zone: 'rim', weight: 0.45 },
    { zone: 'short_midrange', weight: 0.45 },
    { zone: 'long_midrange', weight: 0.10 },
  ],
  spot_up: [
    // Mostly catch-and-shoot threes (corner-heavy), with closeout attacks
    // producing rim/short-mid finishes and one-dribble middies. Real spot-up
    // rim share is the documented .12-.15 midpoint. The added rim mass is
    // taken proportionally from the former shaded short-mid/three weights.
    { zone: 'corner_three', weight: 0.317 },
    { zone: 'above_break_three', weight: 0.326 },
    { zone: 'long_midrange', weight: 0.05 },
    { zone: 'deep_three', weight: 0.093 },
    { zone: 'short_midrange', weight: 0.084 },
    { zone: 'rim', weight: 0.130 },
  ],
  transition: [
    // Rim-heavy, trailing threes above the break / corners, some early
    // pull-up middies before the defense sets.
    { zone: 'rim', weight: 0.45 },
    { zone: 'above_break_three', weight: 0.25 },
    { zone: 'short_midrange', weight: 0.14 },
    { zone: 'corner_three', weight: 0.10 },
    { zone: 'long_midrange', weight: 0.04 },
    { zone: 'deep_three', weight: 0.02 },
  ],
  cut: [
    // Finishes at the basket, plus dunker-spot floaters/short push shots.
    // Real cut rim share midpoint (.75-.85), locked before observation.
    { zone: 'rim', weight: 0.800 },
    { zone: 'short_midrange', weight: 0.200 },
  ],
  off_screen: [
    // Movement shooters: above-break threes (some from deep), corner relocations,
    // curl-and-pull middies, the occasional rim cut off the screen.
    { zone: 'above_break_three', weight: 0.42 },
    { zone: 'long_midrange', weight: 0.15 },
    { zone: 'corner_three', weight: 0.15 },
    { zone: 'short_midrange', weight: 0.14 },
    { zone: 'deep_three', weight: 0.09 },
    { zone: 'rim', weight: 0.05 },
  ],
  handoff: [
    // DHO curls into threes and downhill drives; floater-range stop-offs.
    { zone: 'above_break_three', weight: 0.38 },
    { zone: 'long_midrange', weight: 0.12 },
    { zone: 'rim', weight: 0.16 },
    { zone: 'short_midrange', weight: 0.22 },
    { zone: 'deep_three', weight: 0.06 },
    { zone: 'corner_three', weight: 0.06 },
  ],
  putback: [
    { zone: 'rim', weight: 0.95 },
    { zone: 'short_midrange', weight: 0.05 },
  ],
};

/** Machine-readable identity for S2d context checks; this is the only runtime shot-zone table. */
export const PRODUCTION_SHOT_ZONE_TABLE_ID = 'PLAY_TYPE_SHOT_ZONES';

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
// these are tuned alongside bonus/penalty free throws to land on the real
// FTA target (22.29 per team-game, 2023-24..2025-26 pooled pbp —
// docs/LEAGUE_TARGETS.md) while keeping the FTA *composition* honest: real
// fouled-3PA incidence is only ~2% (three-shot fouls are rare), and real rim
// foul incidence per attempt is ~.20-.22. Rim sits slightly above that real
// incidence because the engine's foul roll is independent of the make roll
// (no foul-on-miss conditioning yet — a Stage 3 mechanism), which also
// inflates and-one frequency; see the informational and-one line in
// `npm run profile`. Do not raise the three-point rates to chase FTA.
export const SHOOTING_FOUL_RATE_BY_ZONE: Record<ShotZone, number> = {
  rim: 0.285,
  short_midrange: 0.11,
  long_midrange: 0.06,
  corner_three: 0.018,
  above_break_three: 0.018,
  deep_three: 0.01,
};

// Steal share of a forced live-ball turnover: base + coefficient on the best
// on-ball defender's normalized (0-1) steal rating, capped. Shared by the
// possession chain's bad-pass split and checkTurnover so the two live-ball
// paths stay on one model. Tuned against the profile STL row (~8.0/team-game,
// ~57% of real turnovers are steals); sane base range ~0.15-0.35, cap <= 0.85.
export const TURNOVER_STEAL_BASE = 0.28;
export const TURNOVER_STEAL_RATING_COEF = 0.45;
export const TURNOVER_STEAL_CAP = 0.78;

// Base per-shot block probability at rating 80, before the per-zone factor
// (rim 2.0x, short-mid 0.5x, other 0.1x in resolveShot). A block forces the
// miss before the make roll, so this also drags league FG% down slightly.
// Tuned against the profile BLK row (~5.0/team-game); sane range ~0.08-0.18.
export const BLOCK_BASE_RATE = 0.14;

// Per-possession chance of a non-shooting defensive foul (reach-in, off-ball,
// loose-ball). Only yields free throws once the defense is in the penalty,
// which is how a big share of real FTA is generated. ~10-11 non-shooting
// defensive fouls per team-game sits at the high end of the real range and
// carries the FTA share the (now-realistic) three-point foul rates gave back.
export const NON_SHOOTING_FOUL_RATE = 0.11;

// Fatigue
export const BASE_FATIGUE_PER_POSSESSION = 0.012;
export const BENCH_RECOVERY_PER_MINUTE = 0.06;
export const FATIGUE_PERFORMANCE_PENALTY = 0.15;
export const FATIGUE_SUB_THRESHOLD = 0.40;
export const FATIGUE_FORCE_SUB_THRESHOLD = 0.70;

// Injury system. Base per-game injury probability for a player with durability=40
// (league average). Tuned so an average player misses ~8-10 games per 82-game season:
// ~1.25 injury events × ~7 games average recovery = ~8.75 games missed.
export const INJURY_BASE_RATE = 0.0152;

// Durability modifies the base rate: rate = INJURY_BASE_RATE * (40 / durability).
// A durability-70 player gets ~57% of the base rate; durability-20 gets 200%.
// Clamped to [0.004, 0.055] so pathological ratings don't produce impossible outcomes.
export const INJURY_RATE_MIN = 0.004;
export const INJURY_RATE_MAX = 0.055;

// Age modifier: players 30+ are more fragile. Applied as a multiplier on top of
// the durability-adjusted rate. Under 30: 1.0. Ages 30-33: 1.15. Ages 34+: 1.35.
export const INJURY_AGE_30_MULT = 1.15;
export const INJURY_AGE_34_MULT = 1.35;

// Back-to-back multiplier: playing on consecutive calendar days raises injury risk.
export const INJURY_BACK_TO_BACK_MULT = 1.18;

// Dense-stretch multiplier: schedule congestion (e.g. 4 games in 5 nights) is a
// bigger real injury driver than a lone back-to-back. If a team has played
// INJURY_DENSE_STRETCH_GAMES or more games in the trailing
// INJURY_DENSE_STRETCH_WINDOW_DAYS calendar days, risk is bumped on top of any
// back-to-back multiplier. 3 games in the prior 4 days = this is the 4th in 5
// nights.
export const INJURY_DENSE_STRETCH_MULT = 1.15;
export const INJURY_DENSE_STRETCH_WINDOW_DAYS = 4;
export const INJURY_DENSE_STRETCH_GAMES = 3;

// Workload: players who log heavy minutes carry modestly more injury risk. Risk
// scales with planned minutes (the rotation's minuteTargets) on a diminishing
// (square-root) curve relative to a league-average load, clamped tight so it stays
// a secondary factor — a max-minutes star is only ~20% riskier than an
// average-minutes player, NOT injured constantly, and durability still dominates.
// Centered on the league-average minute load so the league-wide rate is unchanged.
export const INJURY_WORKLOAD_REF_MINUTES = 20; // ~league-average rotation minutes; multiplier = 1.0 here
export const INJURY_WORKLOAD_EXP = 0.5;        // diminishing returns on minutes
export const INJURY_WORKLOAD_MULT_MIN = 0.8;
export const INJURY_WORKLOAD_MULT_MAX = 1.2;

// Injury clustering: beyond static durability, some players have a fragile season
// where injuries pile up ("snakebit"). Each player gets a hidden, season-stable
// fragility multiplier on their injury rate, drawn deterministically from the
// season seed. This spread controls how strong that clustering is; the multiplier
// is normalized so the league-wide rate is unchanged (it redistributes, not
// inflates). exp(±spread) ≈ ±35% at the tails for spread 0.35.
export const INJURY_FRAGILITY_SPREAD = 0.35;

// Re-injury / recurrence: for a few games after returning from an injury, a
// player carries elevated risk (deconditioned, compensating, not fully healed),
// concentrated on the same body region — soft-tissue injuries especially recur.
// The rate bump peaks on the first game back and decays linearly to none over the
// window. The region bias multiplies the selection weight of same-region injury
// types so a recurrence tends to be the same injury (a hamstring re-pulls).
export const INJURY_RECURRENCE_WINDOW = 5;        // games of heightened risk after returning
export const INJURY_RECURRENCE_MULT = 1.6;        // peak rate multiplier (first game back)
export const INJURY_RECURRENCE_REGION_BIAS = 3.0; // weight bias toward re-injuring the same region

// In-game injuries: acute injuries (sprains, strains, etc.) happen during play —
// the player exits partway through the game rather than sitting it out entirely.
// The exit moment is drawn uniformly in this elapsed-game-time window (seconds;
// regulation is 2880s). ~6 to ~44 minutes in, so they always log some minutes.
export const INJURY_INGAME_EXIT_MIN_SEC = 360;
export const INJURY_INGAME_EXIT_MAX_SEC = 2640;

// Minimum available players required per team before a game. If injuries reduce a
// team below this, the least-severe injured players are returned to play (emergency
// hardship — mirrors the real NBA's minimum of 8 dressed players). 8 (not 5) also
// keeps the substitution/fatigue rotation working: with only 5 available the bench is
// empty, checkSubstitutions no-ops, and those 5 would play all 48 minutes.
export const INJURY_MIN_HEALTHY_ROSTER = 8;

// Rebounding. Tuned so team OREB lands on the real 11.04/team-game with the
// player-credited ORB rate near the real 25.2% ORB/(ORB+DRB)
// (2023-24..2025-26 box_advanced — docs/LEAGUE_TARGETS.md).
export const BASE_OFFENSIVE_REBOUND_RATE = 0.25;

// Share of rebounds that are uncredited "team rebounds" (ball out of bounds,
// kicked, etc.). Without this, every miss becomes a player rebound and team
// totals run ~3/game above the real ~43.
export const TEAM_REBOUND_RATE = 0.05;

// Possession timing. Mean ~16s lands the league near the derived FGA/pace
// targets (89.08 FGA, 101.98 estimated poss per team-game —
// docs/LEAGUE_TARGETS.md).
export const BASE_POSSESSION_TIME_MIN = 9;
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
export const SPACING_BASELINE_OFFBALL_FOUR = 0.2168;
export const SPACING_SPREAD = 0.0707;

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
export const SPACING_RIM_FREQ_COEF = 0.015;
export const SPACING_MID_FREQ_COEF = 0.017;
export const SPACING_THREE_FREQ_COEF = 0.006;
// Additive offset to the rim-PROTECTION term specifically: good spacing reduces
// how much elite rim protection deters drives (the help defender is occupied),
// scaled by how much deterrence is present. Centered on spacing.
export const SPACING_RIM_DETER_RELIEF_COEF = 0.020;

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
export const VERSATILITY_BASELINE = 0.4917;
export const VERSATILITY_SPREAD = 0.0743;
export const VERSATILITY_CLAMP = 2.2;

// Additive, centered offset to the S3.b1 mismatch-hunt strength per versatility
// z-score: a switchable defense shifts selection away from soft defenders.
// Units are multiplier strength per z; sane tuning range 0-0.20.
export const VERSATILITY_HUNT_COEF = 0.085;

// BEGIN GENERATED S3B1 MATCHUP LIFT
// Generated by scripts/derive-s3b1-matchups.ts from 2017-18 through 2024-25.
// Values are partial-possession-weighted supply-adjusted lift (1 = independence).
export type S3B1MatchupBucket = 'G' | 'F' | 'C';
export const S3B1_MATCHUP_LIFT: Readonly<Record<Position, Readonly<Record<S3B1MatchupBucket, number>>>> = {
  PG: { G: 1.386808, F: 0.688320, C: 0.389838 },
  SG: { G: 1.164873, F: 0.929093, C: 0.433791 },
  SF: { G: 0.817975, F: 1.245403, C: 0.799189 },
  PF: { G: 0.446887, F: 1.322122, C: 2.483154 },
  C: { G: 0.391690, F: 1.206019, C: 3.363817 },
};
// END GENERATED S3B1 MATCHUP LIFT

// S3.b1 defender-selection weights. These multiply the empirical lift above;
// they do not change defender ability or shot resolution. All are dimensionless.
// Secondary position is evidence only when it beats the primary lift after this
// discount. Sane range 0-1; 1 would treat primary/secondary equally.
export const S3B1_SECONDARY_POS_FACTOR = 0.85;
// Rating-quality slope per 40-centered rating unit. Sane range 0-0.50; the
// selected 0.15 keeps quality secondary to matchup association.
export const S3B1_QUALITY_COEF = 0.15;
// Positive quality multiplier clamps. Sane envelope 0.5-1.5.
export const S3B1_QUALITY_MIN = 0.75;
export const S3B1_QUALITY_MAX = 1.25;
// Base weak-link hunt strength at centered versatility, used only for
// isolation/post_up. Sane range 0-1.
export const S3B1_HUNT_BASE = 0.55;
// Hunt-strength clamps after the centered versatility offset. Sane range 0-1.
export const S3B1_HUNT_MIN = 0.15;
export const S3B1_HUNT_MAX = 0.75;
// Positive per-defender hunt-term clamps. Sane envelope 0.25-2.0.
export const S3B1_HUNT_TERM_MIN = 0.50;
export const S3B1_HUNT_TERM_MAX = 1.50;
// Every on-court defender receives at least this fraction of the lineup's
// maximum raw weight. Sane range (0, 0.5]; 0.10 keeps all defenders reachable.
export const S3B1_DEFENDER_MIN_WEIGHT = 0.10;

// ---------------------------------------------------------------------------
// Possession ball-movement chain.
//
// A possession can develop through additional actions before it ends: an initial
// action creates an advantage (a beaten/pressured primary, a committed help
// defender, a double-team) and the offense relocates the ball to exploit it.
// Quality is keyed to the ADVANTAGE STATE, never the raw pass count.
// ---------------------------------------------------------------------------

// Hard bound on EXTRA actions after the initial one (initial + up to 2 = 3 total
// actions). Never exceed.
export const MAX_EXTRA_PASSES = 2;

// Minimum per-player base weight in selectPrimaryPlayer. estimateUsageRate
// already floors usageRate at 0.10, so this only fires on pathological
// posWeight * skillFit combinations. Must be > 0 to keep weightedChoice sane.
export const PRIMARY_PLAYER_MIN_WEIGHT = 0.01;

// Production selector knobs. TransitionFreq is an unconditional possession share;
// this denominator converts it to a probability conditional on the existing
// turnover/long-rebound transition precursor gate (measured at ~40% in the
// S2c1 diagnosis). Re-measure if that upstream gate changes.
export const TRANSITION_ELIGIBLE_RATE = 0.40;
// A tiny finite floor keeps malformed-but-valid zero-frequency vectors safe for
// weightedChoice without creating meaningful mass in a category with no signal.
export const PLAY_TYPE_SELECTOR_MIN_WEIGHT = 0.0001;
// System/position/situation effects remain centered modifiers around
// the derived tendency rather than replacing it. These are bounded in [0, 1].
export const PLAY_TYPE_SYSTEM_MODIFIER_STRENGTH = 0.25;
export const PLAY_TYPE_POSITION_MODIFIER_STRENGTH = 0.25;
export const PLAY_TYPE_SITUATION_MODIFIER_STRENGTH = 0.25;

// Base probability the ball moves to a teammate after an action of this type,
// i.e. how much this action tends to generate a pass-to-a-finisher rather than a
// self-created shot. Seeded from realistic assisted-make rates; the league
// assist total (~26/team/game) is the binding constraint that pins these. 0-1.
export const PLAY_TYPE_PASS_RATE: Record<PlayType, number> = {
  isolation: 0.29,
  pick_and_roll: 0.79,
  post_up: 0.39,
  spot_up: 0.47,    // a spot-up that re-swings; lower than the assisted-make rate
  transition: 0.69,
  cut: 0.53,
  off_screen: 0.79,
  handoff: 0.75,
  putback: 0.07,
};

// Pass-probability modulation, all CENTERED so an average possession lands on the
// play-type base above. Passing/IQ above the ~40 average raises it; better
// spacing opens passing lanes; a pressured or doubled primary gives it up more.
export const PASS_PROB_PASSING_COEF = 0.0045; // per rating-point of (passing+offIQ)/2 above 40
export const PASS_PROB_SPACING_COEF = 0.05;   // per unit of centered spacing z-score
export const PASS_PROB_PRESSURE_COEF = 0.9;   // per unit of (contestBonus) pressure
// A double-team is, by definition, two-on-the-ball — it almost always forces the
// kick-out. This is the real-kick-out replacement for the old assist-rate fudge.
export const DOUBLE_TEAM_PASS_PROB = 0.90;

// Per-pass shot-clock cost (a couple of seconds each) and the floor on the
// initial create segment, so a chain can't claim zero time up front. Seconds.
export const PASS_TIME_MIN = 2;
export const PASS_TIME_MAX = 3;
export const MIN_CREATE_TIME = 2;

// Per-pass bad-pass turnover risk. Deliberately SMALL: it is the per-pass cost
// that (with the clock cost) keeps mildly-+EV ball movement net-neutral, but it
// must not be cranked to chase the efficiency target. Centered on passer skill
// and the best defender's hands. Realistic per-pass bad-pass/steal risk ~1-3%.
export const PASS_TURNOVER_BASE = 0.003;
export const PASS_TURNOVER_SKILL_COEF = 0.05; // per (passing+offIQ)/2 normalized about 0.5
export const PASS_TURNOVER_STEAL_COEF = 0.05; // per best-defender steal normalized about 0.5
export const PASS_TURNOVER_DT_MULT = 1.7;     // a kick-out out of a double-team is riskier
export const PASS_TURNOVER_MIN = 0.002;
export const PASS_TURNOVER_MAX = 0.03;

// Advantage creation. Absent a double-team, a drive-type initial action (rim
// pressure / collapsing the defense) creates an exploitable advantage more often
// than a stationary one. Probabilities.
export const ADVANTAGE_DRIVE_PROB = 0.45;     // iso/PnR/post/cut/transition: a real drive draws help
export const ADVANTAGE_NONDRIVE_PROB = 0.15;  // spot_up/off_screen/handoff: less collapse
// A no-advantage reset/swing pass occasionally manufactures a fresh advantage
// (the extra ball-reversal beats a rotating defense).
export const ADVANTAGE_CREATE_PROB = 0.10;
// After an advantage is cashed the defense usually recovers; only sometimes does
// it persist into a second exploit (a genuine drive-and-kick-and-swing).
export const ADVANTAGE_PERSIST_PROB = 0.30;

// Shot-quality bonus (additive to make probability) for a pass that CASHES an
// advantage. Diminishing returns and a hard ceiling, so exploiting an advantage
// twice does not stack into an unrealistically perfect look. A no-advantage pass
// gets NONE of this. On perimeter shots the bonus is further scaled by the
// finisher's shooting (an open look is only good if he can punish it). ~0.03-0.07
// is the realistic swing in make probability from a clean advantage.
export const ADVANTAGE_SHOT_BONUS = 0.072;     // first cash
export const ADVANTAGE_BONUS_DIMINISH = 0.45;  // multiplier on a second cash
export const ADVANTAGE_BONUS_CEIL = 0.090;     // hard ceiling on the accumulated bonus

// The advantage a pass cashes is only a genuinely OPEN look if the floor is
// spaced: a kick-out into a packed paint finds a help defender already recovering,
// while the same pass with shooters spotting the floor is a clean catch. So the
// realized advantage bonus is scaled by centered lineup spacing — positive
// (well-spaced) amplifies it, negative (clogged) damps it. CENTERED on league-
// average spacing (z≈0 ⇒ factor 1), so it is net-neutral on league efficiency;
// its job is to keep the spacing→efficiency link concentrated where it belongs
// (good spacing makes ball movement pay off) rather than letting a lone shooter
// in a non-spaced lineup vacuum up clean kick-outs. Factor clamped to a sane band.
export const SPACING_ADVANTAGE_COEF = 0.40;
export const SPACING_ADVANTAGE_MIN = 0.25;
export const SPACING_ADVANTAGE_MAX = 1.6;

// ---------------------------------------------------------------------------
// Effort / coasting — the real game's margin-compressing behavior (S1-Rb).
// Real NBA final margins (2023-24..2025-26: mean abs 12.87, signed-margin SD
// ~15.8) sit well BELOW the variance floor implied by ~102 independent
// possessions per side: teams protect large leads with lower-intensity
// offense and defense (coasting) while trailing teams play desperation-high
// effort. Without this negative feedback the engine's margins random-walk to
// a mean abs margin of ~16.8. This models that behavior as a deterministic,
// bounded, symmetric game-state response: once a team's lead exceeds
// COAST_LEAD_START the leading offense takes an additive make-probability
// penalty and the trailing offense an equal bonus, ramping linearly until the
// lead reaches COAST_LEAD_FULL and capped at COAST_SHOT_EFFORT_MAX. Equal and
// opposite by construction, so league-aggregate scoring/FG% are untouched; it
// reads the score only as a behavioral state (like threePointBias and the
// garbage-time rule), never targets a margin. Sane ranges: START 8-15 pts,
// FULL 20-30 pts, MAX 0.02-0.06 make-prob. Calibrated via `npm run profile`
// (S1-Rb): 0.05 brings mean abs margin from 16.8 to ~13.4 vs the 12.87 ± 1.0
// target with every other enforced stat unmoved; the implied full-coast
// leader-vs-trailer differential (2 × 0.05 make-prob ≈ ±11 net rating per
// 100) matches real garbage-time net-rating swings. Regression harness:
// scripts/test-coasting.ts.
export const COAST_LEAD_START = 8;
export const COAST_LEAD_FULL = 25;
export const COAST_SHOT_EFFORT_MAX = 0.05;

// Late-shot-clock floor: under this many seconds the offense is forced into a
// worse look because the alternative is a 24-second violation. The penalty is an
// additive hit to make probability. Threshold ~4s; penalty a few points.
export const SHOT_CLOCK_PRESSURE_THRESHOLD = 4;
export const SHOT_CLOCK_RUSH_PENALTY = -0.04;

// SUPERSEDED: coarse hand-set league averages, kept only for reference. The
// calibration oracle is now the derived TARGETS table in
// scripts/profile-engine.ts (from scripts/derive-league-targets.ts;
// provenance in docs/LEAGUE_TARGETS.md). No code consumes this constant —
// do not tune against it.
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
