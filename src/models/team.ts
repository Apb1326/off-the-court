export interface Team {
  id: string;
  name: string;
  city: string;
  fullName: string;
  abbreviation: string;
  conference: 'East' | 'West';
  division: string;

  roster: string[]; // Player IDs (up to 15)
  rotation: RotationSettings;

  offensiveSystem: OffensiveSystem;
  defensiveSystem: DefensiveSystem;

  /**
   * Event-set league-year state triggered by qualifying transactions. This is
   * deliberately persisted rather than derived from current payroll. Absence
   * means the team is not hard-capped.
   */
  hardCappedAtApron?: 'first_apron' | 'second_apron';
}

export interface RotationSettings {
  starters: [string, string, string, string, string];
  rotationOrder: string[];
  minuteTargets: Record<string, number>;
}

export interface OffensiveSystem {
  pace: number; // possessions per 48 min (90-110)
  threePointEmphasis: number; // 0-1
  transitionEmphasis: number;
  postPlayEmphasis: number;
  isolationEmphasis: number;
  screeningEmphasis: number;
}

export interface DefensiveSystem {
  scheme: 'man' | 'zone_23' | 'zone_32' | 'switch_all';
  intensity: number; // 0-1
  doubleTeamThreshold: number; // rating threshold to trigger doubles
  helpDefenseAggression: number; // 0-1
}

export const NBA_TEAMS: Array<{
  name: string;
  city: string;
  abbreviation: string;
  conference: 'East' | 'West';
  division: string;
}> = [
  { name: 'Hawks', city: 'Atlanta', abbreviation: 'ATL', conference: 'East', division: 'Southeast' },
  { name: 'Celtics', city: 'Boston', abbreviation: 'BOS', conference: 'East', division: 'Atlantic' },
  { name: 'Nets', city: 'Brooklyn', abbreviation: 'BKN', conference: 'East', division: 'Atlantic' },
  { name: 'Hornets', city: 'Charlotte', abbreviation: 'CHA', conference: 'East', division: 'Southeast' },
  { name: 'Bulls', city: 'Chicago', abbreviation: 'CHI', conference: 'East', division: 'Central' },
  { name: 'Cavaliers', city: 'Cleveland', abbreviation: 'CLE', conference: 'East', division: 'Central' },
  { name: 'Mavericks', city: 'Dallas', abbreviation: 'DAL', conference: 'West', division: 'Southwest' },
  { name: 'Nuggets', city: 'Denver', abbreviation: 'DEN', conference: 'West', division: 'Northwest' },
  { name: 'Pistons', city: 'Detroit', abbreviation: 'DET', conference: 'East', division: 'Central' },
  { name: 'Warriors', city: 'Golden State', abbreviation: 'GSW', conference: 'West', division: 'Pacific' },
  { name: 'Rockets', city: 'Houston', abbreviation: 'HOU', conference: 'West', division: 'Southwest' },
  { name: 'Pacers', city: 'Indiana', abbreviation: 'IND', conference: 'East', division: 'Central' },
  { name: 'Clippers', city: 'Los Angeles', abbreviation: 'LAC', conference: 'West', division: 'Pacific' },
  { name: 'Lakers', city: 'Los Angeles', abbreviation: 'LAL', conference: 'West', division: 'Pacific' },
  { name: 'Grizzlies', city: 'Memphis', abbreviation: 'MEM', conference: 'West', division: 'Southwest' },
  { name: 'Heat', city: 'Miami', abbreviation: 'MIA', conference: 'East', division: 'Southeast' },
  { name: 'Bucks', city: 'Milwaukee', abbreviation: 'MIL', conference: 'East', division: 'Central' },
  { name: 'Timberwolves', city: 'Minnesota', abbreviation: 'MIN', conference: 'West', division: 'Northwest' },
  { name: 'Pelicans', city: 'New Orleans', abbreviation: 'NOP', conference: 'West', division: 'Southwest' },
  { name: 'Knicks', city: 'New York', abbreviation: 'NYK', conference: 'East', division: 'Atlantic' },
  { name: 'Thunder', city: 'Oklahoma City', abbreviation: 'OKC', conference: 'West', division: 'Northwest' },
  { name: 'Magic', city: 'Orlando', abbreviation: 'ORL', conference: 'East', division: 'Southeast' },
  { name: '76ers', city: 'Philadelphia', abbreviation: 'PHI', conference: 'East', division: 'Atlantic' },
  { name: 'Suns', city: 'Phoenix', abbreviation: 'PHX', conference: 'West', division: 'Pacific' },
  { name: 'Trail Blazers', city: 'Portland', abbreviation: 'POR', conference: 'West', division: 'Northwest' },
  { name: 'Kings', city: 'Sacramento', abbreviation: 'SAC', conference: 'West', division: 'Pacific' },
  { name: 'Spurs', city: 'San Antonio', abbreviation: 'SAS', conference: 'West', division: 'Southwest' },
  { name: 'Raptors', city: 'Toronto', abbreviation: 'TOR', conference: 'East', division: 'Atlantic' },
  { name: 'Jazz', city: 'Utah', abbreviation: 'UTA', conference: 'West', division: 'Northwest' },
  { name: 'Wizards', city: 'Washington', abbreviation: 'WAS', conference: 'East', division: 'Southeast' },
];
