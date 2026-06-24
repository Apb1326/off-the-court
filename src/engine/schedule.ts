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
  // Soft cap on games per night so the slate spreads across a realistic ~160
  // game-days (~8 games a night) instead of cramming all 15 into one slot.
  const GAMES_PER_DAY = 8;
  const dayUsage: Map<number, Set<string>> = new Map();
  const dayCount: Map<number, number> = new Map();
  let counter = 0;

  for (const m of shuffled) {
    let day = 0;
    // Find the earliest day that has room and where neither team already plays.
    while (true) {
      const used = dayUsage.get(day);
      const count = dayCount.get(day) ?? 0;
      const teamsFree = !used || (!used.has(m.home) && !used.has(m.away));
      if (teamsFree && count < GAMES_PER_DAY) break;
      day++;
    }
    if (!dayUsage.has(day)) dayUsage.set(day, new Set());
    const used = dayUsage.get(day)!;
    used.add(m.home);
    used.add(m.away);
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);

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
