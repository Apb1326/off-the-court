/**
 * S2c2-R downstream shot-zone modifier decomposition (read-only).
 *
 * Attributes the candidate pool's realized six-zone shot mix to the cumulative
 * modifier stages inside selectShotZone (src/engine/play-types.ts): raw table
 * diet -> player tendencies -> shooter ability -> three dampener/bias and rim
 * deterrence -> spacing -> floor. Each observed shot's stage weights are
 * recomputed offline via explainShotZoneSelection from the exact inputs the
 * simulation used (carried on the read-only diagShot payload); the stages are
 * normalized to shares and averaged. Measurements only — no attribution prose,
 * no engine change, no additional RNG.
 *
 * Usage:
 *   node --import tsx scripts/diagnose-s2c2-zones.ts \
 *     [--league-dir=data/league-candidate] [--seed=2026] [--shot-zones=real]
 */
import { Player } from '../src/models/player';
import { ShotZone } from '../src/models/game';
import { SeededRNG } from '../src/lib/rng';
import { simulateGame } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';
import {
  CANDIDATE_PLAY_TYPE_SELECTION,
  PlayTypeSelectionConfig,
  ShotZoneWeightStages,
  explainShotZoneSelection,
} from '../src/engine/play-types';
import { loadLeaguePool } from './league-pool';

const ZONES: ShotZone[] = ['rim', 'short_midrange', 'long_midrange', 'corner_three', 'above_break_three', 'deep_three'];
const ZONE_LABELS = ['rim', 'short_mid', 'long_mid', 'corner3', 'above3', 'deep3'];
const STAGES: { key: keyof Omit<ShotZoneWeightStages, 'zones'>; label: string }[] = [
  { key: 'table', label: 's0 table diet' },
  { key: 'tendency', label: 's1 +tendencies' },
  { key: 'ability', label: 's2 +ability (3s)' },
  { key: 'dampener', label: 's3 +dampener/deter' },
  { key: 'spacing', label: 's4 +spacing' },
  { key: 'final', label: 's5 +floor (final)' },
];

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

function row(label: string, values: number[], digits: number): string {
  return label.padEnd(22) + values.map((v) => v.toFixed(digits).padStart(10)).join('');
}

async function main(): Promise<void> {
  for (const a of process.argv.slice(2)) {
    if (!/^--(league-dir|seed|shot-zones)=/.test(a)) throw new Error(`Unknown argument: ${a}`);
  }
  const leagueDir = arg('league-dir') ?? 'data/league-candidate';
  const seed = Number(arg('seed') ?? '2026');
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 2_000_000_000) throw new Error('--seed must be an integer in 1..2000000000');
  const shotZones = arg('shot-zones') ?? 'real';
  if (shotZones !== 'shaded' && shotZones !== 'real') throw new Error('--shot-zones must be shaded or real');
  // Candidate evaluation input only: the selection config is explicit here,
  // per the AGENTS.md candidate-selector and dual-table guards.
  const selection: PlayTypeSelectionConfig = shotZones === 'real'
    ? Object.freeze({ ...CANDIDATE_PLAY_TYPE_SELECTION, shotZones: 'real' as const })
    : CANDIDATE_PLAY_TYPE_SELECTION;

  const pool = await loadLeaguePool(['--league-dir', leagueDir]);
  const { teams, players } = pool;
  const playerById = new Map<string, Player>(players.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<string, Player[]>();
  for (const t of teams) playersByTeam.set(t.id, []);
  for (const p of players) if (p.teamId && playersByTeam.has(p.teamId)) playersByTeam.get(p.teamId)!.push(p);

  // Per-stage running sums of normalized zone shares, plus realized choices.
  const stageSums = new Map<string, Map<ShotZone, number>>(STAGES.map((s) => [s.key, new Map(ZONES.map((z) => [z, 0]))]));
  const realized = new Map<ShotZone, number>(ZONES.map((z) => [z, 0]));
  let shots = 0;
  let skipped = 0;

  // Mirror profile-engine's schedule and per-game seed stream.
  const rng = new SeededRNG(seed);
  const schedule = generateSchedule(teams, rng);
  let played = 0;
  for (const sg of schedule) {
    const home = teamById.get(sg.homeTeamId);
    const away = teamById.get(sg.awayTeamId);
    if (!home || !away) continue;
    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    played++;
    simulateGame(home, away, homePlayers, awayPlayers, sg.id, 's2c2-r-zones', `day-${sg.day}`, gameSeed, new Map(), {
      onShot: (s) => {
        const shooter = playerById.get(s.shooterId);
        if (!shooter) { skipped++; return; }
        const stages = explainShotZoneSelection(shooter, s.terminalPlayType, {
          threePointBias: s.zoneThreePointBias,
          rimDeterrence: s.zoneRimDeterrence,
          spacing: s.zoneSpacing,
        }, selection);
        shots++;
        realized.set(s.zone, (realized.get(s.zone) ?? 0) + 1);
        for (const stage of STAGES) {
          const weights = stages[stage.key];
          // Pre-floor stages can carry small negative spacing-adjusted weights;
          // clamp at 0 for the share view (the engine's own clamp is stage s5).
          let total = 0;
          for (const w of weights) total += Math.max(0, w);
          if (total <= 0) { skipped++; continue; }
          const sums = stageSums.get(stage.key)!;
          for (let i = 0; i < stages.zones.length; i++) {
            const zone = stages.zones[i];
            sums.set(zone, (sums.get(zone) ?? 0) + Math.max(0, weights[i]) / total);
          }
        }
      },
    }, selection);
  }

  const stageShares = (key: string): number[] => {
    const sums = stageSums.get(key)!;
    return ZONES.map((z) => ((sums.get(z) ?? 0) / Math.max(1, shots)) * 100);
  };
  const realizedShares = ZONES.map((z) => ((realized.get(z) ?? 0) / Math.max(1, shots)) * 100);
  const buckets = (shares: number[]): number[] => [shares[0], shares[1] + shares[2], shares[3] + shares[4] + shares[5]];

  console.log(`\n=== S2c2-R shot-zone modifier decomposition — ${played} games, seed ${seed} ===`);
  console.log(`pool ${leagueDir}; selector candidate; zone table ${shotZones}; shots ${shots}; skipped stage vectors ${skipped}`);
  console.log('\nExpected zone-share % by cumulative selectShotZone modifier stage (mean over all shot selections)');
  console.log(row('Stage', [], 1) + ZONE_LABELS.map((z) => z.padStart(10)).join(''));
  for (const stage of STAGES) console.log(row(stage.label, stageShares(stage.key), 1));
  console.log(row('realized (chosen)', realizedShares, 1));

  console.log('\nThree-bucket view (rim / mid / three)');
  console.log(row('Stage', [], 1) + ['rim', 'mid', 'three'].map((z) => z.padStart(10)).join(''));
  for (const stage of STAGES) console.log(row(stage.label, buckets(stageShares(stage.key)), 1));
  console.log(row('realized (chosen)', buckets(realizedShares), 1));

  console.log('\nStage deltas (pp of zone share introduced by each stage)');
  console.log(row('Stage', [], 1) + ZONE_LABELS.map((z) => z.padStart(10)).join(''));
  for (let i = 1; i < STAGES.length; i++) {
    const prev = stageShares(STAGES[i - 1].key);
    const cur = stageShares(STAGES[i].key);
    console.log(row(STAGES[i].label, cur.map((v, j) => v - prev[j]), 2));
  }
  const final = stageShares('final');
  console.log(row('sampling (real-s5)', realizedShares.map((v, j) => v - final[j]), 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
