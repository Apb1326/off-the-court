import { Player } from '@/models/player';
import { RotationSettings } from '@/models/team';
import {
  FATIGUE_FORCE_SUB_THRESHOLD,
  MAX_FOULS,
} from './constants';

export interface SubstitutionAction {
  playerOut: string;
  playerIn: string;
}

export function checkSubstitutions(
  onCourt: string[],
  bench: string[],
  players: Map<string, Player>,
  fatigue: Map<string, number>,
  fouls: Map<string, number>,
  rotation: RotationSettings,
  quarter: number,
  gameClock: number,
  isDeadBall: boolean,
  scoreMargin: number = 0,
): SubstitutionAction[] {
  if (!isDeadBall || bench.length === 0) return [];

  const actions: SubstitutionAction[] = [];
  const benchSet = new Set(bench);
  const onCourtSet = new Set(onCourt);
  const minutesLeft = gameClock / 60;

  // Mandatory subs: fouled out or extreme fatigue
  for (const playerId of onCourt) {
    if (benchSet.size === 0) break;

    const playerFouls = fouls.get(playerId) ?? 0;
    const playerFatigue = fatigue.get(playerId) ?? 0;

    if (playerFouls >= MAX_FOULS || playerFatigue > FATIGUE_FORCE_SUB_THRESHOLD) {
      const replacement = findBestReplacement(playerId, Array.from(benchSet), players, fatigue, fouls, rotation);
      if (replacement) {
        actions.push({ playerOut: playerId, playerIn: replacement });
        benchSet.delete(replacement);
        onCourtSet.delete(playerId);
        onCourtSet.add(replacement);
      }
    }
  }

  if (actions.length > 0) return actions;

  // Garbage time: a decided game late in the 4th — empty the bench and rest the
  // starters. This mirrors how real blowouts top out (starters sit, leads stop
  // growing) and keeps margins from ballooning unrealistically.
  const garbageTime = quarter >= 4 && minutesLeft <= 5 && scoreMargin >= 20;
  if (garbageTime) {
    const startersOnCourt = Array.from(onCourtSet)
      .filter((id) => rotation.starters.includes(id))
      .sort((a, b) => getPlayerOverall(players.get(b)) - getPlayerOverall(players.get(a)));
    for (const starterId of startersOnCourt) {
      if (benchSet.size === 0) break;
      const replacement = findBestReplacement(starterId, Array.from(benchSet), players, fatigue, fouls, rotation);
      if (replacement && !rotation.starters.includes(replacement)) {
        actions.push({ playerOut: starterId, playerIn: replacement });
        benchSet.delete(replacement);
      }
    }
    return actions;
  }

  // Rotation-based substitutions at key moments
  if (!isRotationWindow(quarter, minutesLeft)) return [];

  // Check if any starters are on the bench and rested — bring them back
  const startersOnBench = rotation.starters.filter((id) => benchSet.has(id));
  if (startersOnBench.length > 0) {
    const restedStarters = startersOnBench.filter((id) => (fatigue.get(id) ?? 0) < 0.25);

    if (restedStarters.length > 0) {
      // Find the most fatigued/lowest-rated on-court players to swap out
      const swapCandidates = Array.from(onCourtSet)
        .filter((id) => !rotation.starters.includes(id))
        .map((id) => ({
          id,
          fatigue: fatigue.get(id) ?? 0,
          overall: getPlayerOverall(players.get(id)),
        }))
        .sort((a, b) => b.fatigue - a.fatigue || a.overall - b.overall);

      const maxSwaps = Math.min(restedStarters.length, swapCandidates.length);
      for (let i = 0; i < maxSwaps; i++) {
        actions.push({ playerOut: swapCandidates[i].id, playerIn: restedStarters[i] });
        benchSet.delete(restedStarters[i]);
        onCourtSet.delete(swapCandidates[i].id);
        onCourtSet.add(restedStarters[i]);
      }
    }
  }

  // Sub out fatigued on-court players for fresh bench players
  const tiredPlayers = Array.from(onCourtSet)
    .filter((id) => (fatigue.get(id) ?? 0) > 0.35)
    .sort((a, b) => (fatigue.get(b) ?? 0) - (fatigue.get(a) ?? 0));

  for (const playerId of tiredPlayers.slice(0, 2)) {
    if (benchSet.size === 0) break;
    // Don't sub out a starter we just put in
    if (actions.some((a) => a.playerIn === playerId)) continue;

    const replacement = findBestReplacement(playerId, Array.from(benchSet), players, fatigue, fouls, rotation);
    if (replacement) {
      // Don't sub in someone we're about to sub out
      if (actions.some((a) => a.playerOut === replacement)) continue;
      actions.push({ playerOut: playerId, playerIn: replacement });
      benchSet.delete(replacement);
    }
  }

  return actions;
}

function isRotationWindow(_quarter: number, minutesLeft: number): boolean {
  return (
    (minutesLeft >= 5.0 && minutesLeft <= 7.0) ||
    (minutesLeft >= 2.0 && minutesLeft <= 4.0) ||
    (minutesLeft >= 9.0 && minutesLeft <= 10.0) ||
    minutesLeft >= 11.0
  );
}

function getPlayerOverall(player: Player | undefined): number {
  if (!player) return 0;
  return Object.values(player.ratings).reduce((a, b) => a + b, 0) / 17;
}

function findBestReplacement(
  playerOutId: string,
  available: string[],
  players: Map<string, Player>,
  fatigue: Map<string, number>,
  fouls: Map<string, number>,
  rotation: RotationSettings,
): string | null {
  const playerOut = players.get(playerOutId);
  if (!playerOut) return null;

  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const candidateId of available) {
    const candidate = players.get(candidateId);
    if (!candidate) continue;

    const candidateFatigue = fatigue.get(candidateId) ?? 0;
    const candidateFouls = fouls.get(candidateId) ?? 0;

    if (candidateFouls >= MAX_FOULS) continue;
    if (candidateFatigue > 0.45) continue;

    let score = 0;

    if (candidate.position === playerOut.position) score += 30;
    if (candidate.secondaryPosition === playerOut.position) score += 15;

    // Prefer starters
    if (rotation.starters.includes(candidateId)) score += 25;

    const rotIdx = rotation.rotationOrder.indexOf(candidateId);
    if (rotIdx >= 0) score += 15 - rotIdx;

    score += (1 - candidateFatigue) * 20;

    const overall = getPlayerOverall(candidate);
    score += overall * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestId = candidateId;
    }
  }

  return bestId;
}
