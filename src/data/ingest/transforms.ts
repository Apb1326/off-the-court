import { Player, Position, PerGameStats, SeasonStats, PlayerRatings, PlayerTendencies } from '@/models/player';
import { Team, RotationSettings, OffensiveSystem, DefensiveSystem } from '@/models/team';
import { deriveRatings, deriveTendencies, derivePotential } from '@/ratings/derivation';
import { BDLTeam, BDLPlayer, BDLSeasonAverage } from './balldontlie';

export function transformTeam(bdl: BDLTeam): Team {
  return {
    id: `team_${bdl.id}`,
    name: bdl.name,
    city: bdl.city,
    fullName: bdl.full_name,
    abbreviation: bdl.abbreviation,
    conference: bdl.conference as 'East' | 'West',
    division: bdl.division,
    roster: [],
    rotation: defaultRotation(),
    offensiveSystem: defaultOffensiveSystem(),
    defensiveSystem: defaultDefensiveSystem(),
  };
}

export function transformPlayer(
  bdl: BDLPlayer,
  seasonAverages: BDLSeasonAverage[],
  currentSeason: number,
): Player {
  const position = parsePosition(bdl.position);
  const height = parseHeight(bdl.height);
  const weight = parseInt(bdl.weight ?? '200') || 200;
  const age = estimateAge(bdl.draft_year, currentSeason);
  const experience = bdl.draft_year ? currentSeason - bdl.draft_year : 1;

  const currentStats = seasonAverages.find((sa) => sa.season === currentSeason);
  const perGameStats = currentStats ? transformStats(currentStats) : defaultPerGameStats();
  const minutesPerGame = currentStats ? parseMinutes(currentStats.min) : 10;
  const gamesPlayed = currentStats?.games_played ?? 0;

  const rawStats = {
    gamesPlayed,
    minutesPerGame,
    stats: perGameStats,
    position,
    age,
    experience,
  };

  const ratings = deriveRatings(rawStats);
  const tendencies = deriveTendencies(rawStats);
  const potential = derivePotential(ratings, age, experience);

  const careerStats: SeasonStats[] = seasonAverages.map((sa) => ({
    season: `${sa.season}-${(sa.season + 1).toString().slice(2)}`,
    teamId: `team_${bdl.team.id}`,
    gamesPlayed: sa.games_played,
    gamesStarted: sa.games_played, // API doesn't distinguish
    minutesPerGame: parseMinutes(sa.min),
    stats: transformStats(sa),
  }));

  return {
    id: `player_${bdl.id}`,
    firstName: bdl.first_name,
    lastName: bdl.last_name,
    position,
    height,
    weight,
    age,
    experience: Math.max(0, experience),
    teamId: `team_${bdl.team.id}`,
    jerseyNumber: parseInt(bdl.jersey_number ?? '0') || 0,
    ratings,
    potential,
    scoutingAccuracy: 0.5,
    tendencies,
    contract: {
      yearsRemaining: Math.max(1, Math.floor(Math.random() * 4) + 1),
      salaryPerYear: estimateSalary(ratings),
    },
    health: { healthy: true },
    careerStats,
  };
}

function parsePosition(pos: string): Position {
  if (!pos) return 'SF';
  const normalized = pos.split('-')[0].trim().toUpperCase();
  const map: Record<string, Position> = {
    G: 'PG', PG: 'PG', SG: 'SG',
    F: 'SF', SF: 'SF', PF: 'PF',
    C: 'C',
  };
  return map[normalized] ?? 'SF';
}

function parseHeight(height: string | null): number {
  if (!height) return 78; // 6'6" default
  const parts = height.split('-');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 12 + parseInt(parts[1]);
  }
  return 78;
}

function parseMinutes(min: string): number {
  if (!min) return 0;
  const parts = min.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }
  return parseFloat(min) || 0;
}

function estimateAge(draftYear: number | null, currentSeason: number): number {
  if (!draftYear) return 25;
  return 19 + (currentSeason - draftYear);
}

function transformStats(sa: BDLSeasonAverage): PerGameStats {
  return {
    points: sa.pts,
    fieldGoalsMade: sa.fgm,
    fieldGoalsAttempted: sa.fga,
    fieldGoalPct: sa.fg_pct,
    threePointersMade: sa.fg3m,
    threePointersAttempted: sa.fg3a,
    threePointPct: sa.fg3_pct,
    freeThrowsMade: sa.ftm,
    freeThrowsAttempted: sa.fta,
    freeThrowPct: sa.ft_pct,
    offensiveRebounds: sa.oreb,
    defensiveRebounds: sa.dreb,
    rebounds: sa.reb,
    assists: sa.ast,
    steals: sa.stl,
    blocks: sa.blk,
    turnovers: sa.turnover,
    personalFouls: sa.pf,
  };
}

function defaultPerGameStats(): PerGameStats {
  return {
    points: 5, fieldGoalsMade: 2, fieldGoalsAttempted: 5, fieldGoalPct: 0.40,
    threePointersMade: 0.5, threePointersAttempted: 1.5, threePointPct: 0.33,
    freeThrowsMade: 0.5, freeThrowsAttempted: 0.8, freeThrowPct: 0.70,
    offensiveRebounds: 0.5, defensiveRebounds: 1.5, rebounds: 2,
    assists: 1, steals: 0.3, blocks: 0.2, turnovers: 0.8, personalFouls: 1.5,
  };
}

function defaultRotation(): RotationSettings {
  return {
    starters: ['', '', '', '', ''],
    rotationOrder: [],
    minuteTargets: {},
  };
}

function defaultOffensiveSystem(): OffensiveSystem {
  return {
    pace: 100,
    threePointEmphasis: 0.5,
    transitionEmphasis: 0.5,
    postPlayEmphasis: 0.3,
    isolationEmphasis: 0.3,
    screeningEmphasis: 0.5,
  };
}

function defaultDefensiveSystem(): DefensiveSystem {
  return {
    scheme: 'man',
    intensity: 0.5,
    doubleTeamThreshold: 70,
    helpDefenseAggression: 0.5,
  };
}

function estimateSalary(ratings: PlayerRatings): number {
  const overall = Object.values(ratings).reduce((a, b) => a + b, 0) / 17;
  if (overall >= 65) return 30 + (overall - 65) * 2;
  if (overall >= 55) return 15 + (overall - 55) * 1.5;
  if (overall >= 45) return 5 + (overall - 45) * 1;
  return 1 + (overall - 30) * 0.2;
}
