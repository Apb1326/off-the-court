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

/** Temporary Phase 3 free-agent hold multiplier; explicit rights arrive in Phase 4. */
export const CAP_HOLD_PERCENTAGE = 1.5;
