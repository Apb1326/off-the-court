import { Player } from '@/models/player';
import { Team } from '@/models/team';
import { Game, GameResult, BoxScore, PlayByPlayEvent, ShotZone } from '@/models/game';
import { SeededRNG } from '@/lib/rng';
import { ClockState, initClock, isEndOfPeriod, nextPeriod, isRegulationOver, resetShotClock } from './clock';
import { accumulateFatigue, recoverFatigue } from './fatigue';
import { GameState, simulatePossession } from './possession';
import { checkSubstitutions } from './substitution';
import { StatsAccumulator } from './stats-accumulator';
import { POINTS_BY_ZONE } from './constants';

export interface SimulationResult {
  game: Game;
  result: GameResult;
  boxScore: BoxScore;
  playByPlay: PlayByPlayEvent[];
}

export function simulateGame(
  homeTeam: Team,
  awayTeam: Team,
  homePlayers: Player[],
  awayPlayers: Player[],
  gameId: string,
  seasonId: string,
  date: string,
  seed?: number,
): SimulationResult {
  const rng = new SeededRNG(seed ?? Date.now());
  const stats = new StatsAccumulator();

  const playerMap = new Map<string, Player>();
  for (const p of [...homePlayers, ...awayPlayers]) {
    playerMap.set(p.id, p);
  }

  // Initialize lineups
  const homeLineup = homeTeam.rotation.starters.slice() as string[];
  const awayLineup = awayTeam.rotation.starters.slice() as string[];

  const homeBench = homePlayers
    .filter((p) => !homeLineup.includes(p.id))
    .map((p) => p.id);
  const awayBench = awayPlayers
    .filter((p) => !awayLineup.includes(p.id))
    .map((p) => p.id);

  // Initialize stats
  for (const p of homePlayers) {
    stats.initPlayer(p.id, homeTeam.id, homeLineup.includes(p.id));
  }
  for (const p of awayPlayers) {
    stats.initPlayer(p.id, awayTeam.id, awayLineup.includes(p.id));
  }

  // Initialize fatigue and fouls
  const fatigue = new Map<string, number>();
  const fouls = new Map<string, number>();
  for (const p of [...homePlayers, ...awayPlayers]) {
    fatigue.set(p.id, 0);
    fouls.set(p.id, 0);
  }

  // Per-game shooting form: each player gets a "hot/cold" night drawn from a
  // normal distribution. The ~90 shot attempts per team already carry a lot of
  // binomial variance on their own, so this only needs a light touch — real NBA
  // team-scoring SD (~12 pts) is close to that shot-noise floor. Calibrated
  // against six decades of real games (see scripts/calibrate-history.ts): too
  // much form here produces unrealistic blowouts.
  // The home team gets a small constant edge (home-court advantage).
  const shootingForm = new Map<string, number>();
  const assignForm = (p: Player, homeEdge: number) => {
    const consistency = p.ratings.offensiveIQ / 80; // steadier players vary less
    const sd = 0.030 - consistency * 0.012; // ~0.018 (stars) to ~0.030 (role players)
    shootingForm.set(p.id, clampForm(rng.nextGaussian() * sd + homeEdge));
  };
  for (const p of homePlayers) assignForm(p, HOME_COURT_FORM_EDGE);
  for (const p of awayPlayers) assignForm(p, 0);

  // Record initial entry for plus/minus
  for (const id of [...homeLineup, ...awayLineup]) {
    stats.recordEntry(id, 0, 0);
  }

  // Track bench time for fatigue recovery
  const lastSubTime = new Map<string, number>();
  for (const id of [...homeBench, ...awayBench]) {
    lastSubTime.set(id, 0);
  }

  let gameState: GameState = {
    clock: initClock(),
    possessionTeamId: determineFirstPossession(homePlayers, awayPlayers, rng),
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeLineup,
    awayLineup,
    homeScore: 0,
    awayScore: 0,
    fatigue,
    fouls,
    shootingForm,
    teamFouls: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
    playByPlay: [],
    rng,
    previousPossessionTurnover: false,
    previousPossessionLongRebound: false,
    homeMomentum: 0,
    awayMomentum: 0,
  };

  let totalGameSeconds = 0;
  let lastClockValue = gameState.clock.gameClock;

  // Main game loop
  while (true) {
    // Simulate one possession
    const isHome = gameState.possessionTeamId === homeTeam.id;
    const offSystem = isHome ? homeTeam.offensiveSystem : awayTeam.offensiveSystem;
    const defSystem = isHome ? awayTeam.defensiveSystem : homeTeam.defensiveSystem;

    const result = simulatePossession(gameState, playerMap, offSystem, defSystem);
    gameState = result.state;

    // Track elapsed time
    const elapsed = lastClockValue - gameState.clock.gameClock;
    if (elapsed > 0) {
      totalGameSeconds += elapsed;

      // Add minutes to on-court players
      const minutesElapsed = elapsed / 60;
      for (const id of [...gameState.homeLineup, ...gameState.awayLineup]) {
        stats.addMinutes(id, minutesElapsed);
      }

      // Recover bench fatigue
      for (const id of [...homeBench, ...awayBench]) {
        const current = gameState.fatigue.get(id) ?? 0;
        gameState.fatigue.set(id, recoverFatigue(current, minutesElapsed));
      }

      // Accumulate on-court fatigue
      for (const id of [...gameState.homeLineup, ...gameState.awayLineup]) {
        const player = playerMap.get(id);
        if (player) {
          const current = gameState.fatigue.get(id) ?? 0;
          gameState.fatigue.set(id, accumulateFatigue(current, player));
        }
      }
    }
    lastClockValue = gameState.clock.gameClock;

    // Process stat events from play-by-play
    const lastEvent = gameState.playByPlay[gameState.playByPlay.length - 1];
    if (lastEvent) {
      updateMomentum(gameState, isHome, lastEvent);
      recordEventStats(stats, lastEvent);
    }

    // Substitutions on dead balls
    if (result.isDeadBall) {
      processSubstitutions(
        gameState, homeTeam, awayTeam, playerMap,
        homeBench, awayBench, stats, totalGameSeconds,
      );
    }

    // Switch possession and reset shot clock
    if (result.switchPossession) {
      gameState.possessionTeamId =
        gameState.possessionTeamId === homeTeam.id ? awayTeam.id : homeTeam.id;
      gameState.clock = resetShotClock(gameState.clock, true);
    }

    // Check end of period
    if (isEndOfPeriod(gameState.clock)) {
      // Record exit for plus/minus for all on-court players
      for (const id of [...gameState.homeLineup, ...gameState.awayLineup]) {
        stats.recordExit(id, gameState.homeScore, gameState.awayScore, homeTeam.id);
      }

      const next = nextPeriod(gameState.clock);
      if (!next) break;

      // Check if game is over (regulation or OT)
      if (isRegulationOver(next.quarter) && gameState.homeScore !== gameState.awayScore) {
        break;
      }

      // Start new period
      gameState.clock = next;
      lastClockValue = next.gameClock;

      // Reset team fouls for new quarter (regular quarters)
      if (next.quarter <= 4) {
        const idx = next.quarter - 1;
        gameState.teamFouls.home[idx] = 0;
        gameState.teamFouls.away[idx] = 0;
      }

      // Alternate possession each quarter
      gameState.possessionTeamId =
        next.quarter % 2 === 0 ? gameState.possessionTeamId :
        gameState.possessionTeamId === homeTeam.id ? awayTeam.id : homeTeam.id;

      // Record re-entry for plus/minus
      for (const id of [...gameState.homeLineup, ...gameState.awayLineup]) {
        stats.recordEntry(id, gameState.homeScore, gameState.awayScore);
      }
    }
  }

  // Build final results
  const overtimePeriods = Math.max(0, gameState.clock.quarter - 4);
  const gameResult: GameResult = {
    homeScore: gameState.homeScore,
    awayScore: gameState.awayScore,
    overtimePeriods,
    winnerId: gameState.homeScore > gameState.awayScore ? homeTeam.id : awayTeam.id,
  };

  const boxScore = stats.buildBoxScore(homeTeam.id, awayTeam.id);

  return {
    game: {
      id: gameId,
      seasonId,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      date,
      result: gameResult,
      boxScore,
      playByPlay: gameState.playByPlay,
    },
    result: gameResult,
    boxScore,
    playByPlay: gameState.playByPlay,
  };
}

// Home-court advantage, expressed as a small bump to the home team's shooting
// form. Tuned so the home team wins ~57-59% of games and outscores the road
// team by ~2.5-3 pts/game, matching the real 2010-2015 benchmark.
const HOME_COURT_FORM_EDGE = 0.018;

// Keep per-game form within a believable band (~±13%) so no single night turns
// a role player into an All-Star or vice versa.
function clampForm(form: number): number {
  return Math.max(-0.13, Math.min(0.13, form));
}

// Live momentum: a small, fast-decaying swing that builds when a team strings
// together scores and stops. Kept deliberately small — real team scoring is
// close to the shot-noise floor, so this adds feel without manufacturing runs.
const MOMENTUM_DECAY = 0.8;
const MOMENTUM_CAP = 0.02;

function updateMomentum(state: GameState, isHomeOffense: boolean, ev: PlayByPlayEvent): void {
  // Decay toward zero every possession.
  state.homeMomentum *= MOMENTUM_DECAY;
  state.awayMomentum *= MOMENTUM_DECAY;

  const offScored = ev.outcome === 'made_shot' || ev.outcome === 'and_one';
  const defStop = ev.outcome === 'turnover' ||
    (ev.outcome === 'missed_shot' && ev.reboundType === 'defensive');

  let offDelta = 0;
  let defDelta = 0;
  if (offScored) { offDelta = 0.006; defDelta = -0.003; }
  else if (defStop) { offDelta = -0.003; defDelta = 0.004; }

  const clamp = (v: number) => Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, v));
  if (isHomeOffense) {
    state.homeMomentum = clamp(state.homeMomentum + offDelta);
    state.awayMomentum = clamp(state.awayMomentum + defDelta);
  } else {
    state.awayMomentum = clamp(state.awayMomentum + offDelta);
    state.homeMomentum = clamp(state.homeMomentum + defDelta);
  }
}

function determineFirstPossession(
  homePlayers: Player[],
  awayPlayers: Player[],
  rng: SeededRNG,
): string {
  const homeCenter = homePlayers.find((p) => p.position === 'C') ?? homePlayers[0];
  const awayCenter = awayPlayers.find((p) => p.position === 'C') ?? awayPlayers[0];

  if (!homeCenter || !awayCenter) return homePlayers[0]?.teamId ?? 'home';

  const homeJump = homeCenter.ratings.athleticism + homeCenter.ratings.strength;
  const awayJump = awayCenter.ratings.athleticism + awayCenter.ratings.strength;
  const homeChance = homeJump / (homeJump + awayJump);

  return rng.nextBool(homeChance) ? homeCenter.teamId : awayCenter.teamId;
}

function processSubstitutions(
  state: GameState,
  homeTeam: Team,
  awayTeam: Team,
  playerMap: Map<string, Player>,
  homeBench: string[],
  awayBench: string[],
  stats: StatsAccumulator,
  _gameSeconds: number,
): void {
  const margin = Math.abs(state.homeScore - state.awayScore);

  // Home subs
  const homeSubs = checkSubstitutions(
    state.homeLineup, homeBench, playerMap,
    state.fatigue, state.fouls, homeTeam.rotation,
    state.clock.quarter, state.clock.gameClock, true, margin,
  );
  for (const sub of homeSubs) {
    stats.recordExit(sub.playerOut, state.homeScore, state.awayScore, state.homeTeamId);
    const idx = state.homeLineup.indexOf(sub.playerOut);
    if (idx >= 0) {
      state.homeLineup[idx] = sub.playerIn;
      homeBench.push(sub.playerOut);
      const benchIdx = homeBench.indexOf(sub.playerIn);
      if (benchIdx >= 0) homeBench.splice(benchIdx, 1);
      stats.recordEntry(sub.playerIn, state.homeScore, state.awayScore);
    }
  }

  // Away subs
  const awaySubs = checkSubstitutions(
    state.awayLineup, awayBench, playerMap,
    state.fatigue, state.fouls, awayTeam.rotation,
    state.clock.quarter, state.clock.gameClock, true, margin,
  );
  for (const sub of awaySubs) {
    stats.recordExit(sub.playerOut, state.homeScore, state.awayScore, state.homeTeamId);
    const idx = state.awayLineup.indexOf(sub.playerOut);
    if (idx >= 0) {
      state.awayLineup[idx] = sub.playerIn;
      awayBench.push(sub.playerOut);
      const benchIdx = awayBench.indexOf(sub.playerIn);
      if (benchIdx >= 0) awayBench.splice(benchIdx, 1);
      stats.recordEntry(sub.playerIn, state.homeScore, state.awayScore);
    }
  }
}

function recordEventStats(stats: StatsAccumulator, event: PlayByPlayEvent): void {
  switch (event.outcome) {
    case 'made_shot':
    case 'and_one':
      if (event.shotZone) {
        stats.recordMadeShot(event.primaryPlayerId, event.shotZone);
      }
      if (event.assistPlayerId) {
        stats.recordAssist(event.assistPlayerId);
      }
      if (event.foulPlayerId) {
        stats.recordFoul(event.foulPlayerId);
      }
      if (event.freeThrowsAttempted) {
        stats.recordFreeThrows(event.primaryPlayerId, event.freeThrowsMade ?? 0, event.freeThrowsAttempted);
      }
      break;

    case 'missed_shot':
      if (event.shotZone) {
        stats.recordMissedShot(event.primaryPlayerId, event.shotZone);
      }
      if (event.blockPlayerId) {
        stats.recordBlock(event.blockPlayerId);
      }
      if (event.reboundPlayerId && event.reboundType) {
        stats.recordRebound(event.reboundPlayerId, event.reboundType);
      }
      break;

    case 'turnover':
      stats.recordTurnover(event.primaryPlayerId);
      if (event.stealPlayerId) {
        stats.recordSteal(event.stealPlayerId);
      }
      break;

    case 'foul':
      if (event.foulPlayerId) {
        stats.recordFoul(event.foulPlayerId);
      }
      if (event.freeThrowsAttempted) {
        stats.recordFreeThrows(event.primaryPlayerId, event.freeThrowsMade ?? 0, event.freeThrowsAttempted);
      }
      break;
  }
}
