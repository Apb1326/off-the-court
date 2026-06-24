import { Player } from '@/models/player';
import { PlayByPlayEvent, PossessionOutcome, PlayType, ShotZone } from '@/models/game';
import { OffensiveSystem, DefensiveSystem } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import { ClockState, advanceClock, resetShotClock, isShotClockViolation } from './clock';
import { accumulateFatigue } from './fatigue';
import { resolveShot, resolveFreeThrows } from './shot';
import { selectPlayType, selectShotZone, selectPrimaryPlayer, selectDefender, checkTransitionOpportunity } from './play-types';
import { resolveRebound } from './rebound';
import { checkTurnover } from './turnover';
import { PLAY_TYPE_ASSIST_RATE, POINTS_BY_ZONE, BASE_POSSESSION_TIME_MIN, BASE_POSSESSION_TIME_MAX, TRANSITION_POSSESSION_TIME_MIN, TRANSITION_POSSESSION_TIME_MAX } from './constants';

export interface GameState {
  clock: ClockState;
  possessionTeamId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeLineup: string[];
  awayLineup: string[];
  homeScore: number;
  awayScore: number;
  fatigue: Map<string, number>;
  fouls: Map<string, number>;
  teamFouls: { home: number[]; away: number[] }; // per-quarter fouls
  playByPlay: PlayByPlayEvent[];
  rng: SeededRNG;
  previousPossessionTurnover: boolean;
  previousPossessionLongRebound: boolean;
}

export interface PossessionResult {
  state: GameState;
  switchPossession: boolean;
  isDeadBall: boolean;
}

export function simulatePossession(
  state: GameState,
  allPlayers: Map<string, Player>,
  offensiveSystem: OffensiveSystem,
  _defensiveSystem: DefensiveSystem,
): PossessionResult {
  const isHome = state.possessionTeamId === state.homeTeamId;
  const offLineup = isHome ? state.homeLineup : state.awayLineup;
  const defLineup = isHome ? state.awayLineup : state.homeLineup;

  const offPlayers = offLineup.map((id) => allPlayers.get(id)!).filter(Boolean);
  const defPlayers = defLineup.map((id) => allPlayers.get(id)!).filter(Boolean);

  if (offPlayers.length === 0 || defPlayers.length === 0) {
    return { state, switchPossession: true, isDeadBall: true };
  }

  // Check for transition opportunity
  const isTransition = checkTransitionOpportunity(
    offPlayers,
    state.previousPossessionTurnover,
    state.previousPossessionLongRebound,
    state.rng,
  );

  // Select play type
  const scoreDiff = isHome
    ? state.homeScore - state.awayScore
    : state.awayScore - state.homeScore;

  const playType = selectPlayType(
    offPlayers[0], // PG or first in lineup
    offensiveSystem,
    { scoreDiff, gameClock: state.clock.gameClock, quarter: state.clock.quarter },
    isTransition,
    state.rng,
  );

  // Determine possession time
  const possTime = isTransition
    ? state.rng.nextInt(TRANSITION_POSSESSION_TIME_MIN, TRANSITION_POSSESSION_TIME_MAX)
    : state.rng.nextInt(BASE_POSSESSION_TIME_MIN, BASE_POSSESSION_TIME_MAX);

  // Advance clock
  const newClock = advanceClock(state.clock, possTime);

  // Check shot clock violation
  if (isShotClockViolation(newClock) && newClock.gameClock > 0) {
    const event = createEvent(state, newClock, playType, offPlayers[0], 'turnover',
      `Shot clock violation by ${offPlayers[0].firstName} ${offPlayers[0].lastName}`);
    event.turnoverType = 'shot_clock_violation';

    const newState = updateState(state, newClock, event);
    return { state: newState, switchPossession: true, isDeadBall: true };
  }

  // Select primary player and defender
  const primaryPlayer = selectPrimaryPlayer(offPlayers, playType, state.rng);
  const defender = selectDefender(defPlayers, primaryPlayer, state.rng);
  const primaryFatigue = state.fatigue.get(primaryPlayer.id) ?? 0;
  const defFatigue = state.fatigue.get(defender.id) ?? 0;

  // Turnover check
  const turnoverResult = checkTurnover(
    primaryPlayer, primaryFatigue, defPlayers,
    state.fatigue, playType, state.rng,
  );

  if (turnoverResult.occurred) {
    let desc = `${primaryPlayer.firstName} ${primaryPlayer.lastName} turnover (${turnoverResult.type})`;
    if (turnoverResult.stealBy) {
      desc = `${turnoverResult.stealBy.firstName} ${turnoverResult.stealBy.lastName} steals from ${primaryPlayer.firstName} ${primaryPlayer.lastName}`;
    }

    const event = createEvent(state, newClock, playType, primaryPlayer, 'turnover', desc);
    event.turnoverType = turnoverResult.type;
    if (turnoverResult.stealBy) {
      event.stealPlayerId = turnoverResult.stealBy.id;
    }

    const newState = updateState(state, newClock, event);
    addTurnoverStats(newState, primaryPlayer.id, turnoverResult.stealBy?.id);
    newState.previousPossessionTurnover = true;
    newState.previousPossessionLongRebound = false;

    return { state: newState, switchPossession: true, isDeadBall: false };
  }

  // Shot attempt
  const shotZone = selectShotZone(primaryPlayer, playType, state.rng);
  const shotResult = resolveShot(
    primaryPlayer, primaryFatigue,
    defender, defFatigue,
    shotZone, playType, state.rng,
  );

  // Record FGA
  const newState: GameState = { ...state, clock: newClock };

  if (shotResult.blocked) {
    const desc = `${primaryPlayer.firstName} ${primaryPlayer.lastName}'s shot blocked by ${defender.firstName} ${defender.lastName}`;
    const event = createEvent(state, newClock, playType, primaryPlayer, 'missed_shot', desc);
    event.shotZone = shotZone;
    event.shotMade = false;
    event.blockPlayerId = defender.id;

    const updatedState = updateState(newState, newClock, event);
    addShotStats(updatedState, primaryPlayer.id, shotZone, false, false);
    addBlockStat(updatedState, defender.id);

    // Rebound
    const rebResult = resolveRebound(offPlayers, defPlayers, state.fatigue, state.fatigue, state.rng);
    addReboundStat(updatedState, rebResult.rebounder.id, rebResult.type);
    event.reboundPlayerId = rebResult.rebounder.id;
    event.reboundType = rebResult.type;

    updatedState.previousPossessionTurnover = false;
    updatedState.previousPossessionLongRebound = rebResult.type === 'defensive';

    if (rebResult.type === 'offensive') {
      updatedState.clock = resetShotClock(updatedState.clock, false);
      return { state: updatedState, switchPossession: false, isDeadBall: false };
    }
    return { state: updatedState, switchPossession: true, isDeadBall: false };
  }

  if (shotResult.fouled && !shotResult.made) {
    // Shooting foul, missed shot
    const ftAttempts = POINTS_BY_ZONE[shotZone] === 3 ? 3 : 2;
    const ftResult = resolveFreeThrows(primaryPlayer, primaryFatigue, ftAttempts, state.rng);

    const desc = `${primaryPlayer.firstName} ${primaryPlayer.lastName} fouled on ${shotZone === 'rim' ? 'drive' : 'jumper'} by ${defender.firstName} ${defender.lastName}. FT: ${ftResult.made}/${ftResult.attempted}`;
    const event = createEvent(state, newClock, playType, primaryPlayer, 'foul', desc);
    event.shotZone = shotZone;
    event.foulPlayerId = defender.id;
    event.freeThrowsMade = ftResult.made;
    event.freeThrowsAttempted = ftResult.attempted;
    event.points = ftResult.made;

    const updatedState = updateState(newState, newClock, event);
    addScore(updatedState, isHome, ftResult.made);
    addFoulStat(updatedState, defender.id);
    addFreeThrowStats(updatedState, primaryPlayer.id, ftResult.made, ftResult.attempted);
    addTeamFoul(updatedState, !isHome, state.clock.quarter);

    updatedState.previousPossessionTurnover = false;
    updatedState.previousPossessionLongRebound = false;

    return { state: updatedState, switchPossession: true, isDeadBall: true };
  }

  if (shotResult.made) {
    let totalPoints = shotResult.points;
    let desc = `${primaryPlayer.firstName} ${primaryPlayer.lastName} makes ${describeShotZone(shotZone)}`;

    // Check for assist
    const assistChance = PLAY_TYPE_ASSIST_RATE[playType];
    let assister: Player | undefined;
    if (state.rng.nextBool(assistChance)) {
      const otherPlayers = offPlayers.filter((p) => p.id !== primaryPlayer.id);
      if (otherPlayers.length > 0) {
        const assistWeights = otherPlayers.map((p) => Math.max(1, p.ratings.passing));
        assister = state.rng.weightedChoice(otherPlayers, assistWeights);
        desc += ` (assist: ${assister.firstName} ${assister.lastName})`;
      }
    }

    const event = createEvent(state, newClock, playType, primaryPlayer,
      shotResult.fouled ? 'and_one' : 'made_shot', desc);
    event.shotZone = shotZone;
    event.shotMade = true;
    event.points = shotResult.points;
    if (assister) event.assistPlayerId = assister.id;

    const updatedState = updateState(newState, newClock, event);
    addShotStats(updatedState, primaryPlayer.id, shotZone, true, false);
    addScore(updatedState, isHome, shotResult.points);
    if (assister) addAssistStat(updatedState, assister.id);

    // And-one
    if (shotResult.fouled) {
      const ftResult = resolveFreeThrows(primaryPlayer, primaryFatigue, 1, state.rng);
      addFreeThrowStats(updatedState, primaryPlayer.id, ftResult.made, ftResult.attempted);
      addFoulStat(updatedState, defender.id);
      addTeamFoul(updatedState, !isHome, state.clock.quarter);
      addScore(updatedState, isHome, ftResult.made);
      totalPoints += ftResult.made;
      event.foulPlayerId = defender.id;
      event.freeThrowsMade = ftResult.made;
      event.freeThrowsAttempted = ftResult.attempted;
      event.points = totalPoints;
    }

    updatedState.previousPossessionTurnover = false;
    updatedState.previousPossessionLongRebound = false;

    return { state: updatedState, switchPossession: true, isDeadBall: shotResult.fouled };
  }

  // Missed shot
  const desc = `${primaryPlayer.firstName} ${primaryPlayer.lastName} misses ${describeShotZone(shotZone)}`;
  const event = createEvent(state, newClock, playType, primaryPlayer, 'missed_shot', desc);
  event.shotZone = shotZone;
  event.shotMade = false;

  const updatedState = updateState(newState, newClock, event);
  addShotStats(updatedState, primaryPlayer.id, shotZone, false, false);

  // Rebound
  const rebResult = resolveRebound(offPlayers, defPlayers, state.fatigue, state.fatigue, state.rng);
  addReboundStat(updatedState, rebResult.rebounder.id, rebResult.type);
  event.reboundPlayerId = rebResult.rebounder.id;
  event.reboundType = rebResult.type;
  event.description += `. ${rebResult.rebounder.firstName} ${rebResult.rebounder.lastName} ${rebResult.type} rebound`;

  updatedState.previousPossessionTurnover = false;
  updatedState.previousPossessionLongRebound = rebResult.type === 'defensive';

  if (rebResult.type === 'offensive') {
    updatedState.clock = resetShotClock(updatedState.clock, false);
    return { state: updatedState, switchPossession: false, isDeadBall: false };
  }
  return { state: updatedState, switchPossession: true, isDeadBall: false };
}

// Helper functions for updating game state

function createEvent(
  state: GameState,
  clock: ClockState,
  playType: PlayType,
  primaryPlayer: Player,
  outcome: PossessionOutcome,
  description: string,
): PlayByPlayEvent {
  return {
    quarter: clock.quarter,
    gameClock: Math.max(0, clock.gameClock),
    shotClock: Math.max(0, clock.shotClock),
    possessionTeamId: state.possessionTeamId,
    type: playType,
    primaryPlayerId: primaryPlayer.id,
    outcome,
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    description,
  };
}

function updateState(state: GameState, clock: ClockState, event: PlayByPlayEvent): GameState {
  const newState = { ...state, clock };

  // Update fatigue for all on-court players
  const allOnCourt = [...state.homeLineup, ...state.awayLineup];
  const newFatigue = new Map(state.fatigue);
  for (const id of allOnCourt) {
    // Fatigue is updated in the main game loop
  }
  newState.fatigue = newFatigue;
  newState.playByPlay = [...state.playByPlay, event];

  return newState;
}

function addScore(state: GameState, isHome: boolean, points: number): void {
  if (isHome) {
    state.homeScore += points;
  } else {
    state.awayScore += points;
  }
  // Update the last event's scores
  const lastEvent = state.playByPlay[state.playByPlay.length - 1];
  if (lastEvent) {
    lastEvent.homeScore = state.homeScore;
    lastEvent.awayScore = state.awayScore;
  }
}

function addTeamFoul(state: GameState, isHome: boolean, quarter: number): void {
  const idx = Math.min(quarter - 1, 3);
  if (isHome) {
    state.teamFouls.home[idx] = (state.teamFouls.home[idx] ?? 0) + 1;
  } else {
    state.teamFouls.away[idx] = (state.teamFouls.away[idx] ?? 0) + 1;
  }
}

// Stat tracking stubs - these modify the stats accumulator in the main game loop
function addShotStats(_state: GameState, _playerId: string, _zone: ShotZone, _made: boolean, _assisted: boolean): void {}
function addBlockStat(_state: GameState, _playerId: string): void {}
function addReboundStat(_state: GameState, _playerId: string, _type: 'offensive' | 'defensive'): void {}
function addTurnoverStats(_state: GameState, _playerId: string, _stealById?: string): void {}
function addFoulStat(_state: GameState, _playerId: string): void {}
function addFreeThrowStats(_state: GameState, _playerId: string, _made: number, _attempted: number): void {}
function addAssistStat(_state: GameState, _playerId: string): void {}

function describeShotZone(zone: ShotZone): string {
  switch (zone) {
    case 'rim': return 'layup at the rim';
    case 'short_midrange': return 'short mid-range jumper';
    case 'long_midrange': return 'long mid-range jumper';
    case 'corner_three': return 'corner three';
    case 'above_break_three': return 'three-pointer';
    case 'deep_three': return 'deep three-pointer';
  }
}
