import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/data/store';

export async function GET(request: NextRequest) {
  const store = getStore();
  const teamId = request.nextUrl.searchParams.get('teamId');

  if (teamId) {
    const players = await store.loadPlayersByTeam(teamId);
    return NextResponse.json(players);
  }

  const players = await store.loadPlayers();
  return NextResponse.json(players);
}
