import { NextResponse } from 'next/server';
import { getStore } from '@/data/store';

export async function GET() {
  const store = getStore();
  const teams = await store.loadTeams();
  return NextResponse.json(teams);
}
