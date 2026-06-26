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

// Base probability the ball moves to a teammate after an action of this type,
// i.e. how much this action tends to generate a pass-to-a-finisher rather than a
// self-created shot. Seeded from realistic assisted-make rates; the league
// assist total (~26/team/game) is the binding constraint that pins these. 0-1.
export const PLAY_TYPE_PASS_RATE: Record<PlayType, number> = {
  isolation: 0.22,
  pick_and_roll: 0.74,
  post_up: 0.34,
  spot_up: 0.40,    // a spot-up that re-swings; lower than the assisted-make rate
  transition: 0.62,
  cut: 0.45,
  off_screen: 0.74,
  handoff: 0.70,
  putback: 0.05,
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

// Late-shot-clock floor: under this many seconds the offense is forced into a
// worse look because the alternative is a 24-second violation. The penalty is an
// additive hit to make probability. Threshold ~4s; penalty a few points.
export const SHOT_CLOCK_PRESSURE_THRESHOLD = 4;
export const SHOT_CLOCK_RUSH_PENALTY = -0.04;

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
