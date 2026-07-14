/**
 * Smoke test for the injury system. Simulates a full season and reports league
 * injury totals and average games missed per player (by durability tier), then
 * asserts the system lands in a realistic range and is deterministic.
 *
 * Reads the season's append-only injury history (state.injuryHistory), which
 * records every injury with its finalized games-missed — so we advance the whole
 * season in one call and read the log directly.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { InjuryHistoryEntry } from '../src/models/season';
import { createSeasonState, advanceSeason } from '../src/engine/season';
import { addDays } from '../src/engine/calendar';
import { PLAYOFF_MAX_CALENDAR_DAYS } from '../src/engine/constants';

/** Runs a full season and returns its injury history. */
function runSeason(teams: Team[], players: Player[], seed: number): InjuryHistoryEntry[] {
  const state = createSeasonState(teams, players, { seed });
  // F2 injuries can cross the regular/postseason boundary; advance through the
  // champion so every pending history entry is finalized from actual missed games.
  advanceSeason(state, addDays(state.endDate, PLAYOFF_MAX_CALENDAR_DAYS), teams, players);
  return state.injuryHistory;
}

async function main() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const SEED = 2026;
  console.log(`Simulating full season (seed ${SEED})...`);
  const history = runSeason(teams, players, SEED);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Aggregate.
  const missedByPlayer = new Map<string, number>();
  const injuriesByTeam = new Map<string, number>();
  let seasonEndingCount = 0;
  let totalMissed = 0;

  for (const h of history) {
    totalMissed += h.gamesMissed;
    missedByPlayer.set(h.playerId, (missedByPlayer.get(h.playerId) ?? 0) + h.gamesMissed);
    injuriesByTeam.set(h.teamId, (injuriesByTeam.get(h.teamId) ?? 0) + 1);
    if (h.severity === 'season_ending') seasonEndingCount++;
  }

  const leagueAvgMissed = totalMissed / players.length;

  // Per-team injury counts.
  console.log('\n=== INJURIES BY TEAM ===');
  const teamRows = [...injuriesByTeam.entries()]
    .map(([tid, count]) => ({ name: teamById.get(tid)?.abbreviation ?? tid, count }))
    .sort((a, b) => b.count - a.count);
  for (const r of teamRows) console.log(`${r.name.padEnd(5)} ${r.count}`);
  console.log(`Total injuries: ${history.length} across ${injuriesByTeam.size} teams`);

  // Durability tiers: avg games missed per player (over ALL players in the tier,
  // injured or not) to show the durability gradient.
  const tiers: { label: string; lo: number; hi: number }[] = [
    { label: 'dur <30', lo: 0, hi: 29 },
    { label: 'dur 30-39', lo: 30, hi: 39 },
    { label: 'dur 40-49', lo: 40, hi: 49 },
    { label: 'dur 50-59', lo: 50, hi: 59 },
    { label: 'dur 60-69', lo: 60, hi: 69 },
    { label: 'dur 70+', lo: 70, hi: 999 },
  ];
  console.log('\n=== AVG GAMES MISSED BY DURABILITY TIER ===');
  console.log('Tier        Players  AvgMissed');
  for (const t of tiers) {
    const inTier = players.filter((p) => p.ratings.durability >= t.lo && p.ratings.durability <= t.hi);
    if (inTier.length === 0) continue;
    const missed = inTier.reduce((s, p) => s + (missedByPlayer.get(p.id) ?? 0), 0);
    const avg = missed / inTier.length;
    console.log(`${t.label.padEnd(11)} ${String(inTier.length).padStart(5)}    ${avg.toFixed(1).padStart(6)}`);
  }

  // Example: a single player's season injury history (the feature in action).
  const mostInjured = [...missedByPlayer.entries()].sort((a, b) => b[1] - a[1])[0];
  if (mostInjured) {
    const p = playerById.get(mostInjured[0])!;
    console.log(`\n=== SAMPLE HISTORY: ${p.firstName} ${p.lastName} (${mostInjured[1]} games missed) ===`);
    for (const h of history.filter((e) => e.playerId === mostInjured[0])) {
      console.log(`  ${h.startDate}  ${h.injuryType} (${h.region}, ${h.severity}) — missed ${h.gamesMissed}`);
    }
  }

  console.log('\n=== LEAGUE TOTALS ===');
  console.log(`Players: ${players.length}`);
  console.log(`Total games missed: ${totalMissed}`);
  console.log(`Avg games missed / player: ${leagueAvgMissed.toFixed(2)}`);
  console.log(`Season-ending (ACL) injuries: ${seasonEndingCount}`);

  // Determinism: a second identical run must produce the identical history.
  const history2 = runSeason(teams, players, SEED);
  const key = (h: InjuryHistoryEntry) => `${h.id}|${h.injuryType}|${h.severity}|${h.gamesMissed}`;
  const a = history.map(key).sort();
  const b = history2.map(key).sort();
  const identical = a.length === b.length && a.every((v, i) => v === b[i]);

  // Assertions.
  console.log('\n=== ASSERTIONS ===');
  const checks: [string, boolean][] = [
    [`avg games missed per player in [5, 15] (got ${leagueAvgMissed.toFixed(2)})`,
      leagueAvgMissed >= 5 && leagueAvgMissed <= 15],
    [`at least one season-ending injury (got ${seasonEndingCount})`, seasonEndingCount >= 1],
    [`identical injury history across two same-seed runs`, identical],
  ];
  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    allPass = allPass && ok;
  }

  if (!allPass) {
    console.error('\nINJURY SMOKE TEST FAILED');
    process.exit(1);
  }
  console.log('\nINJURY SMOKE TEST PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
