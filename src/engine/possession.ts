import { Player } from '@/models/player';
import { PlayByPlayEvent, PossessionOutcome, PlayType, ShotZone, TurnoverType } from '@/models/game';
import { OffensiveSystem, DefensiveSystem } from '@/models/team';
import { SeededRNG } from '@/lib/rng';
import { ClockState, advanceClock, resetShotClock, isShotClockViolation } from './clock';
import { accumulateFatigue, getEffectiveRating } from './fatigue';
import { resolveShot, resolveFreeThrows } from './shot';
import { selectPlayType, selectShotZone, selectPrimaryPlayer, selectDefender, checkTransitionOpportunity } from './play-types';
import { resolveRebound } from './rebound';
import { checkTurnover } from './turnover';
import { buildContext, clockUsageMultiplier, threePointBias, shouldIntentionalFoul } from './tactics';
import { rimProtection, defensivePressure, shouldDoubleTeam } from './defense';
import { computeSpacing, openManWeight } from './spacing';
import {
  POINTS_BY_ZONE, BASE_POSSESSION_TIME_MIN, BASE_POSSESSION_TIME_MAX,
  TRANSITION_POSSESSION_TIME_MIN, TRANSITION_POSSESSION_TIME_MAX,
  NON_SHOOTING_FOUL_RATE, TEAM_FOUL_BONUS_THRESHOLD, SPACING_OPENNESS_COEF,
  MAX_EXTRA_PASSES, PLAY_TYPE_PASS_RATE, PASS_PROB_PASSING_COEF, PASS_PROB_SPACING_COEF,
  PASS_PROB_PRESSURE_COEF, DOUBLE_TEAM_PASS_PROB, PASS_TIME_MIN, PASS_TIME_MAX, MIN_CREATE_TIME,
  PASS_TURNOVER_BASE, PASS_TURNOVER_SKILL_COEF, PASS_TURNOVER_STEAL_COEF, PASS_TURNOVER_DT_MULT,
  PASS_TURNOVER_MIN, PASS_TURNOVER_MAX, ADVANTAGE_DRIVE_PROB, ADVANTAGE_NONDRIVE_PROB,
  ADVANTAGE_CREATE_PROB, ADVANTAGE_PERSIST_PROB, ADVANTAGE_SHOT_BONUS, ADVANTAGE_BONUS_DIMINISH,
  ADVANTAGE_BONUS_CEIL, SHOT_CLOCK_PRESSURE_THRESHOLD, SHOT_CLOCK_RUSH_PENALTY,
  SPACING_ADVANTAGE_COEF, SPACING_ADVANTAGE_MIN, SPACING_ADVANTAGE_MAX,
} from './constants';

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

  // --- Ball-movement chain --------------------------------------------------
  // The possession can now DEVELOP. The initial action above creates (or fails
  // to create) an advantage; if it does, the offense relocates the ball to a
  // teammate to exploit it before the defense recovers. Quality is keyed to the
  // ADVANTAGE STATE, never the raw pass count: a pass that cashes a live
  // advantage (kick-out off a double-team, drive-and-kick off a collapsed
  // defense) earns a bonus with diminishing returns and a hard ceiling; a
  // no-advantage reset/swing earns nothing but still costs clock and carries
  // bad-pass risk. Hard bound: initial + up to MAX_EXTRA_PASSES actions.
  let finisher = primaryPlayer;
  let finisherDefender = defender;
  let finisherFatigue = primaryFatigue;
  let finisherDefFatigue = defFatigue;
  let finisherPlayType = playType;
  let finisherDoubled = doubleTeamed;
  let assister: Player | undefined; // the player who threw the pass into the shot
  let advantageBonus = 0;           // accumulated, advantage-driven shot-quality bonus
  let passSeconds = 0;              // shot-clock burned by the extra passes

  // A double-team is two-on-the-ball, so it IS a live advantage; otherwise a real
  // drive (rim pressure that collapses the help) creates one more often than a
  // stationary action.
  let advantageActive = doubleTeamed;
  if (!advantageActive) {
    const driveType = playType === 'isolation' || playType === 'pick_and_roll'
      || playType === 'post_up' || playType === 'cut' || playType === 'transition';
    advantageActive = state.rng.nextBool(driveType ? ADVANTAGE_DRIVE_PROB : ADVANTAGE_NONDRIVE_PROB);
  }

  for (let pass = 0; pass < MAX_EXTRA_PASSES; pass++) {
    const candidates = offPlayers.filter((p) => p.id !== finisher.id);
    if (candidates.length === 0) break;

    // Pass probability: passing/IQ, spacing (open lanes), and a pressured/doubled
    // primary giving it up, all CENTERED on the play-type base. A double-team on
    // the FIRST decision almost always forces the kick-out.
    let passProb: number;
    if (pass === 0 && doubleTeamed) {
      passProb = DOUBLE_TEAM_PASS_PROB;
    } else {
      const skill = (finisher.ratings.passing + finisher.ratings.offensiveIQ) / 2 - 40;
      passProb = PLAY_TYPE_PASS_RATE[finisherPlayType]
        + PASS_PROB_PASSING_COEF * skill
        + PASS_PROB_SPACING_COEF * spacing
        + PASS_PROB_PRESSURE_COEF * pressure.contestBonus;
      passProb = Math.max(0.02, Math.min(0.97, passProb));
    }
    if (!state.rng.nextBool(passProb)) break;

    // Each extra pass burns a couple seconds of shot clock.
    passSeconds += state.rng.nextInt(PASS_TIME_MIN, PASS_TIME_MAX);

    // Bad-pass / steal risk on the pass itself — small, centered on passer skill
    // and the best defender's hands; a kick-out out of a double-team is riskier.
    const skillNorm = (finisher.ratings.passing + finisher.ratings.offensiveIQ) / 2 / 80;
    const stealer = bestStealer(defPlayers, state.fatigue);
    const stealNorm = getEffectiveRating(stealer.ratings.steal, state.fatigue.get(stealer.id) ?? 0) / 80;
    let toRisk = PASS_TURNOVER_BASE
      - PASS_TURNOVER_SKILL_COEF * (skillNorm - 0.5)
      + PASS_TURNOVER_STEAL_COEF * (stealNorm - 0.5);
    if (pass === 0 && doubleTeamed) toRisk *= PASS_TURNOVER_DT_MULT;
    toRisk = Math.max(PASS_TURNOVER_MIN, Math.min(PASS_TURNOVER_MAX, toRisk * pressure.stealMult));

    if (state.rng.nextBool(toRisk)) {
      // The pass is lost. Half-ish of forced giveaways are steals (the defender's
      // hands), the rest a bad pass out of bounds.
      const stolen = state.rng.nextBool(Math.min(0.78, 0.20 + stealNorm * 0.45));
      const toClock = advanceClock(state.clock, Math.min(state.clock.shotClock - 1, possTime));
      const toType: TurnoverType = stolen ? 'steal' : 'bad_pass';
      const desc = stolen
        ? `${stealer.firstName} ${stealer.lastName} steals the pass from ${finisher.firstName} ${finisher.lastName}`
        : `Bad pass by ${finisher.firstName} ${finisher.lastName} (turnover)`;
      const event = createEvent(state, toClock, finisherPlayType, finisher, 'turnover', desc);
      event.turnoverType = toType;
      if (stolen) event.stealPlayerId = stealer.id;
      const ns = updateState(state, toClock, event);
      addTurnoverStats(ns, finisher.id, stolen ? stealer.id : undefined);
      ns.previousPossessionTurnover = true;
      ns.previousPossessionLongRebound = false;
      return { state: ns, switchPossession: true, isDeadBall: false };
    }

    // The ball moves to a teammate, weighted toward the open shooter via the
    // spacing model (openManWeight). When a live advantage is being exploited the
    // weighting sharpens toward the shot worth creating.
    const receiver = selectReceiver(candidates, advantageActive, state.rng);

    // Cash the advantage (if any) into shot quality, with diminishing returns and
    // a hard ceiling, then let the defense (usually) recover. A no-advantage swing
    // earns nothing but can occasionally manufacture a fresh advantage.
    if (advantageActive) {
      const inc = ADVANTAGE_SHOT_BONUS * (pass === 0 ? 1 : ADVANTAGE_BONUS_DIMINISH);
      advantageBonus = Math.min(ADVANTAGE_BONUS_CEIL, advantageBonus + inc);
      advantageActive = state.rng.nextBool(ADVANTAGE_PERSIST_PROB);
    } else {
      advantageActive = state.rng.nextBool(ADVANTAGE_CREATE_PROB);
    }

    assister = finisher; // the thrower of THIS pass; overwritten only if a later pass lands the shot
    finisher = receiver;
    finisherDefender = selectDefender(defPlayers, receiver, state.rng, 'spot_up');
    finisherFatigue = state.fatigue.get(receiver.id) ?? 0;
    finisherDefFatigue = state.fatigue.get(finisherDefender.id) ?? 0;
    finisherPlayType = selectReceiverPlayType(receiver, state.rng);
    finisherDoubled = false; // only the initial primary was the doubled man
  }

  // The shot is taken when the chain ends. Pass time is absorbed into the
  // possession's create window (mean possession length is unchanged for the
  // common case), and only extends a short possession into late clock — exactly
  // the tension the per-pass cost is meant to create. Capped at the shot clock.
  const shotElapsed = Math.min(
    Math.max(1, state.clock.shotClock - 1),
    Math.max(possTime, MIN_CREATE_TIME + passSeconds),
  );
  const shotClockState = advanceClock(state.clock, shotElapsed);

  // Late-shot-clock floor: under the pressure threshold the offense is forced
  // into a worse look because the alternative is a violation.
  const rushPenalty = shotClockState.shotClock < SHOT_CLOCK_PRESSURE_THRESHOLD
    ? SHOT_CLOCK_RUSH_PENALTY : 0;

  // A cashed advantage only becomes a clean look on a spaced floor; in a packed
  // paint the help recovers. Centered on league-average spacing, so net-neutral.
  const advSpacingFactor = Math.max(SPACING_ADVANTAGE_MIN,
    Math.min(SPACING_ADVANTAGE_MAX, 1 + SPACING_ADVANTAGE_COEF * spacing));
  const realizedAdvantageBonus = advantageBonus * advSpacingFactor;

  // Shot attempt — shaped by rim protection, late-game three-point chasing, and
  // lineup spacing (good spacing opens the rim, mid-range donates, threes flat-
  // to-up).
  const shotZone = selectShotZone(finisher, finisherPlayType, state.rng, {
    threePointBias: threePointBias(ctx),
    rimDeterrence,
    spacing,
  });
  // More spacing → the on-ball defender gets less help → a softer contest,
  // routed through the existing contest/contestBonus path as a centered
  // subtraction from the effective pressure bonus. Poor spacing → tougher.
  const spacingPressureBonus = pressure.contestBonus - SPACING_OPENNESS_COEF * spacing;
  const shotResult = resolveShot(
    finisher, finisherFatigue,
    finisherDefender, finisherDefFatigue,
    shotZone, finisherPlayType, state.rng,
    state.shootingForm.get(finisher.id) ?? 0,
    {
      pressureBonus: spacingPressureBonus,
      foulMult: pressure.foulMult,
      doubleTeamed: finisherDoubled,
      momentum: offMomentum,
      advantageBonus: realizedAdvantageBonus,
      rushPenalty,
    },
  );

  // Record FGA
  const newState: GameState = { ...state, clock: shotClockState };

  if (shotResult.blocked) {
    const desc = `${finisher.firstName} ${finisher.lastName}'s shot blocked by ${finisherDefender.firstName} ${finisherDefender.lastName}`;
    const event = createEvent(state, shotClockState, finisherPlayType, finisher, 'missed_shot', desc);
    event.shotZone = shotZone;
    event.shotMade = false;
    event.blockPlayerId = finisherDefender.id;

    const updatedState = updateState(newState, shotClockState, event);
    addShotStats(updatedState, finisher.id, shotZone, false, false);
    addBlockStat(updatedState, finisherDefender.id);

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
    const ftResult = resolveFreeThrows(finisher, finisherFatigue, ftAttempts, state.rng);

    const desc = `${finisher.firstName} ${finisher.lastName} fouled on ${shotZone === 'rim' ? 'drive' : 'jumper'} by ${finisherDefender.firstName} ${finisherDefender.lastName}. FT: ${ftResult.made}/${ftResult.attempted}`;
    const event = createEvent(state, shotClockState, finisherPlayType, finisher, 'foul', desc);
    event.shotZone = shotZone;
    event.foulPlayerId = finisherDefender.id;
    event.freeThrowsMade = ftResult.made;
    event.freeThrowsAttempted = ftResult.attempted;
    event.points = ftResult.made;

    const updatedState = updateState(newState, shotClockState, event);
    addScore(updatedState, isHome, ftResult.made);
    addFoulStat(updatedState, finisherDefender.id);
    addFreeThrowStats(updatedState, finisher.id, ftResult.made, ftResult.attempted);
    addTeamFoul(updatedState, !isHome, state.clock.quarter);

    updatedState.previousPossessionTurnover = false;
    updatedState.previousPossessionLongRebound = false;

    return { state: updatedState, switchPossession: true, isDeadBall: true };
  }

  if (shotResult.made) {
    let totalPoints = shotResult.points;
    let desc = `${finisher.firstName} ${finisher.lastName} makes ${describeShotZone(shotZone)}`;

    // The ONLY assist source is the chain: the player who threw the pass into
    // this make is credited. No pass → no assist (a self-created shot).
    if (assister) {
      desc += ` (assist: ${assister.firstName} ${assister.lastName})`;
    }

    const event = createEvent(state, shotClockState, finisherPlayType, finisher,
      shotResult.fouled ? 'and_one' : 'made_shot', desc);
    event.shotZone = shotZone;
    event.shotMade = true;
    event.points = shotResult.points;
    if (assister) event.assistPlayerId = assister.id;

    const updatedState = updateState(newState, shotClockState, event);
    addShotStats(updatedState, finisher.id, shotZone, true, false);
    addScore(updatedState, isHome, shotResult.points);
    if (assister) addAssistStat(updatedState, assister.id);

    // And-one
    if (shotResult.fouled) {
      const ftResult = resolveFreeThrows(finisher, finisherFatigue, 1, state.rng);
      addFreeThrowStats(updatedState, finisher.id, ftResult.made, ftResult.attempted);
      addFoulStat(updatedState, finisherDefender.id);
      addTeamFoul(updatedState, !isHome, state.clock.quarter);
      addScore(updatedState, isHome, ftResult.made);
      totalPoints += ftResult.made;
      event.foulPlayerId = finisherDefender.id;
      event.freeThrowsMade = ftResult.made;
      event.freeThrowsAttempted = ftResult.attempted;
      event.points = totalPoints;
    }

    updatedState.previousPossessionTurnover = false;
    updatedState.previousPossessionLongRebound = false;

    return { state: updatedState, switchPossession: true, isDeadBall: shotResult.fouled };
  }

  // Missed shot
  const desc = `${finisher.firstName} ${finisher.lastName} misses ${describeShotZone(shotZone)}`;
  const event = createEvent(state, shotClockState, finisherPlayType, finisher, 'missed_shot', desc);
  event.shotZone = shotZone;
  event.shotMade = false;

  const updatedState = updateState(newState, shotClockState, event);
  addShotStats(updatedState, finisher.id, shotZone, false, false);

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

// --- Ball-movement chain helpers -------------------------------------------

// The best ball-hawk on the floor, used to attribute steals on a stolen pass and
// to scale per-pass bad-pass risk. Mirrors the read in turnover.ts.
function bestStealer(defenders: Player[], fatigue: Map<string, number>): Player {
  return defenders.reduce((best, d) => {
    const f = fatigue.get(d.id) ?? 0;
    const fb = fatigue.get(best.id) ?? 0;
    const r = getEffectiveRating(d.ratings.steal, f) + getEffectiveRating(d.ratings.defensiveIQ, f);
    const rb = getEffectiveRating(best.ratings.steal, fb) + getEffectiveRating(best.ratings.defensiveIQ, fb);
    return r > rb ? d : best;
  });
}

// Choose the teammate the ball moves to, weighted toward the open shooter via the
// spacing model's openManWeight. When a live advantage is being exploited the
// weighting sharpens (squared) toward the shot most worth creating — but the shot
// is still resolved from the receiver's own ratings, so a non-shooter is never
// fed an "open three" the engine would mis-score as a quality look.
function selectReceiver(candidates: Player[], advantageActive: boolean, rng: SeededRNG): Player {
  const weights = candidates.map((p) => {
    const w = openManWeight(p);
    return advantageActive ? w * w : w;
  });
  return rng.weightedChoice(candidates, weights);
}

// The action the receiver finishes with, in character: a shooter spots up, a big
// cuts to the rim, a driver attacks the closeout (a drive or a pull-up), a
// connector takes the handoff. The blend is tuned so the post-pass shot mix
// mirrors the league rim/mid/three shares instead of funneling every kick-out
// into a catch-and-shoot three.
function selectReceiverPlayType(receiver: Player, rng: SeededRNG): PlayType {
  const types: PlayType[] = ['spot_up', 'cut', 'isolation', 'handoff'];
  const weights = [
    0.24 + receiver.tendencies.spotUpFreq * 2.0 + receiver.ratings.outsideShooting / 80,
    0.38 + receiver.tendencies.cutFreq * 2.0 + receiver.ratings.interiorScoring / 80,
    0.66 + receiver.tendencies.isolationFreq * 1.5 + receiver.ratings.ballHandling / 80, // attack the closeout
    0.30 + receiver.tendencies.handoffFreq * 2.0,
  ];
  return rng.weightedChoice(types, weights);
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
