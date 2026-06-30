import { Player } from './player';
import { Team } from './team';
import { SeasonState } from './season';

/**
 * Bump when the on-disk shape of a SaveFile changes in a way that older files
 * can't be read as-is. `loadSave` runs `migrateSaveFile` (see data/saves/migrations.ts)
 * so older saves are upgraded on load rather than silently misread or rejected.
 *
 * v1 -> v2 (transactions Phase 1): SeasonState gains `freeAgentPool` and
 * `transactionLog`; the migration empty-inits both on pre-v2 saves.
 * v2 -> v3 (transactions Phase 2): Player.contract expanded from placeholder
 * to full model (type, salarySchedule, NTC, options); DesiredContract added
 * for free agents; FA pool repaired.
 */
export const SAVE_SCHEMA_VERSION = 3;

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

/** Derive the phase from the season cursor. Recomputed on every write so it can't drift. */
export function derivePhase(season: SeasonState): GamePhase {
  if (season.gamesPlayed >= season.totalGames) return 'offseason';
  if (season.gamesPlayed === 0 && season.currentDate < season.startDate) return 'preseason';
  return 'regular_season';
}

/**
 * A short, human-readable summary for the save list. No franchise team exists
 * yet, so this summarizes league-wide: progress through the slate plus the
 * current leader by win percentage.
 */
export function buildSummary(season: SeasonState, teams: Team[]): string {
  if (season.gamesPlayed === 0) {
    return season.gamesPlayed >= season.totalGames
      ? 'Offseason'
      : 'Preseason · not started';
  }

  const abbrev = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const leader = [...season.standings]
    .filter((s) => s.wins + s.losses > 0)
    .sort((a, b) => {
      const aPct = a.wins / (a.wins + a.losses);
      const bPct = b.wins / (b.wins + b.losses);
      if (bPct !== aPct) return bPct - aPct;
      return b.wins - a.wins;
    })[0];

  const progress = `${season.gamesPlayed}/${season.totalGames} games`;
  if (!leader) return progress;
  const tag = abbrev.get(leader.teamId) ?? leader.teamId;
  const lead = `Leader ${tag} ${leader.wins}-${leader.losses}`;
  return `${season.currentDate} · ${progress} · ${lead}`;
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
