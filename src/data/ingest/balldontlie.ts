const BASE_URL = 'https://api.balldontlie.io/v1';

interface BDLTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string | null;
  weight: string | null;
  jersey_number: string | null;
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: BDLTeam;
}

interface BDLSeasonAverage {
  player_id: number;
  season: number;
  games_played: number;
  min: string;
  pts: number;
  fgm: number;
  fga: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    next_cursor?: number;
    per_page: number;
  };
}

export class BallDontLieClient {
  private apiKey: string;
  private requestCount = 0;
  private windowStart = Date.now();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.windowStart > 60000) {
      this.requestCount = 0;
      this.windowStart = now;
    }
    if (this.requestCount >= 28) {
      const waitTime = 60000 - (now - this.windowStart) + 1000;
      console.log(`Rate limit: waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise((r) => setTimeout(r, waitTime));
      this.requestCount = 0;
      this.windowStart = Date.now();
    }
    this.requestCount++;
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    await this.rateLimit();

    const url = new URL(`${BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: this.apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BallDontLie API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getTeams(): Promise<BDLTeam[]> {
    const result = await this.fetch<{ data: BDLTeam[] }>('/teams');
    return result.data;
  }

  async getPlayers(teamId?: number): Promise<BDLPlayer[]> {
    const allPlayers: BDLPlayer[] = [];
    let cursor: number | undefined;

    while (true) {
      const params: Record<string, string> = { per_page: '100' };
      if (teamId) params['team_ids[]'] = String(teamId);
      if (cursor) params.cursor = String(cursor);

      const result = await this.fetch<PaginatedResponse<BDLPlayer>>('/players', params);
      allPlayers.push(...result.data);

      if (!result.meta.next_cursor) break;
      cursor = result.meta.next_cursor;
    }

    return allPlayers;
  }

  async getSeasonAverages(
    playerIds: number[],
    season: number,
  ): Promise<BDLSeasonAverage[]> {
    const allAverages: BDLSeasonAverage[] = [];

    // API accepts up to 25 player IDs at once
    for (let i = 0; i < playerIds.length; i += 25) {
      const batch = playerIds.slice(i, i + 25);
      const params: Record<string, string> = {
        season: String(season),
      };
      batch.forEach((id, idx) => {
        params[`player_ids[${idx}]`] = String(id);
      });

      const result = await this.fetch<{ data: BDLSeasonAverage[] }>('/season_averages', params);
      allAverages.push(...result.data);
    }

    return allAverages;
  }
}

export type { BDLTeam, BDLPlayer, BDLSeasonAverage };
