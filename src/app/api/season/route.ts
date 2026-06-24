import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/data/store';
import { simulateSeason } from '@/engine/season';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const seed: number | undefined = body?.seed;

  const store = getStore();
  const [teams, players] = await Promise.all([
    store.loadTeams(),
    store.loadPlayers(),
  ]);

  if (teams.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 teams. Run data ingestion first.' }, { status: 400 });
  }

  const result = simulateSeason(teams, players, { seed });

  // Per-player averages keep the payload small and ready for the leaders tables.
  const playerStats = result.playerStats.map((s) => ({
    playerId: s.playerId,
    teamId: s.teamId,
    gamesPlayed: s.gamesPlayed,
    gamesStarted: s.gamesStarted,
    mpg: s.minutes / s.gamesPlayed,
    ppg: s.totals.points / s.gamesPlayed,
    rpg: s.totals.rebounds / s.gamesPlayed,
    apg: s.totals.assists / s.gamesPlayed,
    spg: s.totals.steals / s.gamesPlayed,
    bpg: s.totals.blocks / s.gamesPlayed,
    topg: s.totals.turnovers / s.gamesPlayed,
    fgPct: s.totals.fieldGoalsMade / Math.max(1, s.totals.fieldGoalsAttempted),
    tpPct: s.totals.threePointersMade / Math.max(1, s.totals.threePointersAttempted),
    ftPct: s.totals.freeThrowsMade / Math.max(1, s.totals.freeThrowsAttempted),
  }));

  return NextResponse.json({
    seasonId: result.seasonId,
    gamesPlayed: result.gamesPlayed,
    standings: result.standings,
    playerStats,
  });
}
