import { SaveFile, SAVE_SCHEMA_VERSION } from '@/models/save';
import { Contract, Player, PlayerRatings } from '@/models/player';
import { SeededRNG } from '@/lib/rng';
import { fnv1a } from '@/lib/hash';
import { generateDesiredContract } from '@/transactions/contracts';
import {
  FREE_AGENT_TEAM_ID,
  CONTRACT_MINIMUM_SALARY,
  CONTRACT_TWO_WAY_SALARY,
  CONTRACT_TWO_WAY_MAX_YEARS,
  CONTRACT_ROOKIE_SCALE_YEARS,
  CONTRACT_MAX_YEARS,
  CONTRACT_REFERENCE_CAP,
  CONTRACT_MAX_PCT_0_6,
  CONTRACT_MAX_PCT_7_9,
  CONTRACT_MAX_PCT_10_PLUS,
  CONTRACT_NTC_MIN_EXPERIENCE,
  CONTRACT_NTC_SALARY_FLOOR,
} from '@/transactions/constants';

/**
 * Save-schema migrations. `loadSave` runs `migrateSaveFile` on every load so older saves
 * are upgraded to the current shape instead of being rejected or silently misread.
 *
 * Rules (per AGENTS.md "Deterministic, idempotent migrations"):
 *  - Each step targets a specific version and is applied in order.
 *  - Migration is idempotent: re-running it on an already-current file is a no-op.
 *  - A save from a *newer* (unknown) version is rejected, never down-converted.
 *  - Phase 1's only step generates no data (empty-init), so no RNG is involved. Any future
 *    step that generates data must seed from a stable per-id key on a dedicated RNG stream.
 */

export type MigrationResult =
  | { ok: true; file: SaveFile; migrated: boolean }
  | { ok: false; reason: string };

/**
 * Bring a loaded SaveFile up to `SAVE_SCHEMA_VERSION`, or reject it if it comes from a
 * newer build. Returns `migrated: true` only when at least one step ran.
 */
export function migrateSaveFile(file: SaveFile): MigrationResult {
  // A pre-versioning or corrupt file is treated as version 0 (oldest).
  const version = typeof file.schemaVersion === 'number' ? file.schemaVersion : 0;

  if (version > SAVE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `save schema version ${version} is newer than this build supports (max ${SAVE_SCHEMA_VERSION})`,
    };
  }

  let working = file;
  let migrated = false;

  // --- v1 -> v2: transactions Phase 1 (free-agent pool + transaction log) ---
  if (version < 2) {
    working = migrateV1toV2(working);
    migrated = true;
  }

  // --- v2 -> v3: transactions Phase 2 (contracts) ---
  if (version < 3) {
    working = migrateV2toV3(working);
    migrated = true;
  }

  // (future steps append here, each gated on `version < N` and bumping to N)

  return { ok: true, file: working, migrated };
}

/**
 * v1 -> v2: introduce the roster-transaction structures. Empty-init the free-agent pool
 * and the append-only transaction log on the season. Idempotent: a pre-existing array is
 * preserved (`??`), so nothing is ever clobbered if this runs more than once.
 */
function migrateV1toV2(file: SaveFile): SaveFile {
  const season = file.season;
  return {
    ...file,
    schemaVersion: 2,
    season: {
      ...season,
      freeAgentPool: season.freeAgentPool ?? [],
      transactionLog: season.transactionLog ?? [],
    },
  };
}

/**
 * v2 -> v3: expand Player.contract from the Phase 1 placeholder to the full model.
 * Each player's contract is generated deterministically from `fnv1a(player.id)` on a
 * per-player SeededRNG, so migration is idempotent and order-independent.
 *
 * Also repairs the FA pool: players with `teamId === ''` who are not already in
 * `season.freeAgentPool` are added.
 */
function migrateV2toV3(file: SaveFile): SaveFile {
  const poolSet = new Set(file.season.freeAgentPool ?? []);
  const repairedPool = [...(file.season.freeAgentPool ?? [])];

  const players: Player[] = file.players.map((p) => {
    // Repair FA pool: any player with the FA sentinel who isn't in the pool
    if (p.teamId === FREE_AGENT_TEAM_ID && !poolSet.has(p.id)) {
      poolSet.add(p.id);
      repairedPool.push(p.id);
    }

    // Idempotency guard: if contract already has a string `type`, it's been migrated
    if (typeof (p.contract as unknown as Record<string, unknown>).type === 'string') {
      return p;
    }

    const contract = generateContractForMigration(p);
    const isFreeAgent = p.teamId === FREE_AGENT_TEAM_ID;
    const desiredContract = isFreeAgent
      ? generateDesiredContract({ contract, ratings: p.ratings })
      : undefined;

    return { ...p, contract, desiredContract };
  });

  return {
    ...file,
    schemaVersion: 3,
    players,
    season: {
      ...file.season,
      freeAgentPool: repairedPool,
    },
  };
}

/** Average of all PlayerRatings values — for contract tier logic only. */
function migrationOverall(ratings: PlayerRatings): number {
  const values = Object.values(ratings) as number[];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Max-eligible salary by experience bracket. */
function maxEligibleSalary(experience: number): number {
  if (experience >= 10) return CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_10_PLUS;
  if (experience >= 7) return CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_7_9;
  return CONTRACT_REFERENCE_CAP * CONTRACT_MAX_PCT_0_6;
}

/** Clamp years by age: older players get fewer remaining years. */
function ageAdjustedYears(years: number, age: number): number {
  return Math.min(years, Math.max(1, CONTRACT_MAX_YEARS - Math.max(0, age - 30)));
}

function roundSalary(millions: number): number {
  return Math.round(millions * 10) / 10;
}

/**
 * Generate a plausible contract for a player at migration time.
 * Strict precedence: two-way → rookie-scale → minimum → max → veteran.
 * Seeded per-player from fnv1a(player.id) — order-independent and idempotent.
 */
function generateContractForMigration(player: Player): Contract {
  const rng = new SeededRNG(fnv1a(player.id));
  const overall = migrationOverall(player.ratings);
  const { age, experience } = player;
  const maxEligible = maxEligibleSalary(experience);

  // 1. TWO-WAY: low-rated young players
  if (overall < 32 && experience <= 2) {
    return {
      type: 'two_way',
      salarySchedule: Array.from(
        { length: rng.nextInt(1, CONTRACT_TWO_WAY_MAX_YEARS) },
        () => CONTRACT_TWO_WAY_SALARY,
      ),
      noTradeClause: false,
    };
  }

  // 2. ROOKIE-SCALE: young, inexperienced
  if (experience <= 3 && age <= 23) {
    const salary = roundSalary(
      CONTRACT_MINIMUM_SALARY + (overall / 80) * (0.15 * CONTRACT_REFERENCE_CAP - CONTRACT_MINIMUM_SALARY),
    );
    const hasOption = rng.nextBool(0.5);
    const years = CONTRACT_ROOKIE_SCALE_YEARS;
    return {
      type: 'rookie_scale',
      salarySchedule: Array.from({ length: years }, () => salary),
      noTradeClause: false,
      option: hasOption ? { type: 'team', year: years - 1 } : undefined,
    };
  }

  // 3. MINIMUM: low-rated or old
  if (overall < 35 || age >= 36) {
    const years = ageAdjustedYears(rng.nextInt(1, 2), age);
    return {
      type: 'minimum',
      salarySchedule: Array.from({ length: years }, () => CONTRACT_MINIMUM_SALARY),
      noTradeClause: false,
    };
  }

  // 4. MAX: stars
  if (overall >= 60) {
    const salary = roundSalary(maxEligible);
    const baseYears = rng.nextInt(3, CONTRACT_MAX_YEARS);
    const years = ageAdjustedYears(baseYears, age);

    const ntcEligible =
      experience >= CONTRACT_NTC_MIN_EXPERIENCE &&
      salary >= CONTRACT_NTC_SALARY_FLOOR * maxEligible;
    const noTradeClause = ntcEligible && rng.nextBool(0.5);

    const hasOption = rng.nextBool(0.3);
    const optionType = rng.nextBool(0.5) ? 'player' as const : 'team' as const;

    return {
      type: 'max',
      salarySchedule: Array.from({ length: years }, () => salary),
      noTradeClause,
      option: hasOption && years > 1 ? { type: optionType, year: years - 1 } : undefined,
    };
  }

  // 5. VETERAN: everything else
  {
    const fraction = (overall - 35) / (60 - 35); // 0..1 within the veteran range
    const salary = roundSalary(
      CONTRACT_MINIMUM_SALARY + fraction * (0.8 * maxEligible - CONTRACT_MINIMUM_SALARY),
    );
    const baseYears = rng.nextInt(1, CONTRACT_MAX_YEARS);
    const years = ageAdjustedYears(baseYears, age);

    const hasOption = rng.nextBool(0.2);
    const optionType = rng.nextBool(0.5) ? 'player' as const : 'team' as const;

    return {
      type: 'veteran',
      salarySchedule: Array.from({ length: years }, () => salary),
      noTradeClause: false,
      option: hasOption && years > 1 ? { type: optionType, year: years - 1 } : undefined,
    };
  }
}
