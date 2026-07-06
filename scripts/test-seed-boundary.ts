/**
 * Seed-boundary check (S1-Ra): the engine requires explicit seeds; selection
 * and validation live at the app/API boundary in `src/lib/seed.ts`. This
 * exercises the production resolver directly (no route handlers, no stores)
 * and proves — at compile time — that the engine entry points reject omitted
 * seeds.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { Player } from '../src/models/player';
import { Team } from '../src/models/team';
import { simulateGame } from '../src/engine';
import { simulateSeason, createSeasonState } from '../src/engine/season';
import { SEED_MIN, SEED_MAX, isValidSeed, resolveSeedFromBody } from '../src/lib/seed';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// --- Compile-time assertions: engine APIs reject omitted seeds. -------------
// Never executed; exists so `npm run typecheck` fails if a seed fallback or
// optional seed sneaks back into an engine signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _compileTimeOnly(teams: Team[], players: Player[]) {
  // @ts-expect-error simulateGame requires an explicit numeric seed
  simulateGame(teams[0], teams[1], players, players, 'id', 'season', '2025-01-01');
  // @ts-expect-error simulateSeason requires options.seed
  simulateSeason(teams, players, {});
  // @ts-expect-error simulateSeason cannot be called without options
  simulateSeason(teams, players);
  // @ts-expect-error createSeasonState requires options.seed
  createSeasonState(teams, players, {});
  // @ts-expect-error createSeasonState cannot be called without options
  createSeasonState(teams, players);
}

async function main() {
  // --- Valid supplied seeds pass through exactly. ---------------------------
  for (const seed of [SEED_MIN, SEED_MAX, 123_456_789]) {
    const r = resolveSeedFromBody({ seed });
    check(
      `valid seed ${seed} preserved`,
      r.ok && r.seed === seed && r.supplied,
      JSON.stringify(r),
    );
  }

  // --- Omitted seed: boundary chooses via injectable generator. ------------
  {
    const r = resolveSeedFromBody({ action: 'new' }, () => 777);
    check('omitted seed resolves via generator', r.ok && r.seed === 777 && !r.supplied);
  }
  {
    // Default generator output must itself satisfy the contract.
    const r = resolveSeedFromBody({});
    check('omitted seed (default generator) in range', r.ok && isValidSeed(r.seed));
  }

  // --- Non-object bodies are handled safely as omission. --------------------
  for (const body of [null, undefined, 'text', 42, []]) {
    const r = resolveSeedFromBody(body, () => 5);
    check(
      `non-object body ${JSON.stringify(body) ?? 'undefined'} treated as omitted`,
      r.ok && r.seed === 5 && !r.supplied,
    );
  }

  // --- Malformed supplied seeds are rejected. --------------------------------
  const invalid: [string, unknown][] = [
    ['present undefined', undefined],
    ['numeric string', '42'],
    ['null', null],
    ['fraction', 1.5],
    ['below minimum', SEED_MIN - 1],
    ['above maximum', SEED_MAX + 1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ];
  for (const [name, seed] of invalid) {
    const r = resolveSeedFromBody({ seed });
    check(`invalid seed rejected: ${name}`, !r.ok);
    check(`isValidSeed false: ${name}`, !isValidSeed(seed));
  }

  // --- New-season persistence: resolved seed lands in SeasonState.seed. ----
  const DATA_DIR = path.join(process.cwd(), 'data');
  const teams: Team[] = JSON.parse(await readFile(path.join(DATA_DIR, 'teams.json'), 'utf-8'));
  const players: Player[] = JSON.parse(await readFile(path.join(DATA_DIR, 'players.json'), 'utf-8'));
  {
    const r = resolveSeedFromBody({}, () => 424_242);
    if (!r.ok) throw new Error('resolver unexpectedly rejected omission');
    const state = createSeasonState(teams, players, { seed: r.seed });
    check('resolved seed persisted in SeasonState.seed', state.seed === 424_242);
  }

  if (failures > 0) {
    console.error(`\nSEED BOUNDARY FAILED: ${failures} case(s).`);
    process.exit(1);
  }
  console.log('\nSEED BOUNDARY PASSED: resolver contract and persistence verified.');
}

main().catch((e) => { console.error(e); process.exit(1); });
