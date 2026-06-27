import { Player } from './player';
import { Team } from './team';
import { SeasonState, isControlledTeam, getControlledTeamId, normalizeSeasonState } from './season';

/**
 * Bump when the on-disk shape of a SaveFile changes in a way that older files
 * can't be read as-is. `loadSave` runs `migrateSave` against this so older files
 * are brought forward (and truly unknown/newer ones rejected) instead of being
 * silently misread.
 *
 * History:
 *   1 — initial multi-save format.
 *   2 — added `season.controlledTeamId` (player's franchise team).
 */
export const SAVE_SCHEMA_VERSION = 2;

/**
 * Coarse game phase. Finer states (sitting on the trade deadline, the All-Star
 * break) are derived from `season.currentDate` vs `season.markers` at read time;
 * this enum only captures the boundaries the save list cares about.
 */
export type GamePhase = 'preseason' | 'regular_season' | 'offseason';

/**
 * A complete, self-contained snapshot of game progress — everything needed to
 * resume deterministically at the exact point the player stopped.
 *
 * Determinism note: there is no long-lived RNG stream to persist. The game-sim
 * and injury RNGs are rebuilt per game from `season.seed` (see `advanceSeason`
 * in engine/season.ts), so the full RNG state is captured by `season.seed` plus
 * the set of already-played games in `season.results`. Reloading and continuing
 * never resets a seed. Rosters are snapshotted per save (rather than shared from
 * the global `data/teams.json` / `data/players.json`) so saves stay independent
 * once roster mutation (trades, offseason) lands.
 */
export interface SaveFile {
  schemaVersion: number;
  phase: GamePhase;
  season: SeasonState;
  teams: Team[];
  players: Player[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * The cheap-to-read header for one save. Persisted alongside the full `SaveFile`
 * in its own `metadata.json` so the save-list screen can render without
 * deserializing the (large) season + rosters.
 */
export interface SaveMetadata {
  schemaVersion: number;
  saveId: string;
  name: string;
  isAutosave: boolean;
  createdAt: string;
  updatedAt: string;
  inGameDate: string; // season.currentDate
  phase: GamePhase;
  summary: string; // human-readable one-liner, e.g. "Day 34 · 210/1230 games · Leader BOS 24-6"
}

/**
 * Bring a loaded SaveFile up to `SAVE_SCHEMA_VERSION`, or return null if it can't
 * be (an unknown or newer-than-supported version). Migrations are applied step by
 * step so a save several versions old still arrives at the current shape:
 *
 *   1 → 2: `season.controlledTeamId` did not exist; default it to null
 *          (no controlled team) via `normalizeSeasonState`.
 *
 * Never throws and never mutates the input — callers (`loadSave`) get back a fresh
 * object they can treat as current, or null to reject gracefully.
 */
export function migrateSave(file: SaveFile): SaveFile | null {
  let version = file.schemaVersion;
  let season = file.season;

  if (version === 1) {
    season = normalizeSeasonState({ ...season });
    version = 2;
  }

  // Only accept a file we managed to bring exactly to the current version.
  if (version !== SAVE_SCHEMA_VERSION) return null;
  return { ...file, schemaVersion: version, season };
}

/** Derive the phase from the season cursor. Recomputed on every write so it can't drift. */
export function derivePhase(season: SeasonState): GamePhase {
  if (season.gamesPlayed >= season.totalGames) return 'offseason';
  if (season.gamesPlayed === 0 && season.currentDate < season.startDate) return 'preseason';
  return 'regular_season';
}

/**
 * A short, human-readable summary for the save list. When the player controls a
 * team, the summary is written from that franchise's perspective (its record);
 * otherwise it falls back to a league-wide view (the current leader by win pct).
 */
export function buildSummary(season: SeasonState, teams: Team[]): string {
  const abbrev = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const controlledId = getControlledTeamId(season);
  const tagFor = (teamId: string) => abbrev.get(teamId) ?? teamId;

  if (season.gamesPlayed === 0) {
    const phase = season.gamesPlayed >= season.totalGames ? 'Offseason' : 'Preseason · not started';
    // Surface the franchise even before tip-off so the save list identifies it.
    return controlledId ? `${phase} · ${tagFor(controlledId)}` : phase;
  }

  const progress = `${season.gamesPlayed}/${season.totalGames} games`;

  // Controlled-team perspective: lead with the franchise's own record.
  if (controlledId) {
    const mine = season.standings.find((s) => isControlledTeam(season, s.teamId));
    if (mine) return `${season.currentDate} · ${progress} · ${tagFor(controlledId)} ${mine.wins}-${mine.losses}`;
  }

  // League-wide fallback: the current leader by win percentage.
  const leader = [...season.standings]
    .filter((s) => s.wins + s.losses > 0)
    .sort((a, b) => {
      const aPct = a.wins / (a.wins + a.losses);
      const bPct = b.wins / (b.wins + b.losses);
      if (bPct !== aPct) return bPct - aPct;
      return b.wins - a.wins;
    })[0];

  if (!leader) return progress;
  return `${season.currentDate} · ${progress} · Leader ${tagFor(leader.teamId)} ${leader.wins}-${leader.losses}`;
}

/** Build the metadata header for a save from its full file. */
export function metadataFor(saveId: string, name: string, isAutosave: boolean, file: SaveFile): SaveMetadata {
  return {
    schemaVersion: file.schemaVersion,
    saveId,
    name,
    isAutosave,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    inGameDate: file.season.currentDate,
    phase: file.phase,
    summary: buildSummary(file.season, file.teams),
  };
}
