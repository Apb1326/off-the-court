import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/data/store';
import { getSaveStore } from '@/data/saves';
import { createSeasonState, advanceSeason } from '@/engine/season';
import { addDays } from '@/engine/calendar';
import { SeasonState, getControlledTeamId, normalizeSeasonState } from '@/models/season';
import { Team } from '@/models/team';
import { Player } from '@/models/player';
import { SaveFile, derivePhase } from '@/models/save';

/**
 * The lean view of a season the calendar UI needs (omits the full schedule).
 * `teams` is supplied so the controlled-team id can be validated against the
 * live roster: a stored id that no longer resolves (a corrupt/edited save) is
 * reported via `controlledTeamMissing` and reflected as null rather than handed
 * to the UI as a phantom team.
 */
function clientState(state: SeasonState, teams: Team[]) {
  const lastDate = state.results.length ? state.results[state.results.length - 1].date : null;
  const recent = lastDate ? state.results.filter((g) => g.date === lastDate) : [];

  const storedControlledId = getControlledTeamId(state);
  const controlledTeamMissing = storedControlledId != null && !teams.some((t) => t.id === storedControlledId);
  const controlledTeamId = controlledTeamMissing ? null : storedControlledId;

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
    phase: derivePhase(state),
    controlledTeamId,
    controlledTeamMissing,
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

/** Wrap a season + its rosters into a fresh SaveFile (timestamps set by the store on write). */
function toSaveFile(season: SeasonState, teams: Team[], players: Player[]): SaveFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: 0, // set by the store on write
    phase: derivePhase(season),
    season,
    teams,
    players,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Resolve the live working save. If none exists yet but a legacy `data/season.json`
 * is present (single-save era), import it once into the auto-save slot — wrapping it
 * with the current global rosters — so existing progress isn't lost.
 */
async function loadOrImportActive(): Promise<SaveFile | null> {
  const saves = getSaveStore();
  const active = await saves.loadActiveSave();
  if (active) return active;

  const store = getStore();
  const legacy = await store.loadSeason();
  if (!legacy) return null;

  // A single-save-era season.json predates `controlledTeamId`; bring it up to the
  // current shape (defaults to no controlled team) before it becomes a save file.
  normalizeSeasonState(legacy);

  const [teams, players] = await Promise.all([store.loadTeams(), store.loadPlayers()]);
  const file = toSaveFile(legacy, teams, players);
  await saves.autoSave(file);
  return file;
}

export async function GET() {
  const file = await loadOrImportActive();
  if (!file) return NextResponse.json({ state: null });
  return NextResponse.json({ state: clientState(file.season, file.teams) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action: string = body?.action ?? 'advance';
  const saves = getSaveStore();

  if (action === 'new') {
    const start: string = body?.start ?? 'season';

    // Snapshot the global roster template into a fresh, independent save.
    const store = getStore();
    const [teams, players] = await Promise.all([store.loadTeams(), store.loadPlayers()]);
    if (teams.length < 2) {
      return NextResponse.json({ error: 'Need teams. Run data ingestion first.' }, { status: 400 });
    }

    // Resolve the player's controlled team once, before the start-point branch, so
    // both the season-start and (future) offseason-start paths share the exact same
    // selection + validation. A request may omit it (null = spectate); an id that
    // isn't a real team in this league is rejected rather than silently dropped.
    const requested = body?.controlledTeamId;
    let controlledTeamId: string | null = null;
    if (requested != null && requested !== '') {
      if (typeof requested !== 'string' || !teams.some((t) => t.id === requested)) {
        return NextResponse.json(
          { error: `Invalid controlledTeamId "${requested}": not a team in this league.` },
          { status: 400 },
        );
      }
      controlledTeamId = requested;
    }

    if (start === 'offseason') {
      // Offseason creation isn't built yet; when it lands it will pass the same
      // `controlledTeamId` into its season-builder exactly as the season path does.
      return NextResponse.json(
        { error: 'Offseason start not yet implemented' },
        { status: 501 },
      );
    }

    const season = createSeasonState(teams, players, { seed: body?.seed, controlledTeamId });
    const file = toSaveFile(season, teams, players);
    await saves.autoSave(file);
    return NextResponse.json({ state: clientState(season, teams), advanced: 0 });
  }

  // advance — operate on the active save's own state + snapshotted rosters.
  const file = await loadOrImportActive();
  if (!file) return NextResponse.json({ error: 'No season in progress' }, { status: 400 });

  const state = file.season;

  if (state.gamesPlayed >= state.totalGames) {
    return NextResponse.json({ state: clientState(state, file.teams), advanced: 0 });
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

  const played = advanceSeason(state, target, file.teams, file.players);
  // Auto-save after every advance: covers the per-day cadence and any phase
  // transition (the metadata phase/summary are recomputed on write).
  await saves.autoSave(file);

  return NextResponse.json({ state: clientState(state, file.teams), advanced: played.length });
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
