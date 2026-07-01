# Off the Court — Transactions Roadmap

> **Status:** living design doc. Read alongside `AGENTS.md` (hard engineering rules) — this document does not restate those rules, it assumes them. Where the two conflict, `AGENTS.md` wins.

---

## How to use this document (coding agents, read first)

Transactions are a **state-mutation layer on top of `SeasonState`**. The hard part is almost never the move itself — it is the invariant each new rule imposes on *every prior move*. Cap rules don't just gate new trades; they retroactively constrain cuts, signings, and the trade engine that already shipped.

**Sequencing principle:** each phase adds **one constraint dimension** and re-validates the whole transaction surface against it. Ship phases incrementally and independently.

**Every phase, before it is considered done:**

1. `npm run profile` and `npm run calibrate` pass **unchanged** on an unmodified league. No phase here touches the sim, so single-game distributions must stay flat. A diff in profiling output is a bug, not an expected side effect.
2. Any new persisted state ships a **schema bump + migration** from the prior version **and** a `scripts/` round-trip check (load old save → migrate → assert invariants → re-serialize).
3. All generated data and tie-breaks go through `SeededRNG`. Never `Math.random`. Transactions themselves are deterministic.

A copy-paste acceptance checklist is at the end of this doc.

---

## Architectural spine (read before touching any phase)

These decisions are load-bearing across the whole roadmap. Get them right in Phase 1 and the later phases plug in cleanly; get them wrong and Phase 8 forces a rewrite.

### The three canonical structures (established Phase 1)

- **Free-agent pool** — the canonical home for every unsigned player. Not a flag on the player; a real pool in `SeasonState`. Everything that releases a player puts them here; everything that signs a player draws from here.
- **Append-only transaction log** — the canonical history. Never rewrite a log entry. When a later phase makes a past action financially consequential (e.g. Phase 5a dead money on a Phase 1 cut), the consequence is *derived* from the original immutable event, not patched into it.
- **The atomic validate-then-mutate gate** — the single chokepoint every transaction passes through. Validators run first and compose; mutation happens only if all pass; nothing is half-applied.

### Trade payload: model as a typed asset list from day one

**Decision to make consciously in Phase 1.** A trade will eventually carry, per side: players, **draft picks** (Phase 8), **cash considerations**, and **pick swaps**. If Phase 1 models a trade as "list of player IDs per side," Phase 8 forces a structural rip-up of the trade engine.

**Recommendation:** model the trade payload as `TradeAsset[]` per side where a player is one asset *type*, even though `player` is the only type that exists initially. The extra structure now is cheap; the later refactor is not. This is the transactions-layer analog of getting your serializable state boundaries right before building on them — the same reason saves came before the GM layer.

If you defer this, document it as a known refactor and keep the payload shape isolated behind one constructor so the blast radius is contained.

### Legality ≠ desirability (permanent boundary)

Two **permanently distinct** things, established in Phase 1 and filled in later:

- **Legality** — a *deterministic, shared* predicate stack (roster-legality, then cap-legality, then apron-legality) living in the validate-then-mutate gate. Applies to **any** trade regardless of who proposed it, including controlled-team-proposed trades and both sides of a CPU trade.
- **Desirability** — the AI's valuation judgment, lives in `evaluateTradeForCpu`. A trade can be legal-but-undesirable or desirable-but-illegal.

> **Correction vs. earlier drafts:** legality is **not** a gate "inside" `evaluateTradeForCpu`. The CPU acceptance function is desirability-only and may assume legality has already passed (defensive re-check is fine, ownership is not). This keeps the chokepoint clean and means controlled-vs-controlled and one-sided validations still hit the legality stack.

### Derive, don't store — and the explicit exceptions

The default is the project rule: payroll derives from contracts, cap status derives from payroll, never persist a derived number you have to keep in sync. (Transactions-layer version of "stats derive from the `PlayByPlayEvent` stream.")

**But a few facts are genuinely event-set state, not derived, and must be persisted:**

- **Hard-cap status** (Phase 4) — *triggered* by certain transactions, not computable from current payroll (see Phase 4).
- Injuries (already in `SeasonState`) are the existing precedent for this category.

Call these out explicitly wherever they appear so an agent doesn't try to "fix" them into derived getters.

---

## Phase 1 — Roster transaction layer

**Goal:** move players between rosters with **roster-legality validation only**.

**Adds:**
- Trade (controlled ↔ CPU, uneven counts), sign free agent, cut/waive.
- Free-agent pool + append-only transaction log in `SeasonState`.
- `evaluateTradeForCpu` accept-all stub as the single desirability swap-in point.
- Roster-size floor/ceiling constants (standard roster only — see note); atomic validate-then-mutate.
- Schema bump + empty-init migration.
- `TradeAsset[]` payload shape (see spine) — or a documented decision to defer.

**Out of scope for this phase:** anything financial. No salary, no contracts, no cap, no matching. A trade is legal iff both rosters remain within size bounds afterward.

**Establishes:** the free-agent pool (canonical home for unsigned players), the transaction log (canonical history), and `evaluateTradeForCpu` (the one desirability chokepoint). Every later phase plugs into these three, not around them.

**Notes / gotchas:**
- **Cut vs. waive are collapsed here.** A "cut" sends the player straight to the FA pool, for free. This is a deliberate MVP simplification; the real **waiver process** (a waiver period during which other teams, incl. CPU, can claim the player and assume their contract) is a later addition — see *Deferred mechanics*. Ensure the cut's log entry carries enough to later attribute consequences.
- **Roster-size constants govern the standard roster only.** Two-way slots (Phase 2+) are a separate category; don't let a future two-way flag silently change these counts.

---

## Phase 2 — Contracts

**Goal:** give players contracts. The single most load-bearing prerequisite for everything financial — no cap or trade valuation can exist until a player has a contract.

**Adds:**
- **Contract model** on the player (or a parallel contract table keyed by player id): salary per year, years remaining, contract type (rookie scale, veteran, max, minimum, **two-way**), no-trade-clause flag, player/team options.
- **Free agents carry a *desired* contract**, not an active one — signing instantiates the real contract.
- **Cap holds** — stub the concept for FAs the team holds rights to, even if the number is simple. This is the hook Bird rights and cap-room math hang off of later.

**Out of scope for this phase:** the contract doesn't *do* anything yet — no payroll, no cap, no matching. Just data + instantiation-on-signing + migration.

**Migration is the real work here.** Seeded players have no contracts. Two valid paths:
- **Generate plausible contracts at migration** from rating/age (the way `derivePotential` keys off age curves) — more realistic, **and must be deterministic**.
- **Placeholder-everyone** — simpler, less realistic.

> **Determinism requirement (precise):** if you generate contracts at migration, seed generation from a **stable per-player key** on a **dedicated migration RNG stream**, so migration is *idempotent and order-independent*: re-running it on the same save yields identical contracts, and it never consumes from a shared stream in call-order-dependent ways. This mirrors the injury system's separate deterministic RNG stream.
>
> **The hash must be explicitly specified, not left to the agent.** Use a deterministic, pure-function string hash over the player id (e.g. FNV-1a or equivalent) that is:
> - **Stable across Node versions and platforms** — do not use any runtime- or engine-dependent hash, object iteration order, `Date`, or `Math.random`.
> - **Pure and string-domain** — same id string → same 32-bit (or wider) integer seed, forever.
> - **Defined once in shared code** and reused, not re-implemented per call site.
>
> Avoid: JS engine string-hash internals, `JSON.stringify` of an object whose key order isn't guaranteed, or any hash that folds in non-id fields that could change between migrations. The seed must be a function of the player id and nothing else.
>
> The `scripts/` round-trip check must assert **migration is a no-op when run twice** and that contracts are **identical across two independent migrations of the same pre-contract save** — this is what actually catches a non-stable hash.

**Calibration:** contracts don't touch the sim, so profile/calibrate stay flat. But this is the first phase with genuinely complex migration — add a dedicated `scripts/` check that round-trips a pre-contract save through migration and asserts **every player ends with a valid contract** (and that running migration twice is a no-op).

**Notes:**
- **Two-way** is a *type flag only* in this phase. Two-way roster-slot accounting (separate limited slot count, different cap treatment) is deferred until two-way roster mechanics are actually modeled.
- **No-trade clause** and **options** are set here but *resolved/enforced* later (NTC enforcement → Phase 4 legality predicate; option resolution → Phase 5a rollover).

**Establishes:** money exists. Phases 3–6 are all reactions to this.

---

## Phase 3 — Salary cap & roster financial state

**Goal:** give teams a financial position. **Compute and expose only — no enforcement.**

**Adds:**
- **Per-team payroll**, *derived* from summing active contracts. Never stored as a separate source of truth — always recompute from contracts.
- **League cap constants** in `constants.ts`: salary cap, luxury-tax line, apron(s), minimum team salary. NBA-realistic but tunable. **Source the actual figures from the current CBA at implementation time** — they are version-specific and change; do not hardcode remembered values.
- **Team cap-status accessor:** under cap / over cap / over tax / over apron(s). The analog of the controlled-vs-CPU accessor — one clean function everything downstream reads.

**Out of scope for this phase:** **no enforcement.** Transactions still pass on roster-legality alone. Shipping computation before enforcement lets you verify the numbers are right *before* they start blocking moves.

**Decisions this phase must make (cap room is undefined without them):**
- **Cap holds** — do they count against cap room? (For a team's own FAs they generally do, which is what makes Bird rights meaningful.) Wire the Phase 2 stub in here.
- **Incomplete-roster / empty-roster charges** — does the team get charged a minimum-salary cap hold for each open roster spot below the threshold when computing room? Decide explicitly; "room" means nothing until you do.

**Establishes:** the cap-status accessor that Phase 4 turns into a gate.

---

## Phase 4 — Salary matching & cap enforcement

**Goal:** the first phase that *constrains* the Phase 1 transaction engine. Trades get hard here.

**Adds:**
- **Salary-matching rules** for over-the-cap teams (the CBA's tiered matching bands — percentage of outgoing plus a fixed allowance). Under-cap teams absorb without matching up to available room. **Isolate the band numbers as named, tunable constants** — they change between CBAs; you want them in one place.
- **Apron restrictions** as their **own clearly-marked predicate set** (they change frequently in the real CBA — keep them tunable in one location): hard-capped teams can't exceed the apron; restrictions on aggregation, sign-and-trade above the second apron, etc.
- **Hard-cap as triggered set-state.** A team becomes hard-capped (at an apron) *by taking certain actions* — e.g. using the non-taxpayer MLE, the bi-annual exception, or acquiring a player via sign-and-trade. It then persists for the rest of the league year and constrains future moves.
  > This is **not** derivable from current payroll. Persist it on the team, set it from the triggering transaction, reset it at league-year rollover, and migrate it. Treat it like an injury flag, not a getter.
- **Bird / Early-Bird / Non-Bird rights** — the mechanism by which a team exceeds the cap to re-sign *its own* free agents. This is how most re-signings actually happen; fold it into the cap-room / exception logic rather than leaving it implicit.
- **NTC enforcement** as a legality predicate (controlled-team trade blocked unless the player waives).
- **Temporal legality** — a simple "is trading currently allowed?" predicate (trade-deadline / league-year window). Distinct from the value-driven *deadline behavior* in Phase 7.
- **Minimum team-salary floor** enforced. Signings now check cap room / exceptions; cuts begin to interact with dead money (Phase 5a — coordinate).

**Out of scope for this phase:** the AI's opinion. Legality is deterministic and shared; *whether the CPU wants the deal* stays in Phase 6.

**This phase most perturbs the validation architecture.** The atomic validate-then-mutate gate now runs a **financial validation pass alongside** the roster-legality pass. Keep them as **composable validators returning a unified reason**, not nested conditionals. The stack is roughly: roster-legality → cap-legality → apron-legality → temporal/NTC, each independently testable.

**Establishes:** trade legality is now a real, shared, deterministic function — the clean boundary the trade AI needs.

---

## Phase 5a — Dead money, exceptions & contract lifecycle

**Goal:** the deterministic financial-consequence layer. Everything here is a rule the engine *applies*; nothing here requires composing the trade engine with contract instantiation. Ships before 5b because 5b stress-tests it.

**Adds:**
- **Trade exceptions** (created by uneven outgoing salary; usable in later trades).
- **Mid-level / bi-annual exceptions.** Disabled Player Exception is an approved
  game-scope deferral for this phase.
- **Waived-player dead money / stretch provision** — cutting a contract is no longer free; it hits the cap on a schedule.
  > This **retroactively makes Phase 1's cut a financial event.** Per the append-only rule: do **not** rewrite the old cut log entry. Dead money is *derived* state computed from (original contract + immutable cut event), applied on a schedule. Never store it as a mutable field you keep in sync.
- **Contract expiry & option resolution** at season rollover (player/team options exercised or declined; expirings become free agents). Ties transactions into the **season-transition flow** — coordinate with wherever rollover lives.
  Phase 5a supplies a tested pure transaction-layer rollover seam only; app/franchise
  integration waits for the future offseason flow.

**Out of scope for this phase:** sign-and-trade (Phase 5b). No CPU initiative — the CPU isn't proposing anything; it's only reacting to the player and resolving deterministic lifecycle events.

**Establishes:** the full deterministic consequence model — every financial event the player can trigger now has its correct downstream effect.

---

## Phase 5b — Sign-and-trade (the composition stress test)

**Goal:** one mechanic, deliberately isolated, because it is **the integration test of the whole financial stack** — it composes the trade engine (Phase 1) + contract instantiation (Phase 2) + salary matching (Phase 4) + exception/dead-money logic (Phase 5a), and it **triggers a hard cap** (Phase 4 event-state).

**Adds:**
- **Sign-and-trade** mechanics: instantiate a new contract for a free agent *and* move them in a single atomic transaction, subject to matching, apron restrictions, and the hard-cap trigger.

**Out of scope for this phase:** still no CPU initiative. New *rules* are essentially complete after this; the remaining phases are about *agency* — who initiates moves and how well.

**Why its own phase:** it touches every validator and every financial structure at once. If it shares a migration and a calibration sign-off with 5a, a failure anywhere in the stack surfaces as "sign-and-trade is broken" with a huge blast radius. Isolated, it's the clean final assembly check on the financial rules.

**Establishes:** the financial-rules layer is feature-complete and proven to compose. After this the *rules* are essentially complete; the remaining phases are about *agency*.

---

## Phase 5c — League-balance harness (infrastructure, not a feature)

**Goal:** build the long-horizon acceptance test **before** the feature that needs it, and **baseline it on the current trade-free league** so you know the metrics' resting values before any trade AI can move them.

This is the transaction layer's analog of `npm run calibrate`: single-game profiling can stay perfectly flat while a decade of AI trades quietly wrecks competitive balance. That failure is invisible to `profile`/`calibrate` and needs its own tool.

**Adds (a `tsx scripts/` tool, e.g. `scripts/league-balance.ts`):**
- Sim **N seasons** (N tunable; default large enough to expose drift) on a fixed seed, with a flag to enable/disable AI trades.
- Compute and report, per run:
  - **Talent dispersion** — spread/Gini of team talent over time.
  - **Championship / playoff distribution** — entropy of titles and playoff appearances across teams.
  - **Trade-churn metrics** — volume, and the oscillation/value-pump signals defined in the cross-cutting invariants.
- Emit a machine-comparable summary so two runs can be diffed.

**Baseline first:** run it with **AI trades disabled** (the world as of Phase 5b) and record the resting values. These are the control. When Phase 6 turns trades on, the assertion is "balance metrics stay within tolerance of the trade-free baseline," not "balance looks plausible" — you can't eyeball decade-scale drift.

**Out of scope:** any trade-AI logic. This phase only *measures*; Phase 6 supplies the thing being measured. Building the harness here keeps it from being half-born inside the Phase 6 feature prompt.

**Establishes:** the multi-season acceptance test, with a known baseline, ready for Phase 6 to be judged against.

---

## Phase 6 — Trade AI (CPU valuation)

**Goal:** swap in the `evaluateTradeForCpu` stub. Only viable now because Phases 2–5 gave the AI something to reason about (player value, contract value, cap fit, team needs).

**Adds:**
- **Player valuation model** — a trade-value number per player from ratings, age, potential (`derivePotential` output is a natural input), and **contract** (salary vs. production: a good player on a bad contract is worth less). This is the basketball-judgment core and **deserves its own calibration pass.**
- **Team-context valuation** — the same player is worth more to a team that needs the position/role. **Reuse the lineup-fit and positional-scarcity logic from the sim engine** rather than inventing a parallel notion of value.
- **Acceptance logic** — CPU accepts iff incoming value ≥ outgoing value by a threshold **and** the trade is cap-legal (Phase 4 gate) **and** it improves or doesn't harm its situation. Reject *with a reason*.
- **Counter-offers** (optional stretch) — propose an adjustment instead of binary accept/reject.

**Out of scope for this phase:** the CPU still doesn't *initiate*. It only evaluates trades put in front of it. Proactive proposals are Phase 7.

**Trade-value is a derived analytic — keep it out of the rating pipeline.** It must never feed back into the sim's player ratings, or it will perturb calibration. It reads ratings; it does not write them.

**Acceptance is the Phase 5c league-balance harness, re-run with AI trades enabled.** Assert all metrics stay within tolerance of the trade-free baseline recorded in 5c. The specific degeneracy guards are defined in the cross-cutting invariants (value-pump / Pareto-sanity). Trade AI can wreck league balance over a simulated decade even if single-game sim is untouched — this multi-season check is the transaction layer's analog of `npm run calibrate`.

**Establishes:** CPU teams can now reason about value.

---

## Phase 7 — AI-initiated trades & the transaction ecosystem

**Goal:** the league becomes alive independent of the player.

**Adds:**
- **CPU proposal generation** — teams proactively propose trades to each other and to the controlled team, driven by team-context valuation and needs.
  > **Proposal generation is its own concern, distinct from evaluation (Phase 6).** The search space is combinatorially explosive — do **not** brute-force all combinations. Bound it with heuristics (target teams with complementary surplus/need, cap-compatible partners first).
- **CPU free-agent signing** during the offseason (Phase 6 valuation + Phase 4 cap room).
- **Trade-deadline behavior** — contenders buy, rebuilders sell (the value-driven layer on top of the Phase 4 temporal-legality gate).
- **Offer inbox** for the controlled team (incoming proposals to accept / reject / counter).

**Out of scope for this phase:** no new *rules*. This is agency on top of the Phase 4–6 machinery, not new legality or financial logic.

**Establishes:** transactions are no longer player-driven only. This is what makes a franchise mode feel like a living league. Re-run the Phase 5c league-balance harness with proactive trading on — proposal generation is a new way to introduce churn and degeneracy.

---

## Phase 7.5 — Restricted free agency

**Goal:** the mechanism by which most good young players actually get paid. Sequenced after Phase 7 because it needs CPU agency (offer sheets are CPU-driven), but called out as a **real phase, not a deferred maybe** — a franchise mode without RFA is not credible, and "deferred" mechanics have a way of never shipping.

**Adds:**
- **Qualifying offers** — a team tenders a QO to make its outgoing player a *restricted* free agent (vs. unrestricted). Keys off the Phase 2 cap-hold stub.
- **Offer sheets** — rival teams (incl. CPU, via Phase 6 valuation + Phase 7 agency) extend offer sheets to RFAs.
- **Right of first refusal / matching** — the original team may match the offer sheet within a window and retain the player. A new legality-adjacent decision point on the controlled team; a Phase 6-valuation decision for the CPU.

**Depends on:** cap holds (Phase 2 stub → Phase 3 wiring), FA signing flow (Phase 2/4), CPU agency (Phase 7).

**Out of scope:** poison-pill contract structuring and other RFA exotica — model the core QO → offer-sheet → match loop first.

**Establishes:** young-player retention works the way the real NBA's does; the FA market is no longer purely unrestricted.

---

## Phase 8 — The draft

**Goal:** sequenced late because a meaningful draft depends on most prior machinery — rookie-scale contracts (Phase 2), cap holds for picks, draft-pick *assets* that can themselves be traded (extends the trade engine to non-player assets — a real structural addition, cheap **if** you asset-typed the payload in Phase 1), and prospect valuation (an extension of Phase 6).

**Adds:**
- **Draft-pick assets** as tradeable entities in `SeasonState` — the big new state shape. Slots cleanly into `TradeAsset[]` if you took that fork in Phase 1; otherwise this is where the trade-engine refactor lands.
- **Prospect generation + scouting uncertainty** — potential known only fuzzily (a natural fit for the existing potential model **with noise**; the noise goes through `SeededRNG`).
- **Draft event** in the season cycle; **rookie-scale auto-contracts** on selection.
- **Pick protections / swaps** — the genuinely fiddly part. Model as predicates, the same way apron rules are isolated. Include the **Stepien rule** (no trading consecutive future first-rounders) as one such predicate, and treat **pick swaps** as a distinct asset type from outright **pick conveyance**.

**Out of scope for this phase:** keep scouting uncertainty as fuzz over the existing potential model — don't build a parallel prospect-rating system.

---

## Deferred / unlisted mechanics (conscious omissions)

Acknowledged here so they're *decisions*, not surprises. None block the main arc; slot them in when appetite allows.

> Restricted free agency is now **Phase 7.5**, not deferred.

- **Waiver wire / claims** — the real version of Phase 1's collapsed cut: a waiver period where other teams (incl. CPU) can claim the player and assume the contract before they reach the FA pool. Natural home: Phase 5a (contract lifecycle) for the mechanic + Phase 7 for CPU claim behavior.
- **Cash considerations in trades** — teams can include cash (capped annually). A `TradeAsset` type; another reason to asset-type the payload.
- **10-day / hardship contracts** and other in-season signing nuances — likely out of scope; listed for completeness.

---

## Cross-cutting invariants (apply to every phase)

- **One canonical source of truth per fact.** Payroll derives from contracts; cap status derives from payroll; dead money derives from (contract + cut event). Never store a derived number you must keep in sync. The known exceptions are **event-set state** (hard-cap status, injuries) — store those, and label them as such.
- **Validators compose.** Roster-legality, cap-legality, apron-legality, temporal/NTC are separate predicate sets unified into one atomic validate-then-mutate gate, each returning a unified reason. Resist nesting.
- **Legality ≠ desirability, permanently.** Deterministic shared legality lives in the gate; AI valuation lives in `evaluateTradeForCpu`. Phase 1 establishes the chokepoint; Phase 4 fills in legality; Phase 6 fills in desirability.
- **Asset-typed trade payload.** A trade carries typed assets (players now; picks, cash, swaps later). Decide this in Phase 1.
- **Deterministic everything.** Migration contracts, draft prospects, AI tie-breaks — all through `SeededRNG`, seeded from stable keys so they're reproducible and idempotent. Transactions themselves stay deterministic.
- **Migration every phase.** Every phase adding persisted state ships a migration from the prior schema **and** a `scripts/` round-trip check. Schema bumps are cheap; silently broken old saves are not.
- **Two calibration horizons.** Single-game (`profile` / `calibrate`) must stay flat through every phase — none touch the sim. From Phase 6 on, the **multi-season league-balance check** (Phase 5c harness) is the transaction layer's real acceptance test.
- **CBA numbers are tunable constants, sourced at implementation.** Matching bands, apron/tax thresholds, exception amounts — named constants in `constants.ts`, taken from the current CBA when written, never hardcoded from memory.
- **No value-pump loops (shared-valuation Pareto sanity).** The classic trade-AI failure is asymmetric valuation: each team scores the *same* deal as a win using its *own* model, and value is conjured from nothing. A pairwise "repeated reversing trades" check is **insufficient** — it misses two real laundering paths:
  - **Cyclic laundering:** A→B→C→A. No pair ever reverses; value still pumps around the loop.
  - **Slow asymmetric bleed:** many distinct, non-reversing deals that each leak a little value in a consistent direction.

  The correct guard is a **single shared valuation function** as the referee:
  - Every executed trade must be **Pareto-sane under one shared model** — by a neutral valuation, no party comes out meaningfully behind, and the deal does **not** increase total league value (value is conserved or moved, never created). If *both* teams show a gain under the *same* model, that asymmetry is the bug, and the trade is denied.
  - The per-team `evaluateTradeForCpu` desirability model may still differ (that's what makes teams *want* different deals) — but legality/sanity is judged by the shared model, consistent with **legality ≠ desirability**.
  - Keep the cheap guards too, as defense in depth: rate-limit churn, and flag reversing/cyclic patterns between the same small set of teams. But treat them as symptoms; the shared-valuation Pareto check is the actual invariant.

  The Phase 5c league-balance harness asserts the **absence** of net league-value creation over N seasons as an explicit, machine-checked assertion — not just bounded dispersion.

---

## Phase sequencing (quick reference)

```
Phase 1    Roster transaction layer
Phase 2    Contracts
Phase 3    Salary cap & financial state (compute only)
Phase 4    Salary matching & cap enforcement
Phase 5a   Dead money, exceptions & contract lifecycle
Phase 5b   Sign-and-trade (composition stress test)
Phase 5c   League-balance harness (infrastructure)
Phase 6    Trade AI (CPU valuation)
Phase 7    AI-initiated trades & ecosystem
Phase 7.5  Restricted free agency
Phase 8    The draft
```

---

## Per-phase acceptance checklist (paste into each Claude Code prompt)

```
Before this phase is done:
[ ] Read AGENTS.md and follow its hard rules.
[ ] npm run profile  — output UNCHANGED vs. an unmodified league (sim untouched).
[ ] npm run calibrate — historical-era comparison UNCHANGED.
[ ] Determinism: re-running the same seed produces identical results;
    new RNG goes through SeededRNG seeded from a stable key.
[ ] All new persisted state has: schema version bump + migration from prior version.
[ ] scripts/ round-trip check: load old save -> migrate -> assert invariants ->
    re-serialize; running migration twice is a no-op.
[ ] New validators are composable predicates returning a unified reason
    (not nested conditionals); legality stays separate from desirability.
[ ] No derived value is stored as an independent source of truth
    (exceptions: documented event-set state only).
[ ] (Phase 6+) Phase 5c multi-season league-balance check passes:
    talent dispersion bounded, championship distribution non-degenerate,
    no net league-value creation / value-pump / oscillating-trade loops.
[ ] Scope guard: nothing from a later phase was built early.
```
