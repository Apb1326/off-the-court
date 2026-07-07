/**
 * Shared rotation setup for constructing team lineups from a roster.
 *
 * Extracted verbatim from `scripts/ingest.ts` (S2a) so both the BDL ingest
 * path and the pipeline-derived league builder (`scripts/build-league.ts`)
 * fill starters / rotation order / minute targets identically. The logic is
 * unchanged from its original home — this is a behavior-preserving move, not
 * a rewrite. `defaultRotation()` alone produces five *empty* starters; this
 * populates real ones.
 */

import { Player, Position } from '@/models/player';
import { Team } from '@/models/team';

export function setupRotation(team: Team, teamPlayers: Player[]): void {
  if (teamPlayers.length < 5) return;

  // Sort by overall rating
  const sorted = [...teamPlayers].sort((a, b) => avgRating(b) - avgRating(a));

  // Find best player for each position
  const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const starters: string[] = [];
  const used = new Set<string>();

  for (const pos of positions) {
    const candidate = sorted.find((p) => (p.position === pos || p.secondaryPosition === pos) && !used.has(p.id));
    if (candidate) {
      starters.push(candidate.id);
      used.add(candidate.id);
    }
  }

  // Fill remaining starter slots with best available
  while (starters.length < 5) {
    const next = sorted.find((p) => !used.has(p.id));
    if (!next) break;
    starters.push(next.id);
    used.add(next.id);
  }

  const bench = sorted.filter((p) => !used.has(p.id)).map((p) => p.id);

  team.rotation = {
    starters: starters.slice(0, 5) as [string, string, string, string, string],
    rotationOrder: bench,
    minuteTargets: Object.fromEntries([
      ...starters.map((id, i) => [id, 32 - i * 1] as const),
      ...bench.map((id, i) => [id, Math.max(5, 20 - i * 3)] as const),
    ]),
  };
}

export function avgRating(player: Player): number {
  const values = Object.values(player.ratings) as number[];
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
