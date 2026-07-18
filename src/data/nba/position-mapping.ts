import type { Position } from '@/models/player';

/** Last-resort builder position for missing or unrecognized NBA bio tokens. */
export const NBA_POSITION_FALLBACK: Position = 'SF';

/**
 * Present-day NBA bio position -> the engine primary position used by the
 * production league builder. Keep this as the shared vocabulary for offline
 * derivations that must describe the runtime pool.
 */
export const NBA_PRIMARY_POSITION_MAP: Readonly<Record<string, Position>> = {
  G: 'PG',
  'G-F': 'SG',
  'F-G': 'SF',
  F: 'SF',
  'F-C': 'PF',
  'C-F': 'PF',
  C: 'C',
};

/** Second token of a hyphenated NBA position -> engine secondary position. */
export const NBA_SECONDARY_TOKEN_MAP: Readonly<Record<string, Position>> = {
  G: 'PG',
  F: 'SF',
  C: 'C',
};

/** Coarse shooter-position bucket used by the runtime assignment model. */
export type RuntimeMatchupBucket = 'G' | 'F' | 'C';

/** Engine shooter position -> the coarse opponent bucket available at runtime. */
export function enginePositionToMatchupBucket(position: Position): RuntimeMatchupBucket {
  if (position === 'PG' || position === 'SG') return 'G';
  if (position === 'SF' || position === 'PF') return 'F';
  return 'C';
}

export function nbaPrimaryPosition(raw: string | null | undefined): Position | undefined {
  return NBA_PRIMARY_POSITION_MAP[(raw ?? '').trim().toUpperCase()];
}

/**
 * NBA matchup bucket -> runtime bucket, mechanically composed through the
 * production primary-position mapping. In particular C-F -> PF -> F.
 */
export function nbaMatchupBucketToRuntimeBucket(raw: string): RuntimeMatchupBucket | undefined {
  const primary = nbaPrimaryPosition(raw);
  return primary === undefined ? undefined : enginePositionToMatchupBucket(primary);
}
