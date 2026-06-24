import { StatLine, emptyStatLine, ShotZone, BoxScore, TeamBoxScore, PlayerBoxLine } from '@/models/game';
import { POINTS_BY_ZONE } from './constants';

export class StatsAccumulator {
  private playerStats: Map<string, StatLine> = new Map();
  private playerMinutes: Map<string, number> = new Map();
  private playerStarters: Set<string> = new Set();
  private playerTeam: Map<string, string> = new Map();
  private scoreAtEntry: Map<string, { home: number; away: number }> = new Map();

  initPlayer(playerId: string, teamId: string, isStarter: boolean): void {
    if (!this.playerStats.has(playerId)) {
      this.playerStats.set(playerId, emptyStatLine());
      this.playerMinutes.set(playerId, 0);
      this.playerTeam.set(playerId, teamId);
    }
    if (isStarter) this.playerStarters.add(playerId);
  }

  recordEntry(playerId: string, homeScore: number, awayScore: number): void {
    this.scoreAtEntry.set(playerId, { home: homeScore, away: awayScore });
  }

  recordExit(playerId: string, homeScore: number, awayScore: number, homeTeamId: string): void {
    const entry = this.scoreAtEntry.get(playerId);
    if (!entry) return;

    const stats = this.playerStats.get(playerId);
    if (!stats) return;

    const teamId = this.playerTeam.get(playerId);
    if (teamId === homeTeamId) {
      stats.plusMinus += (homeScore - entry.home) - (awayScore - entry.away);
    } else {
      stats.plusMinus += (awayScore - entry.away) - (homeScore - entry.home);
    }

    this.scoreAtEntry.delete(playerId);
  }

  addMinutes(playerId: string, minutes: number): void {
    const current = this.playerMinutes.get(playerId) ?? 0;
    this.playerMinutes.set(playerId, current + minutes);
  }

  recordMadeShot(playerId: string, zone: ShotZone): void {
    const stats = this.getOrCreate(playerId);
    const points = POINTS_BY_ZONE[zone];
    stats.points += points;
    stats.fieldGoalsMade += 1;
    stats.fieldGoalsAttempted += 1;
    if (points === 3) {
      stats.threePointersMade += 1;
      stats.threePointersAttempted += 1;
    }
  }

  recordMissedShot(playerId: string, zone: ShotZone): void {
    const stats = this.getOrCreate(playerId);
    stats.fieldGoalsAttempted += 1;
    if (POINTS_BY_ZONE[zone] === 3) {
      stats.threePointersAttempted += 1;
    }
  }

  recordFreeThrows(playerId: string, made: number, attempted: number): void {
    const stats = this.getOrCreate(playerId);
    stats.freeThrowsMade += made;
    stats.freeThrowsAttempted += attempted;
    stats.points += made;
  }

  recordAssist(playerId: string): void {
    this.getOrCreate(playerId).assists += 1;
  }

  recordRebound(playerId: string, type: 'offensive' | 'defensive'): void {
    const stats = this.getOrCreate(playerId);
    if (type === 'offensive') {
      stats.offensiveRebounds += 1;
    } else {
      stats.defensiveRebounds += 1;
    }
    stats.rebounds += 1;
  }

  recordSteal(playerId: string): void {
    this.getOrCreate(playerId).steals += 1;
  }

  recordBlock(playerId: string): void {
    this.getOrCreate(playerId).blocks += 1;
  }

  recordTurnover(playerId: string): void {
    this.getOrCreate(playerId).turnovers += 1;
  }

  recordFoul(playerId: string): void {
    this.getOrCreate(playerId).personalFouls += 1;
  }

  buildBoxScore(homeTeamId: string, awayTeamId: string): BoxScore {
    return {
      homeTeam: this.buildTeamBoxScore(homeTeamId),
      awayTeam: this.buildTeamBoxScore(awayTeamId),
    };
  }

  private buildTeamBoxScore(teamId: string): TeamBoxScore {
    const players: PlayerBoxLine[] = [];
    const totals = emptyStatLine();

    for (const [playerId, stats] of this.playerStats) {
      if (this.playerTeam.get(playerId) !== teamId) continue;

      const minutes = Math.round((this.playerMinutes.get(playerId) ?? 0) * 10) / 10;
      if (minutes === 0) continue;

      players.push({
        playerId,
        starter: this.playerStarters.has(playerId),
        minutes,
        stats: { ...stats },
      });

      // Accumulate totals
      for (const key of Object.keys(totals) as (keyof StatLine)[]) {
        if (typeof totals[key] === 'number' && typeof stats[key] === 'number') {
          (totals[key] as number) += stats[key] as number;
        }
      }
    }

    // Sort: starters first, then by minutes
    players.sort((a, b) => {
      if (a.starter !== b.starter) return a.starter ? -1 : 1;
      return b.minutes - a.minutes;
    });

    return { teamId, players, totals };
  }

  private getOrCreate(playerId: string): StatLine {
    let stats = this.playerStats.get(playerId);
    if (!stats) {
      stats = emptyStatLine();
      this.playerStats.set(playerId, stats);
    }
    return stats;
  }
}
