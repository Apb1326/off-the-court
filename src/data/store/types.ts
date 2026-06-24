import { Player } from '@/models/player';
import { Team } from '@/models/team';
import { Game } from '@/models/game';
import { SeasonState } from '@/models/season';

export interface GameStore {
  loadTeams(): Promise<Team[]>;
  saveTeams(teams: Team[]): Promise<void>;
  loadPlayers(): Promise<Player[]>;
  savePlayers(players: Player[]): Promise<void>;
  loadGames(seasonId: string): Promise<Game[]>;
  saveGame(game: Game): Promise<void>;
  loadTeam(teamId: string): Promise<Team | null>;
  loadPlayer(playerId: string): Promise<Player | null>;
  loadPlayersByTeam(teamId: string): Promise<Player[]>;
  loadSeason(): Promise<SeasonState | null>;
  saveSeason(state: SeasonState): Promise<void>;
}
