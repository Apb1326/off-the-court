import type { SaveFile } from '@/models/save';

/**
 * The one read path for controlled-franchise identity (F1). The canonical
 * persisted home is top-level `SaveFile.controlledTeamId`; production code
 * reads it through these accessors rather than touching the field, so the
 * identity has exactly one shape everywhere it is consumed. Both functions
 * are pure — no RNG, no mutation.
 *
 * `null` = spectator/commissioner mode: no team is controlled.
 */

export function getControlledTeamId(save: SaveFile): string | null {
  return save.controlledTeamId;
}

export function isControlledTeam(save: SaveFile, teamId: string): boolean {
  return save.controlledTeamId !== null && save.controlledTeamId === teamId;
}
