import { SaveFile, SAVE_SCHEMA_VERSION } from '@/models/save';
import { normalizePlayersForSave } from '@/transactions/contracts';

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

  // Normalize even current-schema saves so stale FA pools/back-references cannot
  // survive indefinitely. This is idempotent and does not require a schema bump.
  try {
    const normalized = normalizePlayersForSave(
      working.players,
      working.season.freeAgentPool ?? [],
      working.teams,
    );
    const normalizationChanged =
      JSON.stringify(normalized.players) !== JSON.stringify(working.players) ||
      JSON.stringify(normalized.freeAgentPool) !== JSON.stringify(working.season.freeAgentPool ?? []);
    if (normalizationChanged) {
      working = {
        ...working,
        players: normalized.players,
        season: { ...working.season, freeAgentPool: normalized.freeAgentPool },
      };
      migrated = true;
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'save roster normalization failed',
    };
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
 * The shared post-step normalizer generates each contract deterministically from
 * `fnv1a(player.id)` and canonicalizes roster ownership + free agency. Keeping that
 * work in one boundary makes fresh saves and migrated saves obey identical invariants.
 */
function migrateV2toV3(file: SaveFile): SaveFile {
  return {
    ...file,
    schemaVersion: 3,
  };
}
