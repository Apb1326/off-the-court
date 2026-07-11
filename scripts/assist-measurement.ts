/** Read-only assist-definition measurements from GameDiagObserver.onShot.
 * The scorekeeper-aligned proxy needs initial action and pass provenance that
 * is deliberately absent from persisted PlayByPlayEvent records. */
import { PlayType, ShotZone } from '../src/models/game';

export const ASSIST_ZONES: readonly ShotZone[] = [
  'rim', 'short_midrange', 'long_midrange', 'corner_three', 'above_break_three', 'deep_three',
];

export interface DiagnosticShot {
  initialPlayType: PlayType;
  terminalPlayType: PlayType;
  passCount: number;
  zone: ShotZone;
  made: boolean;
  assisted: boolean;
}

export interface AssistZoneCounts {
  made: number;
  strict: number;
  proxy: number;
  zeroPassAttempts: number;
  catchAndShootZeroPassAttempts: number;
}

export interface AssistMeasurements {
  readonly byZone: ReadonlyMap<ShotZone, AssistZoneCounts>;
  readonly passCounts: ReadonlyMap<number, number>;
  record(shot: DiagnosticShot): void;
}

export function isScorekeeperAlignedProxyMake(shot: DiagnosticShot): boolean {
  return shot.made && (shot.assisted || (
    shot.passCount === 0 && (shot.initialPlayType === 'spot_up' || shot.initialPlayType === 'off_screen')
  ));
}

export function createAssistMeasurements(): AssistMeasurements {
  const byZone = new Map<ShotZone, AssistZoneCounts>(ASSIST_ZONES.map((zone) => [zone, {
    made: 0, strict: 0, proxy: 0, zeroPassAttempts: 0, catchAndShootZeroPassAttempts: 0,
  }]));
  const passCounts = new Map<number, number>();
  return {
    byZone,
    passCounts,
    record(shot) {
      const counts = byZone.get(shot.zone)!;
      passCounts.set(shot.passCount, (passCounts.get(shot.passCount) ?? 0) + 1);
      if (shot.passCount === 0) {
        counts.zeroPassAttempts++;
        if (shot.initialPlayType === 'spot_up' || shot.initialPlayType === 'off_screen') {
          counts.catchAndShootZeroPassAttempts++;
        }
      }
      if (!shot.made) return;
      counts.made++;
      if (shot.assisted) counts.strict++;
      if (isScorekeeperAlignedProxyMake(shot)) counts.proxy++;
    },
  };
}

export function hasCornerProxySignStructure(byZone: ReadonlyMap<ShotZone, AssistZoneCounts>): boolean {
  const corner = byZone.get('corner_three')!;
  if (corner.made === 0) return false;
  const cornerRate = corner.proxy / corner.made;
  return ASSIST_ZONES.filter((zone) => zone !== 'corner_three').every((zone) => {
    const row = byZone.get(zone)!;
    return row.made > 0 && cornerRate > row.proxy / row.made;
  });
}
