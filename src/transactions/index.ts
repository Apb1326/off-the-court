/**
 * Transaction layer (GM/franchise) — public surface.
 *
 * The state-mutation layer on top of `SeasonState`: the asset-typed trade payload, the
 * roster-legality validators, the atomic validate-then-mutate gate (trade / sign / cut), and
 * the CPU desirability seam. See AGENTS.md "Transaction-layer rules" and
 * TRANSACTIONS_ROADMAP.md Phase 1.
 */

export * from './constants';
export * from './world';
export * from './assets';
export * from './validators';
export * from './gate';
export * from './evaluate';
