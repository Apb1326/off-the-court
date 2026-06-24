import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Player } from '@/models/player';
import { Team } from '@/models/team';
import { Game } from '@/models/game';
import { SeasonState } from '@/models/season';
import { GameStore } from './types';

export class JsonStore implements GameStore {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async loadTeams(): Promise<Team[]> {
    const data = await this.readJson<Team[]>(path.join(this.dataDir, 'teams.json'));
    return data ?? [];
  }

  async saveTeams(teams: Team[]): Promise<void> {
    await this.writeJson(path.join(this.dataDir, 'teams.json'), teams);
  }

  async loadPlayers(): Promise<Player[]> {
    const data = await this.readJson<Player[]>(path.join(this.dataDir, 'players.json'));
    return data ?? [];
  }

  async savePlayers(players: Player[]): Promise<void> {
    await this.writeJson(path.join(this.dataDir, 'players.json'), players);
  }

  async loadGames(seasonId: string): Promise<Game[]> {
    const dir = path.join(this.dataDir, 'seasons', seasonId, 'games');
    if (!existsSync(dir)) return [];

    const { readdir } = await import('fs/promises');
    const files = await readdir(dir);
    const games: Game[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const game = await this.readJson<Game>(path.join(dir, file));
        if (game) games.push(game);
      }
    }

    return games;
  }

  async saveGame(game: Game): Promise<void> {
    const dir = path.join(this.dataDir, 'seasons', game.seasonId, 'games');
    await this.writeJson(path.join(dir, `${game.id}.json`), game);
  }

  async loadTeam(teamId: string): Promise<Team | null> {
    const teams = await this.loadTeams();
    return teams.find((t) => t.id === teamId) ?? null;
  }

  async loadPlayer(playerId: string): Promise<Player | null> {
    const players = await this.loadPlayers();
    return players.find((p) => p.id === playerId) ?? null;
  }

  async loadPlayersByTeam(teamId: string): Promise<Player[]> {
    const players = await this.loadPlayers();
    return players.filter((p) => p.teamId === teamId);
  }

  async loadSeason(): Promise<SeasonState | null> {
    return this.readJson<SeasonState>(path.join(this.dataDir, 'season.json'));
  }

  async saveSeason(state: SeasonState): Promise<void> {
    await this.writeJson(path.join(this.dataDir, 'season.json'), state);
  }
}
