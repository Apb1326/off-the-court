import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/data/store';
import { simulateGame } from '@/engine';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { homeTeamId, awayTeamId, seed } = body;

  if (!homeTeamId || !awayTeamId) {
    return NextResponse.json({ error: 'homeTeamId and awayTeamId required' }, { status: 400 });
  }

  if (homeTeamId === awayTeamId) {
    return NextResponse.json({ error: 'Teams must be different' }, { status: 400 });
  }

  const store = getStore();
  const [homeTeam, awayTeam] = await Promise.all([
    store.loadTeam(homeTeamId),
    store.loadTeam(awayTeamId),
  ]);

  if (!homeTeam || !awayTeam) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  const [homePlayers, awayPlayers] = await Promise.all([
    store.loadPlayersByTeam(homeTeamId),
    store.loadPlayersByTeam(awayTeamId),
  ]);

  if (homePlayers.length < 5 || awayPlayers.length < 5) {
    return NextResponse.json({ error: 'Teams need at least 5 players' }, { status: 400 });
  }

  const gameId = `game_${Date.now()}`;
  const result = simulateGame(
    homeTeam,
    awayTeam,
    homePlayers,
    awayPlayers,
    gameId,
    'quick-sim',
    new Date().toISOString().split('T')[0],
    seed,
  );

  // Save the game
  await store.saveGame(result.game);

  return NextResponse.json({
    gameId: result.game.id,
    result: result.result,
    boxScore: result.boxScore,
    playByPlayCount: result.playByPlay.length,
  });
}
