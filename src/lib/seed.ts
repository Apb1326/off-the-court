/**
 * Canonical simulation-seed contract for the app/API boundary.
 *
 * The engine (`src/engine`) requires an explicit seed everywhere and never
 * chooses one itself (ROADMAP §9.2). Seed selection and validation happen
 * here, at the application boundary, before any engine call.
 *
 * Supported range: inclusive 1..2_000_000_000 — the same range used by the
 * per-game seed generation in `simulateSeason` / `profile-engine.ts`
 * (`rng.nextInt(1, 2_000_000_000)`) and by `deterministicSeed`.
 *
 * A supplied seed is valid only if it is a JavaScript number, finite,
 * integral, and within the supported range. An *omitted* seed (the `seed`
 * property is absent from the request body) is distinct from an *invalid*
 * one (present but malformed — including a present `undefined`).
 */

export const SEED_MIN = 1;
export const SEED_MAX = 2_000_000_000;

/** True only for a finite integer number within [SEED_MIN, SEED_MAX]. */
export function isValidSeed(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= SEED_MIN &&
    value <= SEED_MAX
  );
}

/**
 * Ambient seed choice for a brand-new world / quick sim, sanctioned only at
 * the app boundary (§9.2). Uniform over the full supported range.
 */
export function randomSeed(): number {
  return SEED_MIN + Math.floor(Math.random() * SEED_MAX);
}

export type SeedResolution =
  | { ok: true; seed: number; supplied: boolean }
  | { ok: false; error: string };

/**
 * Resolve the simulation seed from a parsed request body.
 *
 * - `seed` absent (or body not an object): the boundary chooses one via
 *   `generate` (injectable for deterministic tests; defaults to `randomSeed`).
 * - `seed` present and valid: passed through unchanged.
 * - `seed` present but malformed (`undefined`, `null`, string, fraction,
 *   NaN, ±Infinity, out of range): rejected.
 *
 * Omission is detected by own-property presence, not `=== undefined`.
 */
export function resolveSeedFromBody(
  body: unknown,
  generate: () => number = randomSeed,
): SeedResolution {
  const isObject = typeof body === 'object' && body !== null;
  const hasSeed = isObject && Object.prototype.hasOwnProperty.call(body, 'seed');

  if (!hasSeed) {
    return { ok: true, seed: generate(), supplied: false };
  }

  const value = (body as Record<string, unknown>).seed;
  if (!isValidSeed(value)) {
    return {
      ok: false,
      error: `seed must be an integer between ${SEED_MIN} and ${SEED_MAX}`,
    };
  }

  return { ok: true, seed: value, supplied: true };
}
