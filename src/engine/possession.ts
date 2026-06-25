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
import { buildContext, clockUsageMultiplier, threePointBias, shouldIntentionalFoul } from './tactics';
import { rimProtection, defensivePressure, shouldDoubleTeam } from './defense';
import { computeSpacing } from './spacing';
import { PLAY_TYPE_ASSIST_RATE, POINTS_BY_ZONE, BASE_POSSESSION_TIME_MIN, BASE_POSSESSION_TIME_MAX, TRANSITION_POSSESSION_TIME_MIN, TRANSITION_POSSESSION_TIME_MAX, NON_SHOOTING_FOUL_RATE, TEAM_FOUL_BONUS_THRESHOLD, SPACING_OPENNESS_COEF } from './constants';

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
  shootingForm: Map<string, number>; // per-game hot/cold shooting modifier
  teamFouls: { home: number[]; away: number[] }; // per-quarter fouls
  playByPlay: PlayByPlayEvent[];
  rng: SeededRNG;
  previousPossessionTurnover: boolean;
  previousPossessionLongRebound: boolean;
  homeMomentum: number; // live hot/cold swing, decays each possession
  awayMomentum: number;
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
  defensiveSystem: DefensiveSystem,
): PossessionResult {
  const isHome = state.possessionTeamId === state.homeTeamId;
  const offLineup = isHome ? state.homeLineup : state.awayLineup;
  const defLineup = isHome ? state.awayLineup : state.homeLineup;

  const offPlayers = offLineup.map((id) => allPlayers.get(id)!).filter(Boolean);
  const defPlayers = defLineup.map((id) => allPlayers.get(id)!).filter(Boolean);

  if (offPlayers.length === 0 || defPlayers.length === 0) {
    return { state, switchPossession: true, isDeadBall: true };
  }

  // Game-state awareness + team defensive behavior for this possession.
  const scoreDiff = isHome
    ? state.homeScore - state.awayScore
    : state.awayScore - state.homeScore;
  const ctx = buildContext(state.clock, scoreDiff);
  const pressure = defensivePressure(defensiveSystem);
  const rimDeterrence = rimProtection(defPlayers, state.fatigue);
  const offMomentum = isHome ? state.homeMomentum : state.awayMomentum;

  // Intentional foul: the trailing defense fouls late to stop the clock and get
  // the ball back, sending the ball handler to the line.
  if (shouldIntentionalFoul(-scoreDiff, ctx.secondsLeft)) {
    const clock = advanceClock(state.clock, state.rng.nextInt(2, 4));
    const fouled = offPlayers[0];
    const fouler = defPlayers[state.rng.nextInt(0, defPlayers.length - 1)];
    const ft = resolveFreeThrows(fouled, state.fatigue.get(fouled.id) ?? 0, 2, state.rng);
    const desc = `Intentional foul on ${fouled.firstName} ${fouled.lastName}. FT: ${ft.made}/${ft.attempted}`;
    const event = createEvent(state, clock, 'isolation', fouled, 'foul', desc);
    event.foulPlayerId = fouler.id;
    event.freeThrowsMade = ft.made;
    event.freeThrowsAttempted = ft.attempted;
    event.points = ft.made;
    const ns = updateState(state, clock, event);
    addScore(ns, isHome, ft.made);
    addFoulStat(ns, fouler.id);
    addFreeThrowStats(ns, fouled.id, ft.made, ft.attempted);
    addTeamFoul(ns, !isHome, state.clock.quarter);
    ns.previousPossessionTurnover = false;
    ns.previousPossessionLongRebound = false;
    return { state: ns, switchPossession: true, isDeadBall: true };
  }

  // Non-shooting defensive foul (reach-in, off-ball, loose ball). Once the
  // defense is in the penalty it sends the offense to the line for two; before
  // that it just adds to the team-foul count and the offense keeps the ball.
  const defQIdx = Math.min(state.clock.quarter - 1, 3);
  const defFoulsBefore = isHome ? state.teamFouls.away[defQIdx] : state.teamFouls.home[defQIdx];
  if (state.rng.nextBool(NON_SHOOTING_FOUL_RATE)) {
    const clock = advanceClock(state.clock, state.rng.nextInt(2, 5));
    const fouler = defPlayers[state.rng.nextInt(0, defPlayers.length - 1)];
    const inPenalty = defFoulsBefore + 1 >= TEAM_FOUL_BONUS_THRESHOLD;

    if (inPenalty) {
      const fouled = offPlayers[0];
      const ft = resolveFreeThrows(fouled, state.fatigue.get(fouled.id) ?? 0, 2, state.rng);
      const desc = `Penalty foul on ${fouler.lastName}, ${fouled.firstName} ${fouled.lastName} to the line. FT: ${ft.made}/${ft.attempted}`;
      const event = createEvent(state, clock, 'isolation', fouled, 'foul', desc);
      event.foulPlayerId = fouler.id;
      event.freeThrowsMade = ft.made;
      event.freeThrowsAttempted = ft.attempted;
      event.points = ft.made;
      const ns = updateState(state, clock, event);
      addScore(ns, isHome, ft.made);
      addFoulStat(ns, fouler.id);
      addFreeThrowStats(ns, fouled.id, ft.made, ft.attempted);
      addTeamFoul(ns, !isHome, state.clock.quarter);
      ns.previousPossessionTurnover = false;
      ns.previousPossessionLongRebound = false;
      return { state: ns, switchPossession: true, isDeadBall: true };
    }

    const event = createEvent(state, clock, 'isolation', offPlayers[0], 'foul',
      `Loose-ball foul on ${fouler.firstName} ${fouler.lastName}`);
    event.foulPlayerId = fouler.id;
    const ns = updateState(state, clock, event);
    addFoulStat(ns, fouler.id);
    addTeamFoul(ns, !isHome, state.clock.quarter);
    ns.previousPossessionTurnover = false;
    ns.previousPossessionLongRebound = false;
    return { state: ns, switchPossession: false, isDeadBall: true };
  }

  // Check for transition opportunity
  const isTransition = checkTransitionOpportunity(
    offPlayers,
    state.previousPossessionTurnover,
    state.previousPossessionLongRebound,
    state.rng,
  );

  const playType = selectPlayType(
    offPlayers[0], // PG or first in lineup
    offensiveSystem,
    { scoreDiff, gameClock: state.clock.gameClock, quarter: state.clock.quarter },
    isTransition,
    state.rng,
  );

  // Determine possession time, then stretch/shrink it for clock management.
  // Cap at the shot clock remaining — after an offensive rebound only 14s are
  // left, so a possession can't run the full 24 (which would otherwise produce
  // a flood of phantom shot-clock violations).
  const baseTime = isTransition
    ? state.rng.nextInt(TRANSITION_POSSESSION_TIME_MIN, TRANSITION_POSSESSION_TIME_MAX)
    : state.rng.nextInt(BASE_POSSESSION_TIME_MIN, BASE_POSSESSION_TIME_MAX);
  const stretched = Math.round(baseTime * clockUsageMultiplier(ctx));
  const possTime = Math.max(1, Math.min(state.clock.shotClock - 1, stretched));

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
  const defender = selectDefender(defPlayers, primaryPlayer, state.rng, playType);
  const primaryFatigue = state.fatigue.get(primaryPlayer.id) ?? 0;
  const defFatigue = state.fatigue.get(defender.id) ?? 0;

  // Lineup spacing from the four OFF-BALL players (everyone except the finisher,
  // who is already fixed here). Centered on a league-average off-ball four, so
  // an average lineup nets zero. offPlayers is iterated in lineup order with the
  // finisher filtered out — deterministic, no RNG.
  const offBallFour = offPlayers.filter((p) => p.id !== primaryPlayer.id);
  const spacing = computeSpacing(offBallFour);

  // The defense may send a second man at an elite scorer.
  const doubleTeamed = (playType === 'isolation' || playType === 'post_up' || playType === 'pick_and_roll')
    && shouldDoubleTeam(primaryPlayer, defensiveSystem, state.rng);

  // Turnover check (defensive pressure + the chaos of a double-team add risk)
  const turnoverResult = checkTurnover(
    primaryPlayer, primaryFatigue, defPlayers,
    state.fatigue, playType, state.rng,
    pressure.stealMult * (doubleTeamed ? 1.3 : 1),
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

  // Shot attempt — shaped by rim protection, late-game three-point chasing, and
  // lineup spacing (good spacing opens the rim, mid-range donates, threes flat-
  // to-up).
  const shotZone = selectShotZone(primaryPlayer, playType, state.rng, {
    threePointBias: threePointBias(ctx),
    rimDeterrence,
    spacing,
  });
  // More spacing → the on-ball defender gets less help → a softer contest,
  // routed through the existing contest/contestBonus path as a centered
  // subtraction from the effective pressure bonus. Poor spacing → tougher.
  const spacingPressureBonus = pressure.contestBonus - SPACING_OPENNESS_COEF * spacing;
  const shotResult = resolveShot(
    primaryPlayer, primaryFatigue,
    defender, defFatigue,
    shotZone, playType, state.rng,
    state.shootingForm.get(primaryPlayer.id) ?? 0,
    {
      pressureBonus: spacingPressureBonus,
      foulMult: pressure.foulMult,
      doubleTeamed,
      momentum: offMomentum,
    },
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
    if (rebResult.rebounder) {
      addReboundStat(updatedState, rebResult.rebounder.id, rebResult.type);
      event.reboundPlayerId = rebResult.rebounder.id;
    }
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

    // Check for assist. A double-team forces a kick-out, so the shot is more
    // likely to be set up by a teammate.
    const assistChance = Math.min(0.97, PLAY_TYPE_ASSIST_RATE[playType] * (doubleTeamed ? 1.4 : 1));
    const initiator = offPlayers[0];
    let assister: Player | undefined;
    if (state.rng.nextBool(assistChance)) {
      const otherPlayers = offPlayers.filter((p) => p.id !== primaryPlayer.id);
      if (otherPlayers.length > 0) {
        // Weight strongly toward the best distributor on the floor, and credit
        // the player who actually ran the action (the on-ball initiator) — so
        // the pass that created the shot is recorded the way it happens in real
        // life. Squaring the skill term lets lead guards and point-centers rack
        // up double-digit assists instead of the floor spreading them evenly.
        const assistWeights = otherPlayers.map((p) => {
          const skill = p.ratings.passing + p.ratings.offensiveIQ * 0.3;
          const tendency = 1 + p.tendencies.assistRate * 3;
          const initiatorBonus = p.id === initiator.id ? 2.4 : 1;
          return Math.max(1, Math.pow(skill, 2.6) * tendency * initiatorBonus);
        });
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
  if (rebResult.rebounder) {
    addReboundStat(updatedState, rebResult.rebounder.id, rebResult.type);
    event.reboundPlayerId = rebResult.rebounder.id;
    event.description += `. ${rebResult.rebounder.firstName} ${rebResult.rebounder.lastName} ${rebResult.type} rebound`;
  } else {
    event.description += `. Team rebound (${rebResult.type})`;
  }
  event.reboundType = rebResult.type;

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
