import { Player } from '@/models/player';
import { Team } from '@/models/team';
import { StatLine, emptyStatLine } from '@/models/game';
import {
  ScheduledGame,
  TeamStanding,
  PlayerSeasonStats,
  SeasonResult,
  emptyStanding,
} from '@/models/season';
import { SeededRNG } from '@/lib/rng';
import { simulateGame } from './index';
import { generateSchedule } from './schedule';

export interface SimulateSeasonOptions {
  seasonId?: string;
  seed?: number;
  schedule?: ScheduledGame[];
}

export function simulateSeason(
  teams: Team[],
  players: Player[],
  options: SimulateSeasonOptions = {},
): SeasonResult {
  const seasonId = options.seasonId ?? 'season-1';
  const rng = new SeededRNG(options.seed ?? Date.now());

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) {
    if (p.teamId && playersByTeam.has(p.teamId)) {
      playersByTeam.get(p.teamId)!.push(p);
    }
  }

  const schedule = options.schedule ?? generateSchedule(teams, rng);

  const standings = new Map<string, TeamStanding>();
  for (const t of teams) standings.set(t.id, emptyStanding(t.id));

  const playerStats = new Map<string, PlayerSeasonStats>();
  for (const p of players) {
    playerStats.set(p.id, {
      playerId: p.id,
      teamId: p.teamId ?? '',
      gamesPlayed: 0,
      gamesStarted: 0,
      minutes: 0,
      totals: emptyStatLine(),
    });
  }

  let gamesPlayed = 0;

  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;

    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;

    // Deterministic per-game seed derived from the season seed + game id.
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    const sim = simulateGame(
      home, away, homePlayers, awayPlayers,
      sg.id, seasonId, `day-${sg.day}`, gameSeed,
    );

    gamesPlayed++;
    recordResult(standings, home, away, sim.result.homeScore, sim.result.awayScore);
    accumulatePlayerStats(playerStats, sim.boxScore.homeTeam.players);
    accumulatePlayerStats(playerStats, sim.boxScore.awayTeam.players);
  }

  return {
    seasonId,
    gamesPlayed,
    standings: [...standings.values()],
    playerStats: [...playerStats.values()].filter((s) => s.gamesPlayed > 0),
  };
}

function recordResult(
  standings: Map<string, TeamStanding>,
  home: Team,
  away: Team,
  homeScore: number,
  awayScore: number,
): void {
  const hs = standings.get(home.id)!;
  const as = standings.get(away.id)!;
  const homeWon = homeScore > awayScore;

  hs.pointsFor += homeScore;
  hs.pointsAgainst += awayScore;
  as.pointsFor += awayScore;
  as.pointsAgainst += homeScore;

  const sameConf = home.conference === away.conference;
  const sameDiv = sameConf && home.division === away.division;

  if (homeWon) {
    hs.wins++; hs.homeWins++;
    as.losses++; as.awayLosses++;
    if (sameConf) { hs.confWins++; as.confLosses++; }
    if (sameDiv) { hs.divWins++; as.divLosses++; }
    updateStreak(hs, true);
    updateStreak(as, false);
  } else {
    as.wins++; as.awayWins++;
    hs.losses++; hs.homeLosses++;
    if (sameConf) { as.confWins++; hs.confLosses++; }
    if (sameDiv) { as.divWins++; hs.divLosses++; }
    updateStreak(as, true);
    updateStreak(hs, false);
  }
}

function updateStreak(s: TeamStanding, won: boolean): void {
  if (won) s.streak = s.streak >= 0 ? s.streak + 1 : 1;
  else s.streak = s.streak <= 0 ? s.streak - 1 : -1;
  s.lastTen.push(won ? 'W' : 'L');
  if (s.lastTen.length > 10) s.lastTen.shift();
}

function accumulatePlayerStats(
  playerStats: Map<string, PlayerSeasonStats>,
  lines: { playerId: string; starter: boolean; minutes: number; stats: StatLine }[],
): void {
  for (const line of lines) {
    if (line.minutes <= 0 && line.stats.points === 0 && line.stats.fieldGoalsAttempted === 0) {
      continue; // did not actually play
    }
    const agg = playerStats.get(line.playerId);
    if (!agg) continue;
    agg.gamesPlayed++;
    if (line.starter) agg.gamesStarted++;
    agg.minutes += line.minutes;
    addStatLine(agg.totals, line.stats);
  }
}

function addStatLine(target: StatLine, src: StatLine): void {
  target.points += src.points;
  target.fieldGoalsMade += src.fieldGoalsMade;
  target.fieldGoalsAttempted += src.fieldGoalsAttempted;
  target.threePointersMade += src.threePointersMade;
  target.threePointersAttempted += src.threePointersAttempted;
  target.freeThrowsMade += src.freeThrowsMade;
  target.freeThrowsAttempted += src.freeThrowsAttempted;
  target.offensiveRebounds += src.offensiveRebounds;
  target.defensiveRebounds += src.defensiveRebounds;
  target.rebounds += src.rebounds;
  target.assists += src.assists;
  target.steals += src.steals;
  target.blocks += src.blocks;
  target.turnovers += src.turnovers;
  target.personalFouls += src.personalFouls;
  target.plusMinus += src.plusMinus;
}
