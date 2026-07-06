/**
 * S1-Rb assisted-zone sign-structure diagnosis (Phase C).
 *
 * Real NBA per-zone assisted rates concentrate on the corner three (0.967 vs
 * 0.58-0.81 elsewhere); the engine's chain assists are ~flat (~0.62-0.68) with
 * corner NOT highest. This instrument collects chain provenance per shot
 * (initial play type, terminal play type, pass count, double-team, advantage,
 * zone, make, assist) via the TEMPORARY diagnostic hook to distinguish:
 *   (a) kick-out routing failing to generate corner attempts,
 *   (b) assisted possessions terminating in the wrong zones,
 *   (c) play-type shot-diet interactions,
 *   (d) the strict pass-into-the-make definition undercounting catch-and-shoot.
 *
 * Diagnostic-only; nothing here persists into PlayByPlayEvent or game results.
 *
 * Usage: node --import tsx scripts/diagnose-assists.ts [--games=N]
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { PlayType, ShotZone } from '../src/models/game';
import { SeededRNG } from '../src/lib/rng';
import { simulateGame } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';

const ZONES: ShotZone[] = ['rim', 'short_midrange', 'long_midrange', 'corner_three', 'above_break_three', 'deep_three'];

interface ZoneAgg {
  att: number;
  made: number;
  assistedMade: number;
  // terminal play type splits (attempts / assisted makes)
  termAtt: Map<PlayType, number>;
  termAssisted: Map<PlayType, number>;
  // attempt provenance
  zeroPassAtt: number;          // shot by the initial actor (never assisted)
  passAtt: number;              // shot after >=1 pass (assist-eligible)
  initialSpotUpZeroPass: number; // zero-pass attempts whose initial type was spot_up/off_screen (real-life catch-and-shoot)
  initialCsZeroPassMade: number; // makes among those
  dtAtt: number;                // initial ball-handler doubled
  advAtt: number;               // advantage cashed before the shot
}

function newZoneAgg(): ZoneAgg {
  return {
    att: 0, made: 0, assistedMade: 0,
    termAtt: new Map(), termAssisted: new Map(),
    zeroPassAtt: 0, passAtt: 0, initialSpotUpZeroPass: 0, initialCsZeroPassMade: 0,
    dtAtt: 0, advAtt: 0,
  };
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main() {
  const cap = arg('games') ? parseInt(arg('games')!, 10) : Infinity;
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));

  const rng = new SeededRNG(2026);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) {
    if (p.teamId && playersByTeam.has(p.teamId)) playersByTeam.get(p.teamId)!.push(p);
  }
  const schedule = generateSchedule(teams, rng);

  const byZone = new Map<ShotZone, ZoneAgg>(ZONES.map((z) => [z, newZoneAgg()]));
  // Pass-count distribution over all shots, and per assisted make.
  const passCountShots = new Map<number, number>();
  let played = 0;

  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;
    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    if (played >= cap) continue;
    played++;

    simulateGame(home, away, homePlayers, awayPlayers, sg.id, 'diag', `day-${sg.day}`, gameSeed, new Map(), {
      onShot: (s) => {
        const agg = byZone.get(s.zone)!;
        agg.att++;
        passCountShots.set(s.passCount, (passCountShots.get(s.passCount) ?? 0) + 1);
        agg.termAtt.set(s.terminalPlayType, (agg.termAtt.get(s.terminalPlayType) ?? 0) + 1);
        if (s.passCount === 0) {
          agg.zeroPassAtt++;
          if (s.initialPlayType === 'spot_up' || s.initialPlayType === 'off_screen') {
            agg.initialSpotUpZeroPass++;
            if (s.made) agg.initialCsZeroPassMade++;
          }
        } else {
          agg.passAtt++;
        }
        if (s.initialDoubled) agg.dtAtt++;
        if (s.advantageCashed) agg.advAtt++;
        if (s.made) {
          agg.made++;
          if (s.assisted) agg.assistedMade++;
        }
      },
    });
  }

  console.log(`\n=== S1-Rb assisted-zone diagnosis — ${played} games, seed 2026 ===\n`);
  console.log('Zone'.padEnd(20) + 'att'.padStart(8) + 'made'.padStart(8) + 'astMade'.padStart(9) +
    'astRate'.padStart(9) + '0-pass%'.padStart(9) + 'CS-0p%'.padStart(8) + 'dt%'.padStart(7) + 'adv%'.padStart(7));
  for (const z of ZONES) {
    const a = byZone.get(z)!;
    console.log(
      z.padEnd(20) +
      String(a.att).padStart(8) +
      String(a.made).padStart(8) +
      String(a.assistedMade).padStart(9) +
      ((a.assistedMade / a.made) * 100).toFixed(1).padStart(9) +
      ((a.zeroPassAtt / a.att) * 100).toFixed(1).padStart(9) +
      ((a.initialSpotUpZeroPass / a.att) * 100).toFixed(1).padStart(8) +
      ((a.dtAtt / a.att) * 100).toFixed(1).padStart(7) +
      ((a.advAtt / a.att) * 100).toFixed(1).padStart(7),
    );
  }
  console.log('\n(0-pass% = attempts by the initial actor, structurally unassisted;');
  console.log(' CS-0p% = 0-pass attempts whose INITIAL play type was spot_up/off_screen —');
  console.log(' catch-and-shoot in real life, i.e. assisted under NBA scorekeeping.)');

  console.log('\nPass-count distribution over all shots:');
  for (const [k, v] of [...passCountShots.entries()].sort((a, b) => a[0] - b[0])) {
    const total = [...passCountShots.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${k} passes: ${((v / total) * 100).toFixed(1)}%`);
  }

  console.log('\nTerminal play-type split per zone (attempts %; assisted rate of makes per type):');
  for (const z of ZONES) {
    const a = byZone.get(z)!;
    const rows = [...a.termAtt.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
      .map(([pt, n]) => `${pt} ${((n / a.att) * 100).toFixed(0)}%`);
    console.log(`  ${z.padEnd(20)} ${rows.join('  ')}`);
  }

  // Counterfactual definitional re-mapping: if the NBA scorekeeper definition
  // (any catch-and-shoot counts) were applied, zero-pass shots from spot_up /
  // off_screen initial actions would be assisted. Recompute rates under that
  // remap — measurement only, no engine change.
  console.log('\nCounterfactual: NBA-style definition (0-pass spot_up/off_screen makes counted assisted):');
  for (const z of ZONES) {
    const a = byZone.get(z)!;
    const remapped = a.assistedMade + a.initialCsZeroPassMade;
    console.log(`  ${z.padEnd(20)} chain ${((a.assistedMade / a.made) * 100).toFixed(1)}%  ->  remapped ${((remapped / a.made) * 100).toFixed(1)}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
