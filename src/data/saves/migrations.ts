import { SaveFile, SAVE_SCHEMA_VERSION } from '@/models/save';
import {
  deriveReSigningRightsForCut,
  normalizePlayersForSave,
} from '@/transactions/contracts';
import { recomputeUsageAndFreeThrowFields } from '@/ratings/derivation';
import { emptyPlayoffs, zeroPlayoffStats } from '@/models/season';
import { syncPlayoffs } from '@/engine/playoffs';

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

  // --- v5 -> v6: canonical usage + free-throw derivation ---
  if (version < 6) {
    working = migrateV5toV6(working);
    migrated = true;
  }

  // --- v6 -> v7: F1 controlled-franchise identity ---
  if (version < 7) {
    working = migrateV6toV7(working);
    migrated = true;
  }

  // --- v7 -> v8: F2 postseason state ---
  if (version < 8) {
    working = migrateV7toV8(working);
    migrated = true;
  }

  // Defensive repair for a current-version file stamped by an older direct
  // write path. Current schema always implies both F2 fields are present.
  if (!working.season.playoffs || !Array.isArray(working.season.playoffPlayerStats)) {
    working = {
      ...working,
      season: {
        ...working.season,
        playoffs: working.season.playoffs ?? emptyPlayoffs(working.season.gamesPlayed >= working.season.totalGames),
        playoffPlayerStats: Array.isArray(working.season.playoffPlayerStats)
          ? working.season.playoffPlayerStats
          : zeroPlayoffStats(working.players),
      },
    };
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

  try {
    const canonical = canonicalizeF2State(working);
    if (JSON.stringify(canonical) !== JSON.stringify(working)) migrated = true;
    working = canonical;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'playoff result ledger is invalid' };
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

/** v5 -> v6: refresh persisted player derivations from deterministic raw stats. */
function migrateV5toV6(file: SaveFile): SaveFile {
  return {
    ...file,
    schemaVersion: 6,
    players: file.players.map((player) => recomputeUsageAndFreeThrowFields(player) ?? player),
  };
}

/**
 * v6 -> v7 (F1): add the canonical top-level controlled-franchise identity.
 * Pre-F1 saves had no controlled team, so they migrate to `null`
 * (spectator/commissioner mode). Deterministic, no RNG; every other field is
 * carried through untouched. Idempotent via `??`.
 */
function migrateV6toV7(file: SaveFile): SaveFile {
  return {
    ...file,
    schemaVersion: 7,
    controlledTeamId: file.controlledTeamId ?? null,
  };
}

/**
 * v7 -> v8 (F2): incomplete seasons receive an empty pending postseason.
 * Already-completed legacy seasons are grandfathered as finished rather than
 * fabricating a bracket or champion from regular-season standings.
 */
function migrateV7toV8(file: SaveFile): SaveFile {
  const legacyFinished = file.season.gamesPlayed >= file.season.totalGames;
  const normalized = normalizePlayersForSave(file.players, file.season.freeAgentPool ?? [], file.teams);
  return {
    ...file,
    schemaVersion: 8,
    players: normalized.players,
    season: {
      ...file.season,
      freeAgentPool: normalized.freeAgentPool,
      playoffs: emptyPlayoffs(legacyFinished),
      playoffPlayerStats: zeroPlayoffStats(normalized.players),
    },
  };
}

/**
 * Candidate v8 saves wrote playoff mirrors. Fold valid old result evidence into
 * the unified ledger, discard stale mirrors, and rebuild construction from the
 * ledger. Contradictory result evidence is rejected rather than guessed at.
 */
function canonicalizeF2State(file: SaveFile): SaveFile {
  const raw = file.season.playoffs as unknown as Record<string, unknown>;
  const legacyResults = Array.isArray(raw?.results) ? raw.results : [];
  const results = [...file.season.results];
  const byId = new Map(results.map((result) => [result.id, JSON.stringify(result)]));
  for (const result of legacyResults) {
    if (!result || typeof result !== 'object' || typeof (result as { id?: unknown }).id !== 'string') {
      throw new Error('playoff result evidence is malformed');
    }
    const typed = result as typeof results[number];
    const encoded = JSON.stringify(typed);
    const existing = byId.get(typed.id);
    if (existing && existing !== encoded) throw new Error(`conflicting completed result id ${typed.id}`);
    if (!existing) { results.push(typed); byId.set(typed.id, encoded); }
  }
  const rawSeries = Array.isArray(raw?.series) ? raw.series : [];
  const series = rawSeries.map((entry) => {
    const s = entry as Record<string, unknown>;
    const { teamAWins: _a, teamBWins: _b, gameIds: _g, winnerTeamId: _w, ...construction } = s;
    return construction;
  });
  const playoffs = {
    playInEnabled: raw?.playInEnabled !== false,
    startDate: typeof raw?.startDate === 'string' ? raw.startDate : null,
    endDate: typeof raw?.endDate === 'string' ? raw.endDate : null,
    seeds: Array.isArray(raw?.seeds) ? raw.seeds : [],
    series,
    schedule: Array.isArray(raw?.schedule) ? raw.schedule : [],
    ...(raw?.grandfatheredComplete === true ? { grandfatheredComplete: true as const } : {}),
  } as unknown as SaveFile['season']['playoffs'];
  const working: SaveFile = { ...file, season: { ...file.season, results, playoffs } };
  // Construction fields are deterministic cache only; rebuild them from the
  // append-only ledger so missing/stale counters, winners, status, and champion
  // fields cannot deadlock a valid save.
  syncPlayoffs(working.season, working.teams);
  return working;
}
