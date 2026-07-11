/**
 * S2c1-R candidate play-type selection diagnosis.
 *
 * This is a read-only observer report. It consumes no additional RNG and does
 * not change the returned game, box score, or play-by-play. The report is
 * intentionally generated from a fixed seed and contains no wall-clock data.
 *
 * Usage:
 *   node --import tsx scripts/diagnose-s2c1-selection.ts \
 *     --league-dir data/league-candidate --seed 2026
 *   ... --check
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { PlayType } from '../src/models/game';
import { Player, Position } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateGame, GameDiagObserver } from '../src/engine';
import { generateSchedule } from '../src/engine/schedule';
import { CANDIDATE_PLAY_TYPE_SELECTION } from '../src/engine/play-types';
import { SeededRNG } from '../src/lib/rng';
import { loadLeaguePool } from './league-pool';
import { loadPlayTypes } from '../src/data/nba/load';

const REPORT_PATH = path.join(process.cwd(), 'docs', 'S2C1_R_SELECTION_DIAGNOSIS.md');
const TERMINAL_OUTCOMES = new Set(['made_shot', 'missed_shot', 'and_one', 'turnover']);
const PLAY_TYPES: PlayType[] = [
  'isolation', 'pick_and_roll', 'post_up', 'spot_up',
  'transition', 'cut', 'off_screen', 'handoff',
];
const TARGETS: Record<PlayType, number> = {
  isolation: 0.0819,
  pick_and_roll: 0.254,
  post_up: 0.0424,
  spot_up: 0.2561,
  transition: 0.1966,
  cut: 0.0732,
  off_screen: 0.0408,
  handoff: 0.055,
  putback: 0,
};
const TENDENCY_FIELD: Record<PlayType, keyof Player['tendencies']> = {
  isolation: 'isolationFreq',
  pick_and_roll: 'pickAndRollBallHandlerFreq',
  post_up: 'postUpFreq',
  spot_up: 'spotUpFreq',
  transition: 'transitionFreq',
  cut: 'cutFreq',
  off_screen: 'offScreenFreq',
  handoff: 'handoffFreq',
  putback: 'rimRate',
};
const ACTIVE_BASELINE_HASHES = {
  profileStdout: '7482a68d7859ff8c8f962832ff4978ba32621c700594fd4deae785e82759e95a',
  profileStderr: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  profileStatus: 0,
  calibrateStdout: 'a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4',
  calibrateStderr: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  calibrateStatus: 0,
};

interface Args { leagueDir: string; seed: number; check: boolean }
interface Pending {
  initial: PlayType;
  ballHandlerId: string;
  isTransition: boolean;
  triggeredByTurnover: boolean;
  triggeredByLongRebound: boolean;
  primaryId?: string;
  primaryPosition?: Position;
  shot?: { terminal: PlayType; passCount: number };
}
interface Counter {
  total: number;
  byType: Map<PlayType, number>;
}

function parseArgs(argv: string[]): Args {
  let leagueDir = 'data/league-candidate';
  let seed = 2026;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--league-dir') leagueDir = argv[++i] ?? '';
    else if (arg === '--seed') seed = Number(argv[++i]);
    else if (arg === '--check') check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative integer');
  return { leagueDir, seed, check };
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementPlay(map: Map<PlayType, number>, key: PlayType, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function pct(value: number, digits = 1): string { return `${(value * 100).toFixed(digits)}%`; }
function signedPp(value: number): string { return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`; }
function average(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function standardDeviation(values: number[]): number {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}
function formatTable(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row, index) => {
    const line = `| ${row.map((value, column) => value.padEnd(widths[column])).join(' | ')} |`;
    return index === 0
      ? `${line}\n| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`
      : line;
  }).join('\n');
}

function allRosteredPlayers(teams: Team[], players: Player[]): Player[] {
  const rosterIds = new Set(teams.flatMap((team) => team.roster));
  return players.filter((player) => rosterIds.has(player.id));
}

function readFallbackIds(): Set<string> {
  const report = path.join(process.cwd(), 'docs', 'S2C1_TENDENCIES_CONTRACT.md');
  if (!existsSync(report)) return new Set();
  return new Set(readFileSync(report, 'utf8').split('\n')
    .filter((line) => line.startsWith('| nba_') && line.includes('| play-type frequencies |'))
    .map((line) => line.split('|')[1].trim()));
}

function shareMap(map: Map<PlayType, number>, total: number): Map<PlayType, number> {
  return new Map(PLAY_TYPES.map((type) => [type, (map.get(type) ?? 0) / Math.max(1, total)]));
}

function renderDistribution(title: string, shares: Map<PlayType, number>): string[] {
  const lines = [`### ${title}`, '', formatTable([
    ['Play type', 'Share', 'Synergy', 'Delta'],
    ...PLAY_TYPES.map((type) => [type, pct(shares.get(type) ?? 0), pct(TARGETS[type]), signedPp((shares.get(type) ?? 0) - TARGETS[type])]),
  ]), ''];
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = await loadLeaguePool(['--league-dir', args.leagueDir]);
  const teams = pool.teams;
  const players = pool.players;
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const playersByTeam = new Map<string, Player[]>();
  for (const team of teams) playersByTeam.set(team.id, []);
  for (const player of players) if (player.teamId && playersByTeam.has(player.teamId)) playersByTeam.get(player.teamId)!.push(player);

  const initialCounts = new Map<PlayType, number>();
  const terminalCounts = new Map<PlayType, number>();
  const primaryCounts = new Map<string, number>();
  const primaryPositionCounts = new Map<Position, number>();
  const initialByTeam = new Map<string, Map<PlayType, number>>();
  const terminalByTeam = new Map<string, Map<PlayType, number>>();
  const matrix = new Map<PlayType, Map<PlayType, number>>();
  const physicalMatrix = new Map<PlayType, Map<PlayType, number>>();
  const initialTurnovers = new Map<PlayType, number>();
  const terminalTurnovers = new Map<PlayType, number>();
  const breakdowns = new Map<PlayType, { system: number[]; tendency: number[]; tendencyFactor: number[]; position: number[]; situation: number[]; final: number[] }>();
  for (const type of PLAY_TYPES) {
    matrix.set(type, new Map());
    physicalMatrix.set(type, new Map());
    breakdowns.set(type, { system: [], tendency: [], tendencyFactor: [], position: [], situation: [], final: [] });
  }
  const opportunityByPlayer = new Map<string, number>();
  const opportunityByTeam = new Map<string, number>();
  const transitionCauses = { eligible: 0, turnover: 0, longRebound: 0, both: 0, opportunity: 0 };
  const allEvents = new Map<string, number>();
  const fallbackIds = readFallbackIds();
  let fallbackInitial = 0;
  let fallbackTerminal = 0;
  let terminalTotal = 0;
  let passReplaced = 0;
  let shotTerminalCount = 0;
  const pendingByGame = new Map<string, Pending | undefined>();

  const observe = (gameKey: string): GameDiagObserver => ({
    onInitialSelection: (info) => {
      pendingByGame.set(gameKey, {
        initial: info.initialPlayType,
        ballHandlerId: info.ballHandlerId,
        isTransition: info.isTransitionOpportunity,
        triggeredByTurnover: info.previousPossessionWasTurnover,
        triggeredByLongRebound: info.previousPossessionWasLongRebound,
      });
      incrementPlay(initialCounts, info.initialPlayType);
      const breakdown = breakdowns.get(info.initialPlayType);
      if (breakdown) {
        const row = info.breakdown.find((item) => item.playType === info.initialPlayType);
        if (row) {
          breakdown.system.push(row.systemFactor);
          breakdown.tendency.push(row.tendency);
          breakdown.tendencyFactor.push(row.tendencyFactor);
          breakdown.position.push(row.positionFactor);
          breakdown.situation.push(row.situationFactor);
          breakdown.final.push(row.finalWeight);
        }
      }
      if (info.previousPossessionWasTurnover || info.previousPossessionWasLongRebound) {
        transitionCauses.eligible++;
        if (info.previousPossessionWasTurnover) transitionCauses.turnover++;
        if (info.previousPossessionWasLongRebound) transitionCauses.longRebound++;
        if (info.previousPossessionWasTurnover && info.previousPossessionWasLongRebound) transitionCauses.both++;
      }
      if (info.isTransitionOpportunity) transitionCauses.opportunity++;
      if (fallbackIds.has(info.ballHandlerId)) fallbackInitial++;
    },
    onPrimarySelection: (info) => {
      const pending = pendingByGame.get(gameKey);
      if (pending) {
        pending.primaryId = info.primaryPlayerId;
        pending.primaryPosition = info.primaryPosition;
      }
      increment(primaryCounts, info.primaryPlayerId);
      increment(primaryPositionCounts, info.primaryPosition);
      const player = players.find((candidate) => candidate.id === info.primaryPlayerId);
      if (player) increment(opportunityByTeam, player.teamId);
      increment(opportunityByPlayer, info.primaryPlayerId);
    },
    onShot: (info) => {
      const pending = pendingByGame.get(gameKey);
      if (pending) {
        pending.shot = { terminal: info.terminalPlayType, passCount: info.passCount };
        const physicalRow = physicalMatrix.get(pending.initial) ?? new Map<PlayType, number>();
        incrementPlay(physicalRow, info.terminalPlayType);
        physicalMatrix.set(pending.initial, physicalRow);
        if (info.passCount > 0) passReplaced++;
        shotTerminalCount++;
      }
    },
    onEvent: (event) => {
      increment(allEvents, event.outcome);
      if (!TERMINAL_OUTCOMES.has(event.outcome)) {
        pendingByGame.delete(gameKey);
        return;
      }
      terminalTotal++;
      const pending = pendingByGame.get(gameKey);
      const initial = pending?.initial ?? event.type;
      incrementPlay(terminalCounts, event.type);
      incrementPlay(initialTurnovers, initial, event.outcome === 'turnover' ? 1 : 0);
      incrementPlay(terminalTurnovers, event.type, event.outcome === 'turnover' ? 1 : 0);
      const row = matrix.get(initial) ?? new Map<PlayType, number>();
      incrementPlay(row, event.type);
      matrix.set(initial, row);
      const byTeam = terminalByTeam.get(event.possessionTeamId) ?? new Map<PlayType, number>();
      incrementPlay(byTeam, event.type);
      terminalByTeam.set(event.possessionTeamId, byTeam);
      const initialTeam = initialByTeam.get(event.possessionTeamId) ?? new Map<PlayType, number>();
      incrementPlay(initialTeam, initial);
      initialByTeam.set(event.possessionTeamId, initialTeam);
      if (pending && fallbackIds.has(pending.primaryId ?? event.primaryPlayerId)) fallbackTerminal++;
      pendingByGame.delete(gameKey);
    },
  });

  const rng = new SeededRNG(args.seed);
  const schedule = generateSchedule(teams, rng);
  for (const scheduled of schedule) {
    const home = teamById.get(scheduled.homeTeamId);
    const away = teamById.get(scheduled.awayTeamId);
    if (!home || !away) continue;
    const homePlayers = playersByTeam.get(home.id) ?? [];
    const awayPlayers = playersByTeam.get(away.id) ?? [];
    if (homePlayers.length < 5 || awayPlayers.length < 5) continue;
    const gameSeed = rng.nextInt(1, 2_000_000_000);
    simulateGame(home, away, homePlayers, awayPlayers, scheduled.id, 's2c1-r-diagnosis', `day-${scheduled.day}`, gameSeed, new Map(), observe(scheduled.id), CANDIDATE_PLAY_TYPE_SELECTION);
  }

  const initialShares = shareMap(initialCounts, [...initialCounts.values()].reduce((a, b) => a + b, 0));
  const initialTotal = [...initialCounts.values()].reduce((a, b) => a + b, 0);
  const terminalShares = shareMap(terminalCounts, terminalTotal);
  const rostered = allRosteredPlayers(teams, players);
  const mass = (weights: Map<string, number>): Map<PlayType, number> => {
    const sums = new Map<PlayType, number>();
    let total = 0;
    for (const player of rostered) {
      const weight = weights.get(player.id) ?? 0;
      total += weight;
      for (const type of PLAY_TYPES) {
        const tendency = type === 'pick_and_roll'
          ? player.tendencies.pickAndRollBallHandlerFreq + player.tendencies.pickAndRollScreenerFreq
          : player.tendencies[TENDENCY_FIELD[type]];
        sums.set(type, (sums.get(type) ?? 0) + weight * tendency);
      }
    }
    return new Map(PLAY_TYPES.map((type) => [type, (sums.get(type) ?? 0) / Math.max(1, total)]));
  };
  const usageWeights = new Map(rostered.map((player) => [player.id, player.tendencies.usageRate]));
  const opportunityMass = mass(opportunityByPlayer);
  const rosterMass = mass(usageWeights);
  const transitionOpportunityRate = transitionCauses.opportunity / Math.max(1, initialTotal);
  const mappedSynergyPossessions = loadPlayTypes('2025-26').rows
    .filter((row) => row.typeGrouping === 'offensive' && ['Isolation', 'PRBallHandler', 'PRRollMan', 'Postup', 'Spotup', 'Transition', 'Cut', 'OffScreen', 'Handoff'].includes(row.playType))
    .reduce((sum, row) => sum + (row.poss ?? 0), 0);

  const lines: string[] = [
    '# S2c1-R — Candidate Play-Type Selection Diagnosis', '',
    '> Generated by `scripts/diagnose-s2c1-selection.ts`; regenerate, never hand-edit.',
    '> The observer is read-only and consumes no RNG. The canonical denominator is unchanged.', '',
    '## Provenance', '',
    `- Repository commit: **${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}**.`,
    `- Candidate input: **${path.resolve(args.leagueDir)}**.`,
    `- Fixed full-season seed: **${args.seed}**; candidate selection mode is explicitly enabled; schedule and game-seed stream mirrors profile-engine.ts.`,
    '- Candidate pool build/check prerequisite: `69b152a` landing series (`849c2fa`, `7a8bddd`, `69b152a`).',
    '- Synergy source: normalized 2025-26 playtypes, mapped categories with Misc excluded.', '',
    '## Denominator audit', '',
    `- Engine canonical terminal denominator: **${terminalTotal}** events = made shots + missed shots + and-ones + turnovers.`,
    `- Excluded engine events: ${[...allEvents.entries()].filter(([outcome]) => !TERMINAL_OUTCOMES.has(outcome)).map(([outcome, count]) => `${outcome} ${count}`).join(', ') || 'none observed'}.`,
    `- Harvested Synergy mapped possession mass: **${mappedSynergyPossessions.toFixed(1)}** across the mapped offensive categories; Misc and unmapped categories are excluded.`,
    '- The two universes are not row-for-row identical (Synergy is player/category possession mass; the engine is terminal emitted events), but they are the closest reproducible comparison already used by the Stage-1 informational report. No denominator change is made.', '',
    '## Derived roster tendency mass', '',
    'The first row is a rostered-player usage-weighted proxy for the derived tendency mass. The second weights each player by observed simulated primary-player opportunities; neither is a simple player mean.', '',
    formatTable([
      ['Weighting', ...PLAY_TYPES],
      ['Roster usage', ...PLAY_TYPES.map((type) => pct(rosterMass.get(type) ?? 0))],
      ['Primary opportunity', ...PLAY_TYPES.map((type) => pct(opportunityMass.get(type) ?? 0))],
      ['Synergy target', ...PLAY_TYPES.map((type) => pct(TARGETS[type]))],
    ]), '',
    '## Primary actor distribution', '',
    `- Primary-player opportunities observed: **${[...primaryCounts.values()].reduce((a, b) => a + b, 0)}**.`,
    `- Position shares: ${[...primaryPositionCounts.entries()].sort().map(([position, count]) => `${position} ${pct(count / Math.max(1, [...primaryCounts.values()].reduce((a, b) => a + b, 0)))}`).join(', ')}.`,
    formatTable([
      ['Top primary actors', 'Share'],
      ...[...primaryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, count]) => [id, pct(count / Math.max(1, [...primaryCounts.values()].reduce((a, b) => a + b, 0)))]),
    ]), '',
    '## Initial selection', '',
  ];
  lines.push(...renderDistribution('Initial all-possession distribution', initialShares));
  lines.push('### Non-transition selector factors', '', formatTable([
    ['Play type', 'N', 'Tendency', 'Derived weight', 'System', 'Position', 'Situation', 'Final weight'],
    ...PLAY_TYPES.filter((type) => type !== 'transition').map((type) => {
      const row = breakdowns.get(type)!;
      return [type, String(row.final.length), row.tendency.length ? average(row.tendency).toFixed(3) : 'n/a', row.tendencyFactor.length ? average(row.tendencyFactor).toFixed(3) : 'n/a', row.system.length ? average(row.system).toFixed(3) : 'n/a', row.position.length ? average(row.position).toFixed(3) : 'n/a', row.situation.length ? average(row.situation).toFixed(3) : 'n/a', row.final.length ? average(row.final).toFixed(3) : 'n/a'];
    }),
  ]), '');
  lines.push(...renderDistribution('Terminal emitted-event distribution', terminalShares));
  lines.push('### Initial → terminal transformation matrix', '', formatTable([
    ['Initial type', 'Attempts', ...PLAY_TYPES],
    ...PLAY_TYPES.map((initial) => {
      const row = matrix.get(initial) ?? new Map<PlayType, number>();
      const attempts = [...row.values()].reduce((a, b) => a + b, 0);
      return [initial, String(attempts), ...PLAY_TYPES.map((terminal) => pct((row.get(terminal) ?? 0) / Math.max(1, attempts)))];
    }),
  ]), '',
    `- A pass replaced the initial action before a shot in **${passReplaced}** of **${shotTerminalCount}** observed shot terminals (${pct(passReplaced / Math.max(1, shotTerminalCount))}). Turnover-chain passes are retained in the matrix but do not have a shot pass-count callback.`,
    `- Initial turnovers: ${PLAY_TYPES.map((type) => `${type} ${initialTurnovers.get(type) ?? 0}`).join(', ')}.`,
    `- Terminal turnovers: ${PLAY_TYPES.map((type) => `${type} ${terminalTurnovers.get(type) ?? 0}`).join(', ')}.`, '',
    '## Transition routing', '',
    `- Transition opportunity rate: **${pct(transitionOpportunityRate)}** of initial selections; terminal transition share: **${pct(terminalShares.get('transition') ?? 0)}**; Synergy: **${pct(TARGETS.transition)}**; real transition-FGA timing proxy: **18.9%**.`,
    `- Upstream eligible causes: turnover **${transitionCauses.turnover}**, long rebound **${transitionCauses.longRebound}**, both **${transitionCauses.both}**, any eligible **${transitionCauses.eligible}**; opportunities **${transitionCauses.opportunity}**.`,
    '- Candidate transitionFreq is consumed conditionally by the existing upstream turnover/long-rebound gate; it is not added to the ordinary weighted-choice list, so there is no double count.', '',
    '## Fallback influence', '',
    `- Players listed with positional play-type fallback: **${fallbackIds.size}**; rostered simulation players: **${rostered.length}**.`,
    `- Fallback ball-handler initiation share: **${pct(fallbackInitial / Math.max(1, initialTotal))}**; fallback primary/terminal share: **${pct(fallbackTerminal / Math.max(1, terminalTotal))}**.`, '',
    '',
  );

  lines.push('### Physical finisher action matrix (shot terminals)', '',
    'The emitted matrix above is the candidate possession-level label used for the Synergy comparison. This second matrix retains the physical finisher action selected by the unchanged receiver/chain path, so the diagnostic does not hide the chain transformation or alter shot-zone lookup semantics.', '',
    formatTable([
      ['Initial type', 'Shot terminals', ...PLAY_TYPES],
      ...PLAY_TYPES.map((initial) => {
        const row = physicalMatrix.get(initial) ?? new Map<PlayType, number>();
        const attempts = [...row.values()].reduce((a, b) => a + b, 0);
        return [initial, String(attempts), ...PLAY_TYPES.map((terminal) => pct((row.get(terminal) ?? 0) / Math.max(1, attempts)))];
      }),
    ]), '');
  lines.push('## Team-level variation', '');

  const teamRows = (type: PlayType): string[][] => {
    const rows = teams.map((team) => {
      const counts = terminalByTeam.get(team.id) ?? new Map<PlayType, number>();
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      return [team.abbreviation, pct((counts.get(type) ?? 0) / Math.max(1, total))];
    }).sort((a, b) => Number.parseFloat(a[1]) - Number.parseFloat(b[1]));
    return rows;
  };
  for (const type of ['transition', 'isolation', 'pick_and_roll', 'spot_up'] as PlayType[]) {
    const rows = teamRows(type);
    lines.push(`### ${type} team shares`, '', `- Mean **${pct(average(rows.map((row) => Number.parseFloat(row[1]) / 100)))}**; SD **${pct(standardDeviation(rows.map((row) => Number.parseFloat(row[1]) / 100)))}**.`, '', formatTable([
      ['Bottom five', 'Share'], ...rows.slice(0, 5),
      ['Top five', 'Share'], ...rows.slice(-5).reverse(),
    ]), '');
  }

  const explanations = PLAY_TYPES.filter((type) => type !== 'transition').map((type) => {
    const delta = (terminalShares.get(type) ?? 0) - TARGETS[type];
    const initialDelta = (initialShares.get(type) ?? 0) - TARGETS[type];
    return `- **${type}:** initial ${pct(initialShares.get(type) ?? 0)} (${signedPp(initialDelta)}), terminal ${pct(terminalShares.get(type) ?? 0)} (${signedPp(delta)}); the matrix and factor row above separate selector mass from chain transformation.`;
  });
  lines.push('## Required diagnosis conclusion', '',
    ...explanations,
    `- **Transition routing:** the candidate gate produced ${pct(transitionOpportunityRate)} opportunities from ${transitionCauses.eligible} eligible possessions; the candidate's transitionFreq is consumed conditionally on those existing turnover/long-rebound precursors, yielding terminal ${pct(terminalShares.get('transition') ?? 0)} versus Synergy ${pct(TARGETS.transition)}.`,
    '- **Isolation/cut excess and PnR deficit:** the measured non-transition selector factors and initial→terminal matrix show whether the mismatch is introduced by the ball-handler tendency interpretation, position/system multipliers, or receiver-chain replacement; no repair is made in this diagnostic phase.', '',
    '## Active-pool no-drift reference', '',
    `- profile stdout SHA-256: **${ACTIVE_BASELINE_HASHES.profileStdout}** (exit ${ACTIVE_BASELINE_HASHES.profileStatus})`,
    `- profile stderr SHA-256: **${ACTIVE_BASELINE_HASHES.profileStderr}**`,
    `- calibrate stdout SHA-256: **${ACTIVE_BASELINE_HASHES.calibrateStdout}** (exit ${ACTIVE_BASELINE_HASHES.calibrateStatus})`,
    `- calibrate stderr SHA-256: **${ACTIVE_BASELINE_HASHES.calibrateStderr}**`, '',
    '## Verdict', '',
    '- This generated artifact records measurements and provenance only; it makes no phase-status claim. Current status and interpretation live in `docs/ROADMAP.md` (§3.2, §4.2) and `docs/PROJECT_STATUS.md`; the S2c1-R acceptance record is `docs/S2C1_CANDIDATE_PROFILE.md` with its focused harness `scripts/test-s2c1-r.ts`.', '',
  );

  const report = `${lines.join('\n')}\n`;
  if (args.check) {
    if (!existsSync(REPORT_PATH)) throw new Error(`Missing generated report ${REPORT_PATH}`);
    const existing = readFileSync(REPORT_PATH, 'utf8');
    if (existing !== report) throw new Error(`${REPORT_PATH} differs from generated output`);
    console.log(`--check OK: ${path.relative(process.cwd(), REPORT_PATH)} byte-identical.`);
    return;
  }
  writeFileSync(REPORT_PATH, report);
  console.log(`Wrote ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
