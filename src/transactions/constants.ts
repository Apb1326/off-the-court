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
 * IMPORTANT: these govern the STANDARD roster only. Two-way slots are a separate category
 * (roadmap Phase 2+) with their own limited slot count — never fold a two-way count into
 * these numbers.
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
