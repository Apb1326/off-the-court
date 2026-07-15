import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/data/store';
import { getSaveStore } from '@/data/saves';
import { createSeasonState, advanceSeason, seasonRestTarget } from '@/engine/season';
import { addDays } from '@/engine/calendar';
import { SeasonState, emptyPlayoffs } from '@/models/season';
import { emptyStatLine } from '@/models/game';
import { Team } from '@/models/team';
import { Player } from '@/models/player';
import { SaveFile, derivePhase } from '@/models/save';
import { normalizePlayersForSave } from '@/transactions/contracts';
import { resolveSeedFromBody } from '@/lib/seed';
import { loadProductionPool } from '@/lib/production-pool';
import { PLAYOFF_MAX_CALENDAR_DAYS } from '@/engine/constants';
import { allSeasonResults, deriveChampion, derivePlayoffSeries, derivePlayoffStatus, isSeasonComplete, nextSeasonGameDate } from '@/engine/playoffs';
import { injuryGamesMissed } from '@/engine/injury';

/** The lean view of a season the calendar UI needs (omits the full schedule). */
function clientState(state: SeasonState) {
  const results = allSeasonResults(state);
  const lastDate = results.length ? results[results.length - 1].date : null;
  const recent = lastDate ? results.filter((g) => g.date === lastDate) : [];

  const upcomingDate = nextGameDate(state);
  const upcoming = upcomingDate
    ? {
        date: upcomingDate,
        games: [...state.schedule, ...state.playoffs.schedule]
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
    gamesPlayed: state.gamesPlayed,
    totalGames: state.totalGames,
    regularSeasonComplete: state.gamesPlayed >= state.totalGames,
    seasonComplete: isSeasonComplete(state),
    seasonOver: isSeasonComplete(state),
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
      gamesMissed: injuryGamesMissed(h, results),
    })),
    playoffs: {
      status: derivePlayoffStatus(state),
      playInEnabled: state.playoffs.playInEnabled,
      gamesPlayed: results.filter((result) => result.id.startsWith('PO-')).length,
      championTeamId: deriveChampion(state),
      series: derivePlayoffSeries(state).map((series) => ({
        id: series.id,
        round: series.round,
        conference: series.conference,
        bracketPosition: series.bracketPosition,
        teamAId: series.teamAId,
        teamBId: series.teamBId,
        teamASeed: series.teamASeed,
        teamBSeed: series.teamBSeed,
        teamAWins: series.teamAWins,
        teamBWins: series.teamBWins,
        winsRequired: series.winsRequired,
        winnerTeamId: series.winnerTeamId,
      })),
    },
    recentDate: lastDate,
    recent,
    upcoming,
  };
}

function nextGameDate(state: SeasonState): string | null {
  return nextSeasonGameDate(state);
}

/** Wrap a season + its rosters into a fresh SaveFile (timestamps set by the store on write). */
function toSaveFile(
  season: SeasonState,
  teams: Team[],
  players: Player[],
  controlledTeamId: string | null,
): SaveFile {
  const now = new Date().toISOString();
  const canonicalSeason = season.playoffs && Array.isArray(season.playoffPlayerStats) ? season : {
    ...season,
    playoffs: season.playoffs ?? emptyPlayoffs(season.gamesPlayed >= season.totalGames),
    playoffPlayerStats: Array.isArray(season.playoffPlayerStats)
      ? season.playoffPlayerStats
      : players.map((player) => ({
      playerId: player.id,
      teamId: player.teamId ?? '',
      gamesPlayed: 0,
      gamesStarted: 0,
      minutes: 0,
      totals: emptyStatLine(),
    })),
  };
  const { players: normalized, freeAgentPool } =
    normalizePlayersForSave(players, canonicalSeason.freeAgentPool, teams);
  return {
    schemaVersion: 0, // set by the store on write
    phase: derivePhase(canonicalSeason),
    season: { ...canonicalSeason, freeAgentPool },
    teams,
    players: normalized,
    controlledTeamId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validate a new game's requested controlled team against the roster snapshot
 * the save is being created from. Omitted means spectator (`null`); anything
 * else must be an exact team id — invalid input is rejected, never coerced.
 */
function resolveControlledTeamId(
  value: unknown,
  teams: Team[],
): { ok: true; controlledTeamId: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, controlledTeamId: null };
  if (typeof value !== 'string') {
    return { ok: false, error: 'controlledTeamId must be a team id string or null' };
  }
  if (!teams.some((t) => t.id === value)) {
    return { ok: false, error: `controlledTeamId "${value}" does not match any team` };
  }
  return { ok: true, controlledTeamId: value };
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

  const [teams, players] = await Promise.all([store.loadTeams(), store.loadPlayers()]);
  // Legacy single-save imports predate F1 and never had a controlled team.
  const file = toSaveFile(legacy, teams, players, null);
  await saves.autoSave(file);
  return file;
}

export async function GET() {
  const file = await loadOrImportActive();
  if (!file) return NextResponse.json({ state: null });
  return NextResponse.json({ state: clientState(file.season) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action: string = body?.action ?? 'advance';
  const saves = getSaveStore();

  if (action === 'new') {
    const start: string = body?.start ?? 'season';
    if (start === 'offseason') {
      return NextResponse.json(
        { error: 'Offseason start not yet implemented' },
        { status: 501 },
      );
    }

    // Seed policy: a supplied seed must be valid; an omitted seed is chosen
    // here at the API boundary and persisted in SeasonState — never inside
    // the engine.
    const seedRes = resolveSeedFromBody(body);
    if (!seedRes.ok) {
      return NextResponse.json({ error: seedRes.error }, { status: 400 });
    }

    // Snapshot the global roster template into a fresh, independent save.
    // A save is built from this snapshot exactly once, so a torn or invalid
    // pool must be rejected here — the script-side gates don't cover runtime.
    let teams: Team[];
    let players: Player[];
    try {
      ({ teams, players } = loadProductionPool(`${process.cwd()}/data`));
    } catch (error) {
      return NextResponse.json(
        { error: `League data failed production validation — re-run npm run build-league. (${(error as Error).message})` },
        { status: 500 },
      );
    }

    // Controlled-franchise identity is chosen at new-game time and validated
    // against the exact roster snapshot this save is built from.
    const controlledRes = resolveControlledTeamId(body?.controlledTeamId, teams);
    if (!controlledRes.ok) {
      return NextResponse.json({ error: controlledRes.error }, { status: 400 });
    }

    const season = createSeasonState(teams, players, { seed: seedRes.seed });
    const file = toSaveFile(season, teams, players, controlledRes.controlledTeamId);
    await saves.autoSave(file);
    return NextResponse.json({ state: clientState(season), advanced: 0 });
  }

  // advance — operate on the active save's own state + snapshotted rosters.
  const file = await loadOrImportActive();
  if (!file) return NextResponse.json({ error: 'No season in progress' }, { status: 400 });

  const state = file.season;

  if (isSeasonComplete(state)) {
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

  const played = advanceSeason(state, target, file.teams, file.players);
  // Auto-save after every advance: covers the per-day cadence and any phase
  // transition (the metadata phase/summary are recomputed on write).
  await saves.autoSave(file);

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
      return seasonRestTarget(state);
    case 'date':
      return date ?? (state.playoffs.endDate ?? addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS));
    case 'marker': {
      const next = state.markers
        .filter((m) => m.date > state.currentDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      return next ? next.date : (nextGameDate(state) ?? state.endDate);
    }
    case 'day':
    default:
      return nextGameDate(state) ?? state.endDate;
  }
}
