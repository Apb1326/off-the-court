import { ShotEventRow } from './types';

export const HEAVE_DISTANCE_FT = 32;
export const HEAVE_SECONDS_LEFT = 3;
export const MIDRANGE_SPLIT_FT = 14;
export const DEEP_THREE_FT = 27;
export const SIX_ZONES = ['rim', 'short_midrange', 'long_midrange', 'corner_three', 'above_break_three', 'deep_three'] as const;
export type SixZone = (typeof SIX_ZONES)[number];

/** Settled Stage-1 shot-zone mapping; throws on an incompatible normalized contract. */
export function classifyShot(row: ShotEventRow): SixZone | 'heave' {
  const zone = row.shotZoneBasic; const dist = row.shotDistance;
  if (zone === null || dist === null) throw new Error(`shot_events row with null shotZoneBasic/shotDistance (game ${row.gameId} event ${row.gameEventId}) — contract changed, stop and re-derive`);
  if (zone === 'Backcourt' || (dist >= HEAVE_DISTANCE_FT && row.minutesRemaining * 60 + row.secondsRemaining <= HEAVE_SECONDS_LEFT)) return 'heave';
  switch (zone) {
    case 'Restricted Area': return 'rim';
    case 'In The Paint (Non-RA)': return 'short_midrange';
    case 'Mid-Range': return dist < MIDRANGE_SPLIT_FT ? 'short_midrange' : 'long_midrange';
    case 'Left Corner 3': case 'Right Corner 3': return 'corner_three';
    case 'Above the Break 3': return dist >= DEEP_THREE_FT ? 'deep_three' : 'above_break_three';
    default: throw new Error(`Unknown shotZoneBasic "${zone}" — contract changed, stop and re-derive`);
  }
}
