import { readFile, writeFile, mkdir, readdir, rename, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  SaveFile,
  SaveMetadata,
  SAVE_SCHEMA_VERSION,
  derivePhase,
  metadataFor,
} from '@/models/save';
import { deriveChampion, derivePlayoffStatus } from '@/engine/playoffs';
import { migrateSaveFile } from './migrations';
import { normalizePlayersForSave } from '@/transactions/contracts';
import { emptyPlayoffs, zeroPlayoffStats } from '@/models/season';

/** Reserved slot id for the auto-save. Lives alongside manual slots but is never a manual name. */
export const AUTOSAVE_ID = '__autosave__';

/** A save whose ledger or bracket evidence fails validation must never reach disk. */
export class SaveValidationError extends Error {
  readonly code = 'SAVE_VALIDATION_FAILED';

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown validation error';
    super(`Save validation failed: ${detail}`);
    this.name = 'SaveValidationError';
  }
}

/** Result of attempting to load a full save — never throws on a bad/old/missing file. */
export type LoadResult =
  | { ok: true; file: SaveFile }
  | { ok: false; reason: string };

/** One save folder that could not be listed (corrupt/unparseable metadata). Surfaced, not thrown. */
export interface SaveListError {
  saveId: string;
  reason: string;
}

const SAVE_FILE = 'save.json';
const META_FILE = 'metadata.json';
const ACTIVE_FILE = 'active.json';

/**
 * File-backed multi-save store. One folder per save under `<dataDir>/saves/`,
 * each holding the full `save.json` plus a cheap `metadata.json`. Mirrors the
 * conventions of JsonStore (ensureDir + JSON read/write) but adds atomic writes
 * (temp file + rename) so a crash mid-write can't corrupt a slot.
 */
export class SaveStore {
  private root: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'saves');
  }

  // --- paths ---
  private dir(saveId: string): string {
    return path.join(this.root, saveId);
  }
  private savePath(saveId: string): string {
    return path.join(this.dir(saveId), SAVE_FILE);
  }
  private metaPath(saveId: string): string {
    return path.join(this.dir(saveId), META_FILE);
  }
  private get activePath(): string {
    return path.join(this.root, ACTIVE_FILE);
  }

  // --- low-level io ---
  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  /** Atomic write: serialize to a sibling temp file, then rename over the target. */
  private async writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, filePath);
  }

  // --- slot ids ---
  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || 'save';
  }

  /** A folder id derived from the name, made unique against existing slots (and reserved ids). */
  private uniqueId(name: string): string {
    const base = this.slugify(name);
    const taken = (id: string) => id === AUTOSAVE_ID || existsSync(this.dir(id));
    if (!taken(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base}-${i}`;
      if (!taken(candidate)) return candidate;
    }
  }

  // --- core writes ---

  /**
   * Persist a full save into `saveId`, refreshing schemaVersion/phase/updatedAt and
   * writing both `save.json` and the derived `metadata.json`. `createdAt` is taken
   * from the passed file (callers control creation-time continuity).
   */
  private async writeSave(
    saveId: string,
    file: SaveFile,
    opts: { name: string; isAutosave: boolean },
  ): Promise<SaveMetadata> {
    const now = new Date().toISOString();
    // Legacy single-season imports reach this write boundary without passing
    // through loadSave/migrations. Canonicalize the F2 fields before stamping
    // the current schema so a malformed v8 save can never be written.
    const season = file.season.playoffs && Array.isArray(file.season.playoffPlayerStats)
      ? file.season
      : {
          ...file.season,
          playoffs: file.season.playoffs ?? emptyPlayoffs(file.season.gamesPlayed >= file.season.totalGames),
          playoffPlayerStats: Array.isArray(file.season.playoffPlayerStats)
            ? file.season.playoffPlayerStats
            : zeroPlayoffStats(file.players),
        };
    // Completed playoff state is derived from the authoritative result ledger.
    // `derivePlayoffStatus` reaches the champion only after the regular slate;
    // call both so malformed mid-playoff evidence is rejected before writing.
    try {
      derivePlayoffStatus(season);
      deriveChampion(season);
    } catch (error) {
      throw new SaveValidationError(error);
    }
    const { players: normalizedPlayers, freeAgentPool: normalizedPool } =
      normalizePlayersForSave(file.players, season.freeAgentPool, file.teams);
    const full: SaveFile = {
      ...file,
      players: normalizedPlayers,
      season: { ...season, freeAgentPool: normalizedPool },
      schemaVersion: SAVE_SCHEMA_VERSION,
      phase: derivePhase(season),
      createdAt: file.createdAt || now,
      updatedAt: now,
    };
    const meta = metadataFor(saveId, opts.name, opts.isAutosave, full);
    await this.ensureDir(this.dir(saveId));
    // Write the big file first, then the header it summarizes.
    await this.writeJsonAtomic(this.savePath(saveId), full);
    await this.writeJsonAtomic(this.metaPath(saveId), meta);
    return meta;
  }

  // --- public api ---

  /** List every save's metadata (cheap). Corrupt/unreadable folders are skipped and surfaced. */
  async listSaves(): Promise<{ saves: SaveMetadata[]; errors: SaveListError[] }> {
    const saves: SaveMetadata[] = [];
    const errors: SaveListError[] = [];
    if (!existsSync(this.root)) return { saves, errors };

    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // skip active.json and stray files
      const meta = await this.readJson<SaveMetadata>(this.metaPath(entry.name));
      if (!meta) {
        errors.push({ saveId: entry.name, reason: 'missing or unparseable metadata.json' });
        continue;
      }
      saves.push(meta);
    }

    // Auto-save first, then most-recently-updated.
    saves.sort((a, b) => {
      if (a.isAutosave !== b.isAutosave) return a.isAutosave ? -1 : 1;
      return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    });
    return { saves, errors };
  }

  /**
   * Load a full save. Never throws: missing or unparseable returns ok:false. An older save
   * is migrated up to the current schema on read (see `migrateSaveFile`); only a save from a
   * *newer*, unknown build is rejected. The migrated file is returned in memory — it is
   * persisted as the current version on the next write (writeSave stamps SAVE_SCHEMA_VERSION).
   */
  async loadSave(saveId: string): Promise<LoadResult> {
    const raw = await this.readJson<SaveFile>(this.savePath(saveId));
    if (!raw) return { ok: false, reason: 'missing or unparseable save.json' };
    const migration = migrateSaveFile(raw);
    if (!migration.ok) return { ok: false, reason: migration.reason };
    return { ok: true, file: migration.file };
  }

  /** Create a brand-new manual slot from the given state. Returns the new slot's metadata. */
  async createSave(name: string, file: SaveFile): Promise<SaveMetadata> {
    const saveId = this.uniqueId(name);
    const now = new Date().toISOString();
    return this.writeSave(saveId, { ...file, createdAt: now }, { name, isAutosave: false });
  }

  /** Overwrite an existing manual slot, preserving its original name and creation time. */
  async overwriteSave(saveId: string, file: SaveFile): Promise<SaveMetadata | { error: string }> {
    if (!existsSync(this.dir(saveId))) return { error: `save "${saveId}" does not exist` };
    const existing = await this.readJson<SaveMetadata>(this.metaPath(saveId));
    const name = existing?.name ?? saveId;
    const createdAt = existing?.createdAt ?? file.createdAt;
    return this.writeSave(saveId, { ...file, createdAt }, { name, isAutosave: saveId === AUTOSAVE_ID });
  }

  /** Delete a slot and everything in it. No-op if it doesn't exist. */
  async deleteSave(saveId: string): Promise<void> {
    if (existsSync(this.dir(saveId))) await rm(this.dir(saveId), { recursive: true, force: true });
  }

  /** Rename a slot's display name. Only `metadata.json` changes — the folder id stays stable. */
  async renameSave(saveId: string, newName: string): Promise<SaveMetadata | { error: string }> {
    const meta = await this.readJson<SaveMetadata>(this.metaPath(saveId));
    if (!meta) return { error: `save "${saveId}" does not exist` };
    const updated: SaveMetadata = { ...meta, name: newName, updatedAt: new Date().toISOString() };
    await this.writeJsonAtomic(this.metaPath(saveId), updated);
    return updated;
  }

  // --- auto-save + active pointer ---

  /** Write the live state into the reserved auto-save slot, preserving its original creation time. */
  async autoSave(file: SaveFile): Promise<SaveMetadata> {
    const existing = await this.readJson<SaveMetadata>(this.metaPath(AUTOSAVE_ID));
    const createdAt = existing?.createdAt ?? file.createdAt;
    const metadata = await this.writeSave(AUTOSAVE_ID, { ...file, createdAt }, { name: 'Auto-save', isAutosave: true });
    await this.setActiveSaveId(AUTOSAVE_ID);
    return metadata;
  }

  async getActiveSaveId(): Promise<string | null> {
    const data = await this.readJson<{ saveId: string }>(this.activePath);
    return data?.saveId ?? null;
  }

  async setActiveSaveId(saveId: string): Promise<void> {
    await this.writeJsonAtomic(this.activePath, { saveId });
  }

  /** Load whichever save is currently active (the live working state). */
  async loadActiveSave(): Promise<SaveFile | null> {
    const id = await this.getActiveSaveId();
    if (!id) return null;
    const res = await this.loadSave(id);
    return res.ok ? res.file : null;
  }

  /**
   * Make a manual slot the live state: copy it into the auto-save slot and point
   * active at it. The manual slot is left untouched, so continued play (which
   * auto-saves) can never clobber the checkpoint the player loaded from.
   */
  async copyToAutosave(saveId: string): Promise<SaveFile | { error: string }> {
    const res = await this.loadSave(saveId);
    if (!res.ok) return { error: res.reason };
    await this.autoSave(res.file);
    return res.file;
  }
}
