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
