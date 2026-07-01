/**
 * GM/league roster-rule configuration for the transaction layer.
 *
 * Deliberately separate from engine tuning (`src/engine/constants.ts`): these are league
 * rules, not simulation knobs. Tunable numbers live here as named constants — no inline
 * literals in the gate/validators.
 */

/**
 * Standard active-roster bounds (NBA rules: 14 minimum, 15 maximum standard contracts).
 * Every roster must stay within `[ROSTER_MIN, ROSTER_MAX]` after any transaction. A team at
 * the floor cannot cut without first signing a replacement.
 *
 * IMPORTANT: these govern the STANDARD roster only. Two-way players are excluded; their
 * separate slot limits and roster structures remain deferred.
 */
export const ROSTER_MIN = 14;
export const ROSTER_MAX = 15;

/**
 * The `teamId` sentinel for an unsigned player. The canonical record of free agency is
 * membership in `season.freeAgentPool`; a free agent's `Player.teamId` is set to this so the
 * existing back-reference stays meaningful ("no team") and never points at a stale roster.
 */
export const FREE_AGENT_TEAM_ID = '';

// --- Contract constants (Phase 2) ---
// Game-tuning values inspired by CBA structure. NOT pinned to a specific league
// year — they are approximate and tunable. Update when fidelity demands it.

/** League-minimum annual salary, in millions. */
export const CONTRACT_MINIMUM_SALARY = 1.1;

/** Two-way contract annual salary, in millions (approx 50% of zero-service min). */
export const CONTRACT_TWO_WAY_SALARY = 0.6;

/** Approximate max salary as fraction of cap for 0–6 years of service. */
export const CONTRACT_MAX_PCT_0_6 = 0.25;
/** Approximate max salary as fraction of cap for 7–9 years of service. */
export const CONTRACT_MAX_PCT_7_9 = 0.30;
/** Approximate max salary as fraction of cap for 10+ years of service. */
export const CONTRACT_MAX_PCT_10_PLUS = 0.35;

/** Reference salary cap for contract generation (tuning only — Phase 3 computes real cap). In millions. */
export const CONTRACT_REFERENCE_CAP = 141;

/** Maximum standard contract length, in years. */
export const CONTRACT_MAX_YEARS = 5;

/** Rookie-scale contract length (1st round picks). */
export const CONTRACT_ROOKIE_SCALE_YEARS = 4;

/** Two-way contract length. */
export const CONTRACT_TWO_WAY_MAX_YEARS = 2;

/** Experience threshold: NTC is only for high-value veterans. */
export const CONTRACT_NTC_MIN_EXPERIENCE = 8;
/** Salary threshold for NTC eligibility (fraction of player's max-eligible salary). */
export const CONTRACT_NTC_SALARY_FLOOR = 0.75;

/** Top of the generated rookie-scale salary band as a fraction of the reference cap. */
export const CONTRACT_ROOKIE_SCALE_CAP_FRACTION = 0.09;

/**
 * Top of the generated veteran salary curve as a fraction of max eligibility.
 * Keeps ordinary rotation contracts from clustering near max money.
 */
export const CONTRACT_VETERAN_MAX_FRACTION = 0.5;

// --- Phase 3 — salary-cap rules ---

/** The NBA salary-cap year used by the Phase 3 financial model. */
export const CAP_RULES_YEAR = '2025-26';

/**
 * 2025-26 NBA system levels, in millions of dollars. The cap, floor, tax line,
 * and apron figures come from the NBA's June 30, 2025 announcement.
 */
export const SALARY_CAP = 154.647;
export const MINIMUM_TEAM_SALARY = 139.182;
export const LUXURY_TAX_LINE = 187.895;
export const FIRST_APRON = 195.945;
export const SECOND_APRON = 207.824;

/** Rounded zero-years-of-service minimum used by this game model, in millions. */
export const ROOKIE_MINIMUM_SALARY = 1.273;

/**
 * The real CBA includes 12 players in Team Salary before applying empty-roster
 * charges. Phase 3 applies this whenever cap-room salary is requested; the
 * real date window is deferred until the league-year/offseason lifecycle exists.
 */
export const INCOMPLETE_ROSTER_THRESHOLD = 12;

/** Simplified free-agent hold multiplier; Phase 4 adds explicit ownership, not new hold tiers. */
export const CAP_HOLD_PERCENTAGE = 1.5;

// --- Phase 4 — salary matching and cap enforcement ---

/** Fixed traded-player-exception allowance, in millions. CBA 101 II.B(2)(i). */
export const TRADE_ALLOWANCE = 0.25;

/**
 * 2025-26 Expanded TPE fixed cushion, in millions. The 2024-25 CBA amount
 * ($7.752M) rises with the 10% salary-cap increase for 2025-26; rounded to the
 * nearest $1,000 to match the league's published system-level precision.
 */
export const EXPANDED_TPE_CUSHION_2025_26 = 8.527;

/**
 * Estimated 2024-25 average player salary, in millions. The NBA's public CBA
 * summary specifies this input to the Early Bird formula but does not publish
 * the amount; Phase 4 deliberately uses this approved gameplay estimate.
 */
export const ESTIMATED_AVERAGE_PLAYER_SALARY_2024_25 = 11.91;

/** CBA 101 II.G(1): prior salary can set a 105% general maximum floor. */
export const MAX_PREVIOUS_SALARY_MULTIPLIER = 1.05;
/** CBA 101 II.B(2)(b-c): Early Bird and Non-Bird first-year salary formulas. */
export const EARLY_BIRD_PREVIOUS_SALARY_MULTIPLIER = 1.75;
export const EARLY_BIRD_AVERAGE_SALARY_MULTIPLIER = 1.05;
export const NON_BIRD_SALARY_MULTIPLIER = 1.2;
/** CBA 101 II.G(4): maximum contract lengths; Early Bird also has a two-year minimum. */
export const BIRD_MAX_YEARS = 5;
export const ROOM_SIGNING_MAX_YEARS = 4;
export const EARLY_BIRD_MIN_YEARS = 2;
export const EARLY_BIRD_MAX_YEARS = 4;
export const NON_BIRD_MAX_YEARS = 4;
export const MINIMUM_EXCEPTION_MAX_YEARS = 2;

// --- Phase 5a — signing exceptions / banked Standard TPEs ---
// 2025-26 MLE values: https://www.nba.com/news/nba-salary-cap-set-2025-26-season
export const NON_TAXPAYER_MLE = 14.104;
export const NON_TAXPAYER_MLE_MAX_YEARS = 4;
export const TAXPAYER_MLE = 5.685;
export const TAXPAYER_MLE_MAX_YEARS = 2;
export const ROOM_MLE = 8.781;
export const ROOM_MLE_MAX_YEARS = 3;
// 2024-25 $4.668M grown with the cap by 10%, per CBA 101:
// https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf
export const BI_ANNUAL_EXCEPTION = 5.135;
export const BAE_MAX_YEARS = 2;
export const TPE_DURATION_YEARS = 1;

/** Shared floating-point tolerance for transaction money arithmetic. */
export const MONEY_EPSILON = 1e-9;
