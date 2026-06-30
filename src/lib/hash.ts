/**
 * FNV-1a 32-bit hash. Deterministic, platform-stable, pure function.
 * Used for migration-time RNG seeding: same player id → same seed, always.
 * Defined once here; import everywhere — do not re-implement.
 *
 * NOT for simulation seeding — the sim has its own hash mixers.
 */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned 32-bit
}
