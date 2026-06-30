import { Contract } from './player';

/**
 * Roster-transaction data types (transactions Phase 1).
 *
 * These are the persisted shapes for the GM/franchise layer's first slice: the asset-typed
 * trade payload and the append-only transaction log. The *logic* (validation, the
 * validate-then-mutate gate, CPU desirability) lives in `src/transactions`. Per AGENTS.md,
 * the trade payload is asset-typed from day one and the log is append-only.
 */

/**
 * A single asset changing hands in a trade. Phase 1 has only `player`; the union is
 * intentionally typed so draft picks, cash considerations, and pick-swaps slot in later
 * (roadmap Phase 5a/8) without rewriting the trade engine. Construct assets only through
 * the factory in `src/transactions/assets.ts` — the shape stays isolated behind one
 * constructor so adding a kind doesn't ripple through call sites.
 */
export type TradeAsset = { kind: 'player'; playerId: string };
// Reserved for later phases (do NOT implement here):
//   | { kind: 'pick'; ... }      // Phase 8 — tradeable draft picks
//   | { kind: 'cash'; amountMillions: number }  // Deferred — cash considerations
//   | { kind: 'pickSwap'; ... }  // Phase 8 — pick swaps (distinct from conveyance)

/** The set of asset kinds that currently exist. */
export type TradeAssetKind = TradeAsset['kind'];

/**
 * A proposed trade between two teams. The two asset lists are independent, so uneven
 * (e.g. 2-for-1) trades are naturally expressible. Symmetric by design: there is no
 * "controlled" vs. "CPU" distinction here — both sides pass the same legality stack in the
 * gate. `assetsFromA` leaves teamA for teamB; `assetsFromB` leaves teamB for teamA.
 */
export interface TradeProposal {
  teamA: string;
  teamB: string;
  assetsFromA: TradeAsset[];
  assetsFromB: TradeAsset[];
}

/**
 * Shared fields on every transaction-log entry. Mirrors `InjuryHistoryEntry`'s
 * self-contained design (see season.ts): each entry carries its own `seq`, `date`, and
 * `season`, so a multi-season history is just these concatenated, and a later phase can
 * derive consequences from an entry without ever mutating it.
 */
interface TransactionEntryBase {
  /** Monotonic append index, unique within a season's log (assigned = log length at append). */
  seq: number;
  /** In-game date the move happened (season.currentDate), 'YYYY-MM-DD'. */
  date: string;
  /** seasonId — the key that makes multi-season aggregation trivial. */
  season: string;
}

/** A completed trade. Records the full asset payload both ways so it is self-describing. */
export interface TradeEntry extends TransactionEntryBase {
  type: 'trade';
  teamA: string;
  teamB: string;
  assetsFromA: TradeAsset[];
  assetsFromB: TradeAsset[];
}

/** A free-agent signing: a player drawn from the FA pool onto a team. */
export interface SignEntry extends TransactionEntryBase {
  type: 'sign';
  playerId: string;
  toTeamId: string;
  /**
   * The contract instantiated on signing (Phase 2+). Absent on pre-Phase-2
   * sign entries. Self-describing: a later phase can derive cap consequences
   * from this entry alone.
   */
  contractSigned?: Contract;
}

/**
 * A cut/waive (collapsed in Phase 1: the player goes straight to the FA pool, for free).
 *
 * Carries enough to attribute future financial consequences from this immutable event:
 * the player, the team that released them, and when (date + seq). Phase 5a derives dead
 * money from (original contract + this cut event). When contracts exist (Phase 2+), the
 * entry is *additively* extended with a waived-contract snapshot for cuts made then — a
 * pre-contract Phase-1 cut legitimately carries zero financial consequence, so this entry
 * never needs to be rewritten.
 */
export interface CutEntry extends TransactionEntryBase {
  type: 'cut';
  playerId: string;
  fromTeamId: string;
  /**
   * Snapshot of the player's contract at the time of the cut (Phase 2+).
   * Absent on pre-Phase-2 cut entries. Phase 5a derives dead money from this
   * without needing to look up the player's current (possibly replaced) contract.
   * Per the append-only rule: set once at cut time and never rewritten.
   */
  contractAtCut?: Contract;
}

/** One immutable entry in the append-only transaction log. */
export type TransactionEntry = TradeEntry | SignEntry | CutEntry;
