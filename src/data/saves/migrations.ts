import { SaveFile, SAVE_SCHEMA_VERSION } from '@/models/save';
import {
  deriveReSigningRightsForCut,
  normalizePlayersForSave,
} from '@/transactions/contracts';

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

  // --- v3 -> v4: transactions Phase 4 (rights + persisted hard-cap state) ---
  if (version < 4) {
    working = migrateV3toV4(working);
    migrated = true;
  }

  // --- v4 -> v5: transactions Phase 5a (TPE + exception event-state ledgers) ---
  if (version < 5) {
    working = migrateV4toV5(working);
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

/**
 * v3 -> v4: reconstruct explicit re-signing rights for current free agents.
 *
 * The latest relevant sign/cut event decides whether a cut is applicable. A
 * legacy cut without its immutable contract snapshot cannot create rights.
 * Team hard-cap state is intentionally absent by default; no undefined key is
 * added. The transaction log is read only and returned byte-for-byte unchanged.
 */
function migrateV3toV4(file: SaveFile): SaveFile {
  const rosteredPlayerIds = new Set(file.teams.flatMap((team) => team.roster));
  const currentFreeAgentIds = new Set(
    file.players
      .filter((player) => !rosteredPlayerIds.has(player.id))
      .map((player) => player.id),
  );
  const latestRelevantEntry = new Map<string, (typeof file.season.transactionLog)[number]>();

  for (const entry of file.season.transactionLog ?? []) {
    if (
      (entry.type === 'sign' || entry.type === 'cut') &&
      currentFreeAgentIds.has(entry.playerId)
    ) {
      latestRelevantEntry.set(entry.playerId, entry);
    }
  }

  const players = file.players.map((player) => {
    if (!currentFreeAgentIds.has(player.id)) return player;

    // v3 had no canonical rights field. Strip any stray key before rebuilding
    // so no applicable cut means canonical absence, not undefined or stale data.
    const withoutBirdRights = { ...player };
    delete withoutBirdRights.birdRights;
    const entry = latestRelevantEntry.get(player.id);
    if (entry?.type !== 'cut' || entry.contractAtCut === undefined) {
      return withoutBirdRights;
    }

    return {
      ...withoutBirdRights,
      birdRights: deriveReSigningRightsForCut(
        entry.contractAtCut,
        player.experience,
        entry.fromTeamId,
      ),
    };
  });

  return {
    ...file,
    schemaVersion: 4,
    players,
  };
}


/** v4 -> v5: empty-init new append-only ledgers without rewriting old log entries. */
function migrateV4toV5(file: SaveFile): SaveFile {
  return {
    ...file,
    schemaVersion: 5,
    season: {
      ...file.season,
      tradeExceptions: file.season.tradeExceptions ?? [],
      // Legacy room usage cannot be reconstructed reliably; canonical migration is empty.
      teamExceptionStates: file.season.teamExceptionStates ?? [],
    },
  };
}
