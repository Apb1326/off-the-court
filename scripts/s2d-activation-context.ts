/**
 * S2d activation-context proof. Read-only: it never generates, promotes, or
 * rewrites the active pool. Profile and calibrate import this check before
 * simulating so a numerical result cannot be separated from its
 * pool/selector/table context.
 *
 * The integrity anchor is the promotion manifest (`data/.league-manifest.json`),
 * written atomically by `scripts/build-league.ts` as the last step of a
 * promotion: the active pair must hash-match it and the engine's production
 * selector/table identities must equal the promoted ones. Deep builder
 * byte-identity (rebuilding from data/nba/normalized/) intentionally stays in
 * `build-league --check` / the S2d harness — it needs the harvest artifacts
 * and a full derivation, which a profile run should not require.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProductionPool, ProductionPool } from '../src/lib/production-pool';

export interface ActivationContext extends ProductionPool {
  representativePlayerIds: string[];
  manifestCheck: 'verified';
}

export async function loadActivationContext(): Promise<ActivationContext> {
  const pool = loadProductionPool(path.join(process.cwd(), 'data'));
  return {
    ...pool,
    representativePlayerIds: pool.players.map((player) => player.id).sort().slice(0, 6),
    manifestCheck: 'verified',
  };
}

export function printActivationContextBanner(context: ActivationContext): void {
  console.log('S2D ACTIVATION CONTEXT — VERIFIED');
  console.log(`pool=${context.directory}`);
  console.log(`teams.sha256=${context.teamsSha256} players.sha256=${context.playersSha256}`);
  console.log(`teams=${context.teams.length} players=${context.players.length}`);
  console.log(`representative-player-ids=${context.representativePlayerIds.join(',')}`);
  console.log(`selector=${context.selectorId} shot-zone-table=${context.shotZoneTableId}`);
  console.log(`manifest=${context.manifestCheck}`);
  console.log('');
}

async function main(): Promise<void> {
  const context = await loadActivationContext();
  printActivationContextBanner(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
