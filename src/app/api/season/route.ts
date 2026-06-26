import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/data/store';
import { createSeasonState, advanceSeason } from '@/engine/season';
import { addDays } from '@/engine/calendar';
import { SeasonState } from '@/models/season';

/** The lean view of a season the calendar UI needs (omits the full schedule). */
function clientState(state: SeasonState) {
  const lastDate = state.results.length ? state.results[state.results.length - 1].date : null;
  const recent = lastDate ? state.results.filter((g) => g.date === lastDate) : [];

  const upcomingDate = nextGameDate(state);
  const upcoming = upcomingDate
    ? {
        date: upcomingDate,
        games: state.schedule
          .filter((g) => g.date === upcomingDate)
          .map((g) => ({ id: g.id, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId })),
      }
    : null;

  return {
    seasonId: state.seasonId,
    startDate: state.startDate,
    endDate: state.endDate,
    currentDate: state.currentDate,
    gamesPlayed: state.gamesPlayed,
    totalGames: state.totalGames,
    seasonOver: state.gamesPlayed >= state.totalGames,
    markers: state.markers,
    standings: state.standings,
    playerStats: state.playerStats
      .filter((s) => s.gamesPlayed > 0)
      .map((s) => ({
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
      })),
    injuries: state.injuries.map((inj) => ({
      playerId: inj.playerId,
      teamId: inj.teamId,
      injuryType: inj.injuryType,
      severity: inj.severity,
      gamesRemaining: inj.gamesRemaining,
      startDate: inj.startDate,
    })),
    injuryHistory: state.injuryHistory.map((h) => ({
      playerId: h.playerId,
      teamId: h.teamId,
      injuryType: h.injuryType,
      region: h.region,
      severity: h.severity,
      startDate: h.startDate,
      gamesMissed: h.gamesMissed,
    })),
    recentDate: lastDate,
    recent,
    upcoming,
  };
}

function nextGameDate(state: SeasonState): string | null {
  let min: string | null = null;
  for (const g of state.schedule) {
    const d = g.date!;
    if (d > state.currentDate && (min === null || d < min)) min = d;
  }
  return min;
}

export async function GET() {
  const store = getStore();
  const state = await store.loadSeason();
  if (!state) return NextResponse.json({ state: null });
  return NextResponse.json({ state: clientState(state) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action: string = body?.action ?? 'advance';
  const store = getStore();

  const [teams, players] = await Promise.all([store.loadTeams(), store.loadPlayers()]);
  if (teams.length < 2) {
    return NextResponse.json({ error: 'Need teams. Run data ingestion first.' }, { status: 400 });
  }

  if (action === 'new') {
    const state = createSeasonState(teams, players, { seed: body?.seed });
    await store.saveSeason(state);
    return NextResponse.json({ state: clientState(state), advanced: 0 });
  }

  // advance
  const state = await store.loadSeason();
  if (!state) return NextResponse.json({ error: 'No season in progress' }, { status: 400 });

  if (state.gamesPlayed >= state.totalGames) {
    return NextResponse.json({ state: clientState(state), advanced: 0 });
  }

  const mode: string = body?.mode ?? 'day';

  // Explicit dates are the only client-supplied target; validate their shape.
  if (mode === 'date' && !isValidDate(body?.date)) {
    return NextResponse.json(
      { error: 'mode "date" requires a valid date in YYYY-MM-DD format' },
      { status: 400 },
    );
  }

  const target = resolveTarget(state, mode, body?.date);

  // Monotonic advancement: refuse to rewind the season. Replaying completed
  // games by advancing to an earlier date is the bug this guards against.
  if (target < state.currentDate) {
    return NextResponse.json(
      {
        error: `Cannot advance to ${target}: it is before the current season date ${state.currentDate}. Season advancement only moves forward.`,
      },
      { status: 400 },
    );
  }

  const played = advanceSeason(state, target, teams, players);
  await store.saveSeason(state);

  return NextResponse.json({ state: clientState(state), advanced: played.length });
}

/** True only for a real calendar date in strict YYYY-MM-DD form. */
function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function resolveTarget(state: SeasonState, mode: string, date?: string): string {
  switch (mode) {
    case 'week':
      return addDays(state.currentDate, 7);
    case 'rest':
      return state.endDate;
    case 'date':
      return date ?? state.endDate;
    case 'marker': {
      const next = state.markers
        .filter((m) => m.date > state.currentDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      return next ? next.date : state.endDate;
    }
    case 'day':
    default:
      return nextGameDate(state) ?? state.endDate;
  }
}
