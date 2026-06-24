import { Team } from '@/models/team';
import { ScheduledGame } from '@/models/season';
import { SeededRNG } from '@/lib/rng';

/**
 * Generate a balanced NBA-style regular-season schedule.
 *
 * Each team plays:
 *  - intra-conference opponents 4 times (2 home, 2 away)
 *  - inter-conference opponents 2 times (1 home, 1 away)
 *
 * With 30 teams that works out to 14*4 + 15*2 = 86 games per team (close to the
 * real 82), and home/away are exactly balanced for every matchup.
 *
 * Games are spread across "days" so that no team plays twice on the same day,
 * which lets the UI present a believable day-by-day calendar.
 */
export function generateSchedule(teams: Team[], rng: SeededRNG): ScheduledGame[] {
  const matchups: { home: string; away: string }[] = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      const sameConference = a.conference === b.conference;
      const homeGamesEach = sameConference ? 2 : 1;

      for (let g = 0; g < homeGamesEach; g++) {
        matchups.push({ home: a.id, away: b.id });
        matchups.push({ home: b.id, away: a.id });
      }
    }
  }

  // Shuffle, then greedily pack into days so a team never appears twice per day.
  const shuffled = rng.shuffle(matchups);
  const games: ScheduledGame[] = [];
  const dayUsage: Map<number, Set<string>> = new Map();
  let counter = 0;

  for (const m of shuffled) {
    let day = 0;
    // Find the earliest day where neither team is already scheduled.
    while (true) {
      const used = dayUsage.get(day);
      if (!used || (!used.has(m.home) && !used.has(m.away))) break;
      day++;
    }
    if (!dayUsage.has(day)) dayUsage.set(day, new Set());
    const used = dayUsage.get(day)!;
    used.add(m.home);
    used.add(m.away);

    games.push({
      id: `g${counter++}`,
      homeTeamId: m.home,
      awayTeamId: m.away,
      day,
    });
  }

  games.sort((a, b) => a.day - b.day);
  return games;
}
