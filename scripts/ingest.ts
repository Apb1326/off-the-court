import { BallDontLieClient, BDLPlayer, BDLSeasonAverage } from '../src/data/ingest/balldontlie';
import { transformTeam, transformPlayer } from '../src/data/ingest/transforms';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { setupRotation, avgRating } from '../src/lib/rotation';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CURRENT_SEASON = 2024; // 2024-25 season

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    console.error('Set BALLDONTLIE_API_KEY environment variable');
    console.error('Get a free key at https://app.balldontlie.io');
    process.exit(1);
  }

  const client = new BallDontLieClient(apiKey);

  console.log('Fetching teams...');
  const bdlTeams = await client.getTeams();
  console.log(`Found ${bdlTeams.length} teams`);

  const teams: Team[] = bdlTeams.map(transformTeam);

  console.log('Fetching players...');
  const allBDLPlayers: BDLPlayer[] = [];
  for (const bdlTeam of bdlTeams) {
    console.log(`  ${bdlTeam.full_name}...`);
    const teamPlayers = await client.getPlayers(bdlTeam.id);
    // Filter to active players on this team
    const active = teamPlayers.filter((p) => p.team.id === bdlTeam.id);
    allBDLPlayers.push(...active);
  }
  console.log(`Found ${allBDLPlayers.length} players`);

  console.log('Fetching season averages...');
  const playerIds = allBDLPlayers.map((p) => p.id);
  const seasonAverages: BDLSeasonAverage[] = [];

  // Fetch current season + 2 prior seasons
  for (const season of [CURRENT_SEASON, CURRENT_SEASON - 1, CURRENT_SEASON - 2]) {
    console.log(`  Season ${season}-${(season + 1).toString().slice(2)}...`);
    const avgs = await client.getSeasonAverages(playerIds, season);
    seasonAverages.push(...avgs);
  }
  console.log(`Got ${seasonAverages.length} season average records`);

  console.log('Transforming players...');
  const players: Player[] = [];
  for (const bdl of allBDLPlayers) {
    const playerSeasonAvgs = seasonAverages.filter((sa) => sa.player_id === bdl.id);
    if (playerSeasonAvgs.length === 0) continue; // Skip players with no stats

    const player = transformPlayer(bdl, playerSeasonAvgs, CURRENT_SEASON);
    players.push(player);
  }
  console.log(`Transformed ${players.length} players with stats`);

  // Set up rotations for each team
  console.log('Setting up rotations...');
  for (const team of teams) {
    const teamPlayers = players.filter((p) => p.teamId === team.id);
    team.roster = teamPlayers.map((p) => p.id);
    setupRotation(team, teamPlayers);
  }

  // Save data
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }

  await writeFile(
    path.join(DATA_DIR, 'teams.json'),
    JSON.stringify(teams, null, 2),
  );
  console.log(`Saved ${teams.length} teams to data/teams.json`);

  await writeFile(
    path.join(DATA_DIR, 'players.json'),
    JSON.stringify(players, null, 2),
  );
  console.log(`Saved ${players.length} players to data/players.json`);

  // Print summary
  console.log('\n=== Ingestion Complete ===');
  console.log(`Teams: ${teams.length}`);
  console.log(`Players: ${players.length}`);

  // Print top 10 players by overall rating
  const sorted = [...players].sort((a, b) => {
    const aOvr = avgRating(a);
    const bOvr = avgRating(b);
    return bOvr - aOvr;
  });

  console.log('\nTop 15 Players by Overall Rating:');
  for (const p of sorted.slice(0, 15)) {
    const ovr = avgRating(p);
    console.log(`  ${p.firstName} ${p.lastName} (${p.position}) - OVR: ${ovr} | 3PT: ${p.ratings.outsideShooting} | INT: ${p.ratings.interiorScoring} | DEF: ${Math.round((p.ratings.perimeterDefense + p.ratings.interiorDefense) / 2)}`);
  }
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
