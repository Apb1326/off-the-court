import { SeasonState } from '@/models/season';
import { TransactionEntry } from '@/models/transaction';
import { FREE_AGENT_TEAM_ID } from './constants';
import { deriveReSigningRightsForCut, generateDesiredContract, validateContract } from './contracts';
import { capYearForDate, capYearOffset } from './date';
import { RosterWorld } from './world';

function zeroedStats(state: SeasonState): boolean {
  return state.playerStats.every((row) => row.gamesPlayed === 0 && row.gamesStarted === 0 &&
    row.minutes === 0 && Object.values(row.totals).every((value) => value === 0));
}

/** Pure contract lifecycle seam. App/offseason integration is intentionally deferred. */
export function processContractRollover(
  world: RosterWorld,
  nextSeasonBase: SeasonState,
): RosterWorld {
  if (nextSeasonBase.seasonId === world.season.seasonId) throw new Error('rollover requires a distinct next seasonId');
  if (capYearOffset(world.season.currentDate, nextSeasonBase.startDate) !== 1) {
    throw new Error('rollover requires the immediately following cap year');
  }
  if (nextSeasonBase.transactionLog.length || nextSeasonBase.tradeExceptions.length ||
      nextSeasonBase.teamExceptionStates.length || nextSeasonBase.freeAgentPool.length) {
    throw new Error('next-season base must have empty transaction collections');
  }
  if (!zeroedStats(nextSeasonBase)) throw new Error('next-season playerStats must be freshly zeroed');

  const teams = structuredClone(world.teams).map((team) => {
    const next = { ...team };
    delete next.hardCappedAtApron;
    return next;
  });
  const players = structuredClone(world.players);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const playersById = new Map(players.map((player) => [player.id, player]));
  const freeAgents = new Set(world.season.freeAgentPool);
  const events: TransactionEntry[] = [];
  const base = { date: world.season.endDate, season: world.season.seasonId };
  const rostered = world.teams.flatMap((team) => team.roster.map((playerId) => ({ playerId, teamId: team.id })))
    .sort((a, b) => a.playerId.localeCompare(b.playerId));

  const release = (playerId: string, teamId: string, event: TransactionEntry): void => {
    const player = playersById.get(playerId)!;
    teamById.get(teamId)!.roster = teamById.get(teamId)!.roster.filter((id) => id !== playerId);
    player.teamId = FREE_AGENT_TEAM_ID;
    player.desiredContract = generateDesiredContract(player);
    player.birdRights = deriveReSigningRightsForCut(player.contract, player.experience, teamId);
    freeAgents.add(playerId);
    events.push(event);
  };

  for (const { playerId, teamId } of rostered) {
    const player = playersById.get(playerId);
    if (!player) throw new Error(`rollover roster references missing player "${playerId}"`);
    const oldContract = structuredClone(player.contract);
    const option = oldContract.option;
    if (option && (!Number.isInteger(option.year) || option.year < 0 || option.year >= oldContract.salarySchedule.length)) {
      throw new Error(`invalid option index for player "${playerId}"`);
    }
    const remainingSchedule = oldContract.salarySchedule.slice(1);
    const seq = world.season.transactionLog.length + events.length;

    if (option?.year === 1) {
      const optionSalary = remainingSchedule[0];
      if (optionSalary === undefined) throw new Error(`option for player "${playerId}" has no upcoming salary`);
      const market = generateDesiredContract(player).desiredSalary;
      const exercised = option.type === 'player' ? optionSalary >= market : optionSalary <= market;
      if (!exercised) {
        release(playerId, teamId, { ...base, seq, type: 'option_declined', playerId, teamId, optionType: option.type });
        continue;
      }
      const nextContract = { ...oldContract, salarySchedule: remainingSchedule };
      delete nextContract.option;
      const valid = validateContract(nextContract);
      if (!valid.ok) throw new Error(`invalid rollover contract for "${playerId}": ${valid.reason}`);
      player.contract = nextContract;
      events.push({ ...base, seq, type: 'option_exercised', playerId, teamId, optionType: option.type });
      continue;
    }

    if (remainingSchedule.length === 0) {
      release(playerId, teamId, { ...base, seq, type: 'contract_expired', playerId, teamId });
      continue;
    }
    const nextContract = { ...oldContract, salarySchedule: remainingSchedule };
    if (option?.year && option.year > 1) nextContract.option = { ...option, year: option.year - 1 };
    else delete nextContract.option; // year 0 was already consumed.
    const valid = validateContract(nextContract);
    if (!valid.ok) throw new Error(`invalid rollover contract for "${playerId}": ${valid.reason}`);
    player.contract = nextContract;
  }

  const ownerByPlayer = new Map(players.map((player) => [player.id, player.teamId]));
  const season: SeasonState = {
    ...structuredClone(nextSeasonBase),
    freeAgentPool: [...freeAgents].sort(),
    transactionLog: [
      ...world.season.transactionLog.map((entry) => structuredClone(entry)),
      ...events.map((entry) => structuredClone(entry)),
    ],
    tradeExceptions: world.season.tradeExceptions.map((grant) => structuredClone(grant)),
    teamExceptionStates: world.season.teamExceptionStates
      .filter((state) => state.capYear !== capYearForDate(nextSeasonBase.startDate))
      .map((state) => structuredClone(state)),
    playerStats: nextSeasonBase.playerStats.map((row) => ({
      ...structuredClone(row),
      teamId: ownerByPlayer.get(row.playerId) ?? FREE_AGENT_TEAM_ID,
    })),
  };
  return { teams, players, season };
}
