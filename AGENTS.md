<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Off the Court — engineering rules

Rules for anyone, human or AI, working on the simulation. They exist because the engine's correctness depends on invariants that are easy to break without an error ever being thrown: silently miscalibrated stats, a desynced RNG stream, value that quietly becomes additive again. Read this before touching `src/engine`.

> AI coding assistants: treat these as hard constraints. When a task appears to require violating one, stop and surface the conflict instead of working around it. Work in small, reviewable diffs, and after any engine change report what you changed, the before/after `npm run profile` deltas, and the A/B result.

## Golden rules

1. **Simulate from true ratings, never scouted.** The sim resolves from `player.ratings`. The scouted view (`ratings/scouting.ts`) is for the GM-facing UI and AI only. Any simulation path that reads scouted values to decide an outcome is a bug.
2. **All randomness goes through `SeededRNG`.** Never call `Math.random()` in simulation code. Determinism — same seed → byte-identical box score *and* play-by-play — is load-bearing for calibration and testing.
3. **Stats are derived from the `PlayByPlayEvent` stream, never assigned directly.** Emit the event; `recordEventStats` in `engine/index.ts` drives the `StatsAccumulator`. The `addXStats` functions in `possession.ts` are intentional no-op stubs — do not "implement" them or hand-increment a stat line.
4. **Tunable numbers live in `engine/constants.ts`, annotated.** No magic numbers in engine logic. A new knob goes there with a comment on what it does and its sane range.
5. **Calibration is the acceptance test.** After any engine change, `npm run profile` must bring every tracked stat back within its tolerance band. A change that "works" but breaks calibration is not done.
6. **Never value a lineup by summing player ratings.** Value is relational. Spacing, the ball-movement chain, and defensive versatility carry the non-additive effects that are the whole point of the engine.

## Simulation invariants

**Rating scale.** 1–80, centered at **40** (`ratingToModifier`: `(rating - 40) / 40`). Not 0–100, not centered at 50.

**Shot math is additive and clamped.** `resolveShot` sums base zone % plus shooter, defender, fatigue, play-type, contest, form, double-team, momentum, advantage, and rush terms, then clamps to `[0.05, 0.95]`. Keep new modifiers additive and inside the clamp — no multiplicative terms that escape the bounds.

**Determinism.** Any new variation must draw from `SeededRNG` and consume randomness in a stable order. A branch that sometimes draws and sometimes doesn't will desync the stream. `spacing.ts` and the versatility math are deliberately pure arithmetic (no RNG) so they don't perturb it — keep them that way. Verify with `tsx scripts/test-determinism.ts`.

## Possession engine (`possession.ts`)

The possession can develop through the initial action plus **up to `MAX_EXTRA_PASSES`** additional actions. This is a hard ceiling — do not loosen it.

- **Quality is keyed to advantage state, not pass count.** A pass earns a shot-quality bonus only when it cashes a live advantage (a double-team, a drive that collapses help). The bonus has diminishing returns (`ADVANTAGE_BONUS_DIMINISH`) and a hard ceiling (`ADVANTAGE_BONUS_CEIL`). A no-advantage swing earns nothing but still costs clock and carries bad-pass risk. Rewarding every pass equally is the wrong model and will miscalibrate.
- **Real kick-outs, not faked rates.** A double-team forces a real pass into the chain (`DOUBLE_TEAM_PASS_PROB`), routed toward the open shooter via `openManWeight`. Do not model help defense by bumping an assist-rate number.
- **One assist source.** The assister is the player who threw the pass into the make. There is no post-hoc assist roll — do not add one, and do not credit an assist on an unassisted (self-created) shot.
- **Realized advantage is spacing-gated.** A cashed advantage only becomes a clean look on a spaced floor (`SPACING_ADVANTAGE_COEF`); in a packed paint the help recovers. Keep this centered/net-neutral.
- **Late-clock degradation.** Under `SHOT_CLOCK_PRESSURE_THRESHOLD` the shot takes `SHOT_CLOCK_RUSH_PENALTY`. Preserve it.
- **Net-neutral efficiency.** The chain must not quietly inflate scoring. Per-pass clock cost and per-pass turnover risk carry that constraint. If turnovers spike implausibly in `npm run profile`, the signal is usually that the advantage bonus is too generous — tune the bonus, don't suppress turnovers to mask it.

Preserve the existing clock, fatigue, foul, penalty/bonus, transition, momentum, and substitution logic when editing the loop.

## Spacing & versatility (`spacing.ts`)

This layer already exists. **Do not rebuild it.**

- Offensive output consumes a centered spacing value from the off-ball four (everyone except the finisher), built from outside shooting × three-point tendency plus a threat-gated movement term.
- Defensive versatility is a centered z-score off the weak-link perimeter defender and mobility/size spread.
- Both are pure arithmetic and centered so a league-average lineup nets ~zero. When adding lineup-level effects, extend this model — don't introduce a parallel additive sum of ratings.
- Baselines/spreads (`SPACING_BASELINE_OFFBALL_FOUR`, `SPACING_SPREAD`, the versatility params) are derived from the real player pool by `tsx scripts/calibrate-spacing.ts`. Re-derive there rather than hand-editing if the player pool changes materially.

## Verification checklist

Run after any engine change and report results:

- [ ] `npm run typecheck` — clean.
- [ ] `npm run profile` — all tracked stats within tolerance of `LEAGUE_AVG` / the targets. Report before/after deltas; watch assists and turnovers when chain logic changed.
- [ ] `tsx scripts/test-determinism.ts` — same seed → identical game.
- [ ] `tsx scripts/test-spacing-ab.ts` — spacing still shows a material, correctly-signed effect.

## What not to do

- Don't call `Math.random()` anywhere in simulation code.
- Don't read scouted ratings on a simulation path.
- Don't hand-assign stats or fill in the no-op `addXStats` stubs.
- Don't sum player ratings to value a lineup.
- Don't reintroduce a post-hoc assist roll, or credit assists outside the chain.
- Don't let the possession chain exceed `MAX_EXTRA_PASSES`.
- Don't add RNG to `spacing.ts`.
- Don't scatter tuning numbers through the code — they go in `constants.ts`.
- Don't ship an engine change without re-running calibration.

## Known cleanups

- `shouldDoubleTeam` in `defense.ts` has a stale doc comment referring to the open teammate being "handled by the caller via a higher assist rate." Since the chain refactor that's no longer how it works — the double-team routes into a real kick-out in `possession.ts`. The comment can be updated; the behavior is already correct.
