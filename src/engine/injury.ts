/**
 * Injury resolution. This is pre-game, season-level logic: it decides who gets
 * hurt and who is available to play, entirely outside the game simulation. It
 * must NOT import possession.ts, shot.ts, index.ts, or any in-game module —
 * injuries are rolled before tip-off on a separate RNG stream, so they never
 * perturb the game's deterministic event sequence.
 *
 * Durability (1-80, league avg 40) drives the per-game injury rate; age and
 * back-to-backs scale it. Recovery length is drawn per injury type.
 */
import { Player } from '@/models/player';
import { PlayerInjury, PlayerRecovery, GameSummary } from '@/models/season';
import { RotationSettings } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import { addDays } from './calendar';
import {
  INJURY_BASE_RATE,
  INJURY_RATE_MIN,
  INJURY_RATE_MAX,
  INJURY_AGE_30_MULT,
  INJURY_AGE_34_MULT,
  INJURY_BACK_TO_BACK_MULT,
  INJURY_DENSE_STRETCH_MULT,
  INJURY_DENSE_STRETCH_WINDOW_DAYS,
  INJURY_DENSE_STRETCH_GAMES,
  INJURY_FRAGILITY_SPREAD,
  INJURY_WORKLOAD_REF_MINUTES,
  INJURY_WORKLOAD_EXP,
  INJURY_WORKLOAD_MULT_MIN,
  INJURY_WORKLOAD_MULT_MAX,
  INJURY_INGAME_EXIT_MIN_SEC,
  INJURY_INGAME_EXIT_MAX_SEC,
  INJURY_RECURRENCE_WINDOW,
  INJURY_RECURRENCE_MULT,
  INJURY_RECURRENCE_REGION_BIAS,
  INJURY_MIN_HEALTHY_ROSTER,
} from './constants';

type Severity = PlayerInjury['severity'];

// Body region, used to bias the injury-type mix by position (guards roll ankles,
// bigs wear down knees/feet/backs).
type InjuryRegion = 'ankle' | 'soft_tissue' | 'knee' | 'foot' | 'back' | 'upper' | 'illness';

interface InjuryTypeEntry {
  label: string;
  severity: Severity;
  minGames: number;
  maxGames: number;
  // True for acute injuries that happen during play (the player exits mid-game).
  // False for conditions you sit out from the start: illness, soreness, tightness.
  inGame: boolean;
  region: InjuryRegion;
}

/**
 * Named injuries with a severity and a recovery range (games missed).
 * ACL recovery is set to always exceed a full 82-game season — a torn ACL is a
 * ~9-12 month recovery, so it ends the player's season no matter when it occurs.
 */
const INJURY_TYPES: readonly InjuryTypeEntry[] = [
  { label: 'ankle sprain',   severity: 'day_to_day',    minGames: 1,  maxGames: 7,   inGame: true,  region: 'ankle'       },
  { label: 'ankle sprain',   severity: 'out',           minGames: 5,  maxGames: 14,  inGame: true,  region: 'ankle'       },
  { label: 'hamstring',      severity: 'out',           minGames: 5,  maxGames: 21,  inGame: true,  region: 'soft_tissue' },
  { label: 'knee soreness',  severity: 'day_to_day',    minGames: 1,  maxGames: 5,   inGame: false, region: 'knee'        },
  { label: 'knee strain',    severity: 'out',           minGames: 5,  maxGames: 20,  inGame: true,  region: 'knee'        },
  { label: 'back tightness', severity: 'day_to_day',    minGames: 1,  maxGames: 4,   inGame: false, region: 'back'        },
  { label: 'back strain',    severity: 'out',           minGames: 3,  maxGames: 18,  inGame: true,  region: 'back'        },
  { label: 'foot soreness',  severity: 'day_to_day',    minGames: 2,  maxGames: 6,   inGame: false, region: 'foot'        },
  { label: 'foot injury',    severity: 'out',           minGames: 7,  maxGames: 28,  inGame: true,  region: 'foot'        },
  { label: 'shoulder',       severity: 'out',           minGames: 3,  maxGames: 21,  inGame: true,  region: 'upper'       },
  { label: 'illness',        severity: 'day_to_day',    minGames: 1,  maxGames: 3,   inGame: false, region: 'illness'     },
  { label: 'hand/finger',    severity: 'out',           minGames: 2,  maxGames: 14,  inGame: true,  region: 'upper'       },
  { label: 'quad/hip',       severity: 'out',           minGames: 3,  maxGames: 14,  inGame: true,  region: 'soft_tissue' },
  { label: 'calf strain',    severity: 'out',           minGames: 8,  maxGames: 28,  inGame: true,  region: 'soft_tissue' },
  { label: 'ACL',            severity: 'season_ending', minGames: 82, maxGames: 100, inGame: true,  region: 'knee'        },
];

// Position-group bias on the injury-type mix. Multiplies each type's selection
// weight by its region factor for the player's position group, so guards roll
// ankles and tweak hamstrings while bigs grind down knees, feet, and backs. This
// only reshapes WHICH injury a hurt player gets — weightedChoice renormalizes, so
// the overall injury rate per player is unchanged.
type PositionGroup = 'guard' | 'wing' | 'big';

const POSITION_REGION_BIAS: Record<InjuryRegion, Record<PositionGroup, number>> = {
  ankle:       { guard: 1.30, wing: 1.15, big: 0.80 },
  soft_tissue: { guard: 1.20, wing: 1.10, big: 0.85 },
  knee:        { guard: 0.85, wing: 1.00, big: 1.25 },
  foot:        { guard: 0.85, wing: 1.00, big: 1.30 },
  back:        { guard: 0.90, wing: 1.00, big: 1.25 },
  upper:       { guard: 1.00, wing: 1.00, big: 1.00 },
  illness:     { guard: 1.00, wing: 1.00, big: 1.00 },
};

function positionGroup(position: Player['position']): PositionGroup {
  if (position === 'PG' || position === 'SG') return 'guard';
  if (position === 'SF') return 'wing';
  return 'big';
}

// Deterministic per-(season, player) value in [0, 1), used for season fragility.
function hash01(seed: number, id: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

// Normalizer so the fragility multiplier averages to 1.0 across the player pool
// (clustering redistributes risk onto fragile players; it doesn't inflate totals).
const FRAGILITY_NORM = Math.sinh(INJURY_FRAGILITY_SPREAD) / INJURY_FRAGILITY_SPREAD;

/** Hidden, season-stable fragility multiplier on a player's injury rate. */
function seasonFragility(seasonSeed: number, playerId: string): number {
  const v = hash01(seasonSeed, playerId) * 2 - 1; // [-1, 1)
  return Math.exp(INJURY_FRAGILITY_SPREAD * v) / FRAGILITY_NORM;
}

/**
 * Workload multiplier from a player's planned minutes (rotation minuteTargets).
 * Heavy-minutes players are modestly more exposed, but the curve is diminishing
 * and clamped tight so it never dominates durability — a 34-minute star lands at
 * the ~1.2 ceiling, an average-load player at 1.0, deep bench at the 0.8 floor.
 */
function workloadMultiplier(expectedMinutes: number): number {
  const w = expectedMinutes > 0 ? expectedMinutes : 1;
  const m = Math.pow(w / INJURY_WORKLOAD_REF_MINUTES, INJURY_WORKLOAD_EXP);
  return Math.max(INJURY_WORKLOAD_MULT_MIN, Math.min(INJURY_WORKLOAD_MULT_MAX, m));
}

// Maps an injury label back to its body region (every label has one region).
const LABEL_REGION: Record<string, InjuryRegion> = Object.fromEntries(
  INJURY_TYPES.map((t) => [t.label, t.region]),
);

/** The body region for an injury label (for history records / UI). */
export function injuryRegion(label: string): string {
  return LABEL_REGION[label] ?? 'illness';
}

/**
 * Opens a post-recovery vulnerability window for each just-healed injury. Called
 * with the injuries that expired this game; the returned records are added to
 * SeasonState.recoveries.
 */
export function startRecoveries(expired: PlayerInjury[]): PlayerRecovery[] {
  return expired.map((inj) => ({
    playerId: inj.playerId,
    teamId: inj.teamId,
    region: LABEL_REGION[inj.injuryType] ?? 'illness',
    gamesLeft: INJURY_RECURRENCE_WINDOW,
  }));
}

/**
 * Counts a team's recovery windows down by one game, dropping any that close.
 * Returns a new array (no in-place mutation); other teams pass through untouched.
 */
export function tickRecoveries(recoveries: PlayerRecovery[], teamId: string): PlayerRecovery[] {
  const next: PlayerRecovery[] = [];
  for (const rec of recoveries) {
    if (rec.teamId !== teamId) {
      next.push(rec);
      continue;
    }
    const gamesLeft = rec.gamesLeft - 1;
    if (gamesLeft > 0) next.push({ ...rec, gamesLeft });
  }
  return next;
}

// Selection weights, aligned 1:1 with INJURY_TYPES. Weighted toward common
// injuries; SeededRNG.weightedChoice normalizes internally. The two ankle-sprain
// entries split a combined 0.28.
const INJURY_WEIGHTS: readonly number[] = [
  0.14, // ankle sprain (day_to_day)
  0.14, // ankle sprain (out)
  0.10, // hamstring
  0.08, // knee soreness
  0.07, // knee strain
  0.06, // back tightness
  0.05, // back strain
  0.05, // foot soreness
  0.04, // foot injury
  0.06, // shoulder
  0.12, // illness
  0.06, // hand/finger
  0.05, // quad/hip
  0.04, // calf strain
  0.011, // ACL — kept rare: ~4 season-ending tears league-wide, not ~15
];

/** Age multiplier on the durability-adjusted rate. */
function ageMultiplier(age: number): number {
  if (age >= 34) return INJURY_AGE_34_MULT;
  if (age >= 30) return INJURY_AGE_30_MULT;
  return 1.0;
}

/** A newly-rolled injury that occurs during play; the player exits this game. */
export interface InGameInjury {
  injury: PlayerInjury;
  exitSeconds: number; // elapsed game time at which the player leaves
}

/**
 * The outcome of rolling injuries for one team for one game, split by when the
 * injury takes effect:
 *  - `preGame`: conditions the player sits out from tip-off (illness, soreness).
 *    The caller adds these before building the available roster.
 *  - `inGame`: acute injuries that happen during play. The player still takes the
 *    floor and exits mid-game; the caller passes the exit times to the sim and
 *    adds these injuries to season state AFTER the game (out from the next one).
 */
export interface InjuryRollResult {
  preGame: PlayerInjury[];
  inGame: InGameInjury[];
}

/**
 * Rolls fresh injuries for a team's players for a single game. Players already in
 * `currentInjuries` are skipped (they can't get re-injured while hurt).
 *
 * `scheduleMult` is the schedule-stress multiplier from scheduleStressMultiplier
 * (back-to-back × dense-stretch). `seasonSeed` drives each player's hidden,
 * season-stable fragility multiplier (clustering). `minuteTargets` (the team's
 * rotation minuteTargets) drives the workload multiplier. Determinism: every
 * eligible player consumes one nextBool() draw; on a hit, the type/recovery draws
 * (and an exit-time draw for in-game injuries) follow in a fixed order. This is a
 * separate RNG stream from the game RNG, so it never affects box scores.
 */
export function rollInjuries(
  players: Player[],
  currentInjuries: PlayerInjury[],
  gameDate: string,
  scheduleMult: number,
  seasonSeed: number,
  minuteTargets: Record<string, number>,
  recoveries: PlayerRecovery[],
  rng: SeededRNG,
): InjuryRollResult {
  const hurt = new Set(currentInjuries.map((i) => i.playerId));
  const recByPlayer = new Map(recoveries.map((r) => [r.playerId, r]));
  const result: InjuryRollResult = { preGame: [], inGame: [] };

  for (const p of players) {
    if (hurt.has(p.id)) continue;

    const durability = p.ratings.durability;
    let rate = INJURY_BASE_RATE * (40 / durability);
    rate *= ageMultiplier(p.age);
    rate *= scheduleMult;
    rate *= seasonFragility(seasonSeed, p.id);
    rate *= workloadMultiplier(minuteTargets[p.id] ?? 0);

    // Recently returned: elevated risk, peaking on the first game back and
    // decaying linearly over the window.
    const recovery = recByPlayer.get(p.id);
    if (recovery) {
      const windowFrac = recovery.gamesLeft / INJURY_RECURRENCE_WINDOW;
      rate *= 1 + (INJURY_RECURRENCE_MULT - 1) * windowFrac;
    }

    rate = Math.max(INJURY_RATE_MIN, Math.min(INJURY_RATE_MAX, rate));

    if (!rng.nextBool(rate)) continue;

    // Bias the type mix by position group (guards roll ankles, bigs grind knees),
    // and toward the recovering region for a returning player (recurrence).
    const group = positionGroup(p.position);
    const weights = INJURY_WEIGHTS.map((w, i) => {
      let weight = w * POSITION_REGION_BIAS[INJURY_TYPES[i].region][group];
      if (recovery && INJURY_TYPES[i].region === recovery.region) weight *= INJURY_RECURRENCE_REGION_BIAS;
      return weight;
    });
    const type = rng.weightedChoice(INJURY_TYPES as InjuryTypeEntry[], weights);
    const gamesRemaining = rng.nextInt(type.minGames, type.maxGames);
    const injury: PlayerInjury = {
      playerId: p.id,
      teamId: p.teamId,
      injuryType: type.label,
      severity: type.severity,
      gamesRemaining,
      startDate: gameDate,
    };

    if (type.inGame) {
      const exitSeconds = rng.nextInt(INJURY_INGAME_EXIT_MIN_SEC, INJURY_INGAME_EXIT_MAX_SEC);
      result.inGame.push({ injury, exitSeconds });
    } else {
      result.preGame.push(injury);
    }
  }

  return result;
}

/**
 * Counts existing injuries down by one game for the given team. Returns a NEW
 * array (no in-place mutation) with expired injuries (gamesRemaining hits 0)
 * removed. Other teams' injuries pass through untouched.
 */
export function tickInjuries(injuries: PlayerInjury[], teamId: string): PlayerInjury[] {
  const next: PlayerInjury[] = [];
  for (const inj of injuries) {
    if (inj.teamId !== teamId) {
      next.push(inj);
      continue;
    }
    const remaining = inj.gamesRemaining - 1;
    if (remaining > 0) next.push({ ...inj, gamesRemaining: remaining });
  }
  return next;
}

/**
 * The players actually available to play. Filters out anyone currently injured.
 * If that drops the team below `minRequired`, the least-severe injured players
 * (smallest gamesRemaining first) are added back as emergency hardship so a game
 * can always be fielded.
 */
export function getHealthyPlayers(
  players: Player[],
  injuries: PlayerInjury[],
  minRequired: number = INJURY_MIN_HEALTHY_ROSTER,
): Player[] {
  const hurt = new Map(injuries.map((i) => [i.playerId, i]));
  const healthy = players.filter((p) => !hurt.has(p.id));
  if (healthy.length >= minRequired) return healthy;

  const injuredOnTeam = players
    .filter((p) => hurt.has(p.id))
    .sort((a, b) => hurt.get(a.id)!.gamesRemaining - hurt.get(b.id)!.gamesRemaining);

  for (const p of injuredOnTeam) {
    if (healthy.length >= minRequired) break;
    healthy.push(p);
  }
  return healthy;
}

/**
 * True if the team played on the calendar day immediately before `gameDate`.
 * Pure — no RNG.
 */
export function isBackToBack(
  teamId: string,
  gameDate: string,
  results: GameSummary[],
): boolean {
  const prev = addDays(gameDate, -1);
  return results.some(
    (g) => g.date === prev && (g.homeTeamId === teamId || g.awayTeamId === teamId),
  );
}

/**
 * Schedule-stress multiplier on the injury rate. Combines a back-to-back bump
 * (a game yesterday) with a dense-stretch bump (many games in a short window —
 * e.g. 4 games in 5 nights). Returns 1.0 for a well-rested team. Pure — no RNG.
 */
export function scheduleStressMultiplier(
  teamId: string,
  gameDate: string,
  results: GameSummary[],
): number {
  let mult = 1.0;
  if (isBackToBack(teamId, gameDate, results)) mult *= INJURY_BACK_TO_BACK_MULT;

  let gamesInWindow = 0;
  for (let d = 1; d <= INJURY_DENSE_STRETCH_WINDOW_DAYS; d++) {
    const day = addDays(gameDate, -d);
    if (results.some((g) => g.date === day && (g.homeTeamId === teamId || g.awayTeamId === teamId))) {
      gamesInWindow++;
    }
  }
  if (gamesInWindow >= INJURY_DENSE_STRETCH_GAMES) mult *= INJURY_DENSE_STRETCH_MULT;

  return mult;
}

/**
 * Adjusts a team's rotation so injured players don't take the floor. The starting
 * five comes from rotation.starters (not the players array), so without this an
 * injured starter would still start. Each injured starter is replaced by the next
 * healthy player in rotationOrder (coach preference), then any other healthy id;
 * rotationOrder is filtered to healthy players. Pure — no RNG.
 */
export function adjustRotation(
  rotation: RotationSettings,
  healthyIds: Set<string>,
): RotationSettings {
  const starters = rotation.starters.slice() as string[];
  const used = new Set(starters.filter((id) => healthyIds.has(id)));

  // Candidate replacements: rotation order first (preference), then any other
  // healthy player not already starting.
  const candidates = [
    ...rotation.rotationOrder.filter((id) => healthyIds.has(id) && !used.has(id)),
    ...[...healthyIds].filter((id) => !used.has(id) && !rotation.rotationOrder.includes(id)),
  ];
  let nextCandidate = 0;

  for (let i = 0; i < starters.length; i++) {
    if (healthyIds.has(starters[i])) continue;
    // Find the next unused healthy candidate.
    while (nextCandidate < candidates.length && used.has(candidates[nextCandidate])) {
      nextCandidate++;
    }
    if (nextCandidate < candidates.length) {
      starters[i] = candidates[nextCandidate];
      used.add(candidates[nextCandidate]);
      nextCandidate++;
    }
    // If no healthy candidate remains, leave the slot as-is; the < 5 guard in
    // advanceSeason is the final backstop (shouldn't trigger given the floor of 8).
  }

  return {
    ...rotation,
    starters: starters as [string, string, string, string, string],
    rotationOrder: rotation.rotationOrder.filter((id) => healthyIds.has(id)),
  };
}
