import { TradeAsset, TradeProposal } from '@/models/transaction';

/**
 * The single place trade assets and payloads are constructed. Keeping construction behind
 * one factory means adding a new asset kind later (picks, cash, pick-swaps) touches only the
 * `TradeAsset` union, this file, and the gate's apply switch — not every call site.
 */

/** Construct a player asset (the only asset kind in Phase 1). */
export function playerAsset(playerId: string): TradeAsset {
  return { kind: 'player', playerId };
}

/** The canonical trade-payload constructor. */
export function buildTrade(
  teamA: string,
  teamB: string,
  assetsFromA: TradeAsset[],
  assetsFromB: TradeAsset[],
): TradeProposal {
  return { teamA, teamB, assetsFromA, assetsFromB };
}

/** Convenience: build a trade directly from player ids per side (the common Phase 1 case). */
export function buildPlayerTrade(
  teamA: string,
  teamB: string,
  playerIdsFromA: string[],
  playerIdsFromB: string[],
): TradeProposal {
  return buildTrade(
    teamA,
    teamB,
    playerIdsFromA.map(playerAsset),
    playerIdsFromB.map(playerAsset),
  );
}

/** Extract the player ids from an asset list. (Non-player kinds don't exist yet.) */
export function playerIdsOf(assets: TradeAsset[]): string[] {
  return assets
    .filter((a): a is Extract<TradeAsset, { kind: 'player' }> => a.kind === 'player')
    .map((a) => a.playerId);
}
