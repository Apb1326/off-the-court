# Off the Court — Transactions Roadmap

> **Status:** living, implementation-aligned design doc. Phases 1–5b are
> implemented on `main`; the current save schema is v6. Phase 5c is the next transaction
> phase, after the franchise prerequisites in `docs/ROADMAP.md`. Read alongside
> `AGENTS.md` (hard engineering rules) and the master roadmap — this document does not
> restate those rules. Where documents conflict, `AGENTS.md` wins.

---

## How to use this document (coding agents, read first)

Transactions are a **state-mutation layer on top of `SeasonState`**. The hard part is almost never the move itself — it is the invariant each new rule imposes on *every prior move*. Cap rules don't just gate new trades; they retroactively constrain cuts, signings, and the trade engine that already shipped.

**Sequencing principle:** each phase adds **one constraint dimension** and re-validates the whole transaction surface against it. Ship phases incrementally and independently.

**Every phase, before it is considered done:**

1. `npm run profile` and `npm run calibrate` pass **unchanged** on an unmodified league. No phase here touches the sim, so single-game distributions must stay flat. A diff in profiling output is a bug, not an expected side effect.
2. Any new persisted state ships a **schema bump + migration** from the prior version **and** a `scripts/` round-trip check (load old save → migrate → assert invariants → re-serialize).
3. All generated data and tie-breaks go through `SeededRNG`. Never `Math.random`. Transactions themselves are deterministic.

A copy-paste acceptance checklist is at the end of this doc.

### Current implementation snapshot

| Phase | Status | Primary executable acceptance |
|---|---|---|
| 1 — roster transactions | Implemented | `scripts/test-transactions.ts` |
| 2 — contracts | Implemented | `scripts/test-contract-migration.ts` |
| 3 — financial state | Implemented | `scripts/test-cap-status.ts` |
| 4 — cap enforcement | Implemented | `scripts/test-phase4.ts` |
| 5a — consequences/lifecycle | Implemented | `scripts/test-phase5a.ts` |
| 5b — sign-and-trade | Implemented | `scripts/test-phase5b.ts` |
| 5c onward | Planned | Per-phase harnesses still to be built |

Completed phase sections are retained intentionally. They describe the shipped contract
that later phases must preserve, including approved game simplifications and integration
boundaries; they are not instructions to rebuild those phases.

---

## Architectural spine (read before touching any phase)

These decisions are load-bearing across the whole roadmap and are already embodied in the
Phase 1–5a implementation. Later phases extend these seams; they do not replace them.

### The three canonical structures (established Phase 1)

- **Free-agent pool** — the canonical home for every unsigned player. Not a flag on the player; a real pool in `SeasonState`. Everything that releases a player puts them here; everything that signs a player draws from here.
- **Append-only transaction log** — the canonical history. Never rewrite a log entry. When a later phase makes a past action financially consequential (e.g. Phase 5a dead money on a Phase 1 cut), the consequence is *derived* from the original immutable event, not patched into it.
- **The atomic validate-then-mutate gate** — the single chokepoint every transaction passes through. Validators run first and compose; mutation happens only if all pass; nothing is half-applied.

### Trade payload: typed asset list (implemented Phase 1)

Phase 1 made this decision: a trade carries `TradeAsset[]` per side, with construction
isolated in `src/transactions/assets.ts`. `player` is the only implemented kind today;
**draft picks** and **pick swaps** arrive in Phase 8, while **cash considerations** remain
deferred.

Later phases must extend the union and its constructor boundary rather than replacing the
payload with phase-specific player/pick fields.

### Legality ≠ desirability (permanent boundary)

Two **permanently distinct** things, established in Phase 1 and filled in later:

- **Legality** — a *deterministic, shared* predicate stack (roster-legality, then cap-legality, then apron-legality) living in the validate-then-mutate gate. Applies to **any** trade regardless of who proposed it, including controlled-team-proposed trades and both sides of a CPU trade.
- **Desirability** — the AI's valuation judgment, lives in `evaluateTradeForCpu`. A trade can be legal-but-undesirable or desirable-but-illegal.

> **Correction vs. earlier drafts:** legality is **not** a gate "inside" `evaluateTradeForCpu`. The CPU acceptance function is desirability-only and may assume legality has already passed (defensive re-check is fine, ownership is not). This keeps the chokepoint clean and means controlled-vs-controlled and one-sided validations still hit the legality stack.

### Derive, don't store — and the explicit exceptions

The default is the project rule: payroll derives from contracts, cap status derives from payroll, never persist a derived number you have to keep in sync. (Transactions-layer version of "stats derive from the `PlayByPlayEvent` stream.")

**But a few facts are genuinely event-set state, not derived, and must be persisted:**

- **Hard-cap status** (Phase 4) — *triggered* by certain transactions, not computable from current payroll (see Phase 4).
- **Banked Standard TPE grants** (Phase 5a) — creation is event-set. Remaining balance
  derives from the immutable grant and append-only usage records.
- **Operated-under-cap history** (Phase 5a) — a per-team, per-cap-year event-set fact used
  to determine Room MLE eligibility. Exception usage itself derives from sign entries.
- Injuries (already in `SeasonState`) are the existing precedent for this category.

Call these out explicitly wherever they appear so an agent doesn't try to "fix" them into derived getters.

---

## Phase 1 — Roster transaction layer

**Status:** Implemented. Save schema v2 introduced this layer.

**Goal:** move players between rosters with **roster-legality validation only**.

**Implemented shape:**
- `applyTrade`, `applySignFreeAgent`, and `applyCut` all use the immutable atomic gate.
- `SeasonState.freeAgentPool` is the canonical unsigned-player home and
  `SeasonState.transactionLog` is append-only. v1 → v2 empty-inits both collections.
- Trades use `TradeAsset[]` on both sides; `player` is currently the only asset kind.
  `playerAsset` / `buildTrade` isolate construction for later asset expansion.
- Standard rosters must remain between `ROSTER_MIN` (14) and `ROSTER_MAX` (15).
  Two-way players do not occupy a standard slot; separate two-way slot limits remain
  deferred.
- `evaluateTradeForCpu` is still the accept-all Phase 1 desirability stub. The shared gate
  remains authoritative for legality.

**Original phase boundary:** Phase 1 shipped with roster legality only. Contracts and all
financial constraints were added by later implemented phases and now also run through the
same gate.

**Establishes:** the free-agent pool (canonical home for unsigned players), the transaction log (canonical history), and `evaluateTradeForCpu` (the one desirability chokepoint). Every later phase plugs into these three, not around them.

**Notes / gotchas:**
- **Cut vs. waive remain collapsed.** A cut sends the player straight to the FA pool; there
  is no waiver/claim period. Phase 5a now derives dead money from the immutable cut
  snapshot, so the release is no longer financially free. The real waiver process remains
  deferred — see *Deferred mechanics*.
- **Roster-size constants govern the standard roster only.** Two-way slots (Phase 2+) are a separate category; don't let a future two-way flag silently change these counts.
- The gate intentionally still permits a zero-asset side and a 0-for-0 trade when the
  current legality stack allows it. The focused harness treats this as supported behavior.
- A trade updates rosters and `Player.teamId`, but does not yet reconcile rotation settings
  or split `SeasonState.playerStats` by team. That integration remains due before trades are
  exposed in franchise UI/season flow.

---

## Phase 2 — Contracts

**Status:** Implemented. Save schema v3 introduced the full contract model.

**Goal:** give players contracts. The single most load-bearing prerequisite for everything financial — no cap or trade valuation can exist until a player has a contract.

**Implemented shape:**
- Every player carries a `Contract` with `salarySchedule[]` (index 0 is the current
  season), derived years remaining, type, NTC flag, and at most one indexed player/team
  option. Contract and desired-contract validators enforce structural term limits.
- Free agents retain their previous contract as historical salary context and carry a
  separate `desiredContract`. Signing instantiates a flat salary schedule from that ask,
  records `contractSigned`, and clears the ask.
- Cuts snapshot the immutable `contractAtCut`, allowing later dead-money derivation
  without rewriting history.
- `normalizePlayersForSave` is the shared fresh-save/load boundary: it canonicalizes roster
  ownership, rebuilds the FA pool, generates missing desired contracts, and rejects missing
  or multiply-rostered players.
- v2 → v3 contract generation uses `SeededRNG(fnv1a(player.id))` per player, with explicit
  tier precedence (two-way → rookie scale → minimum → max → veteran). It is deterministic,
  idempotent, and independent of player-array ordering.
- Phase 2 created the contract data needed for cap holds. Current hold ownership is the
  explicit `birdRights` record added in Phase 4, not a numeric Phase 2 stub.

**Original phase boundary:** contracts were data-only in Phase 2. Payroll, holds,
matching, NTC enforcement, and option resolution were supplied by Phases 3–5a.

> **Shipped determinism contract:** migration and fresh-save normalization seed contract
> generation from `fnv1a(player.id)` on a dedicated per-player `SeededRNG`, so generation
> is idempotent and order-independent and never consumes a shared stream.
>
> **The hash is explicitly FNV-1a over the player ID.** It must remain:
> - **Stable across Node versions and platforms** — do not use any runtime- or engine-dependent hash, object iteration order, `Date`, or `Math.random`.
> - **Pure and string-domain** — same id string → same 32-bit (or wider) integer seed, forever.
> - **Defined once in shared code** and reused, not re-implemented per call site.
>
> Avoid: JS engine string-hash internals, `JSON.stringify` of an object whose key order isn't guaranteed, or any hash that folds in non-id fields that could change between migrations. The seed must be a function of the player id and nothing else.
>
> The `scripts/` round-trip check must assert **migration is a no-op when run twice** and that contracts are **identical across two independent migrations of the same pre-contract save** — this is what actually catches a non-stable hash.

**Calibration:** contracts don't touch the sim, so profile/calibrate stay flat.
`scripts/test-contract-migration.ts` round-trips pre-contract saves, validates all player
contracts, reverses player order to test stable generation, and verifies migration
idempotency.

**Notes:**
- **Two-way** remains one contract type, excluded from standard-roster counts and the
  standard financial model. A separate two-way roster collection and limited slot count
  are still deferred.
- **No-trade clause** and **options** are set here but *resolved/enforced* later (NTC enforcement → Phase 4 legality predicate; option resolution → Phase 5a rollover).
- The model intentionally supports one option only. It cannot represent both real
  rookie-scale team-option years, and signing currently creates flat schedules without
  raises.

**Establishes:** money exists. Phases 3–6 are all reactions to this.

---

## Phase 3 — Salary cap & roster financial state

**Status:** Implemented as a pure derived analytics layer; no schema bump was required.

**Goal:** give teams a financial position. **Compute and expose only — no enforcement.**

**Implemented shape:**
- `src/transactions/cap.ts` derives payroll and all financial views; no payroll or cap
  status is persisted. Standard-contract payroll excludes two-way salary.
- `CAP_RULES_YEAR` is `2025-26`; salary cap, minimum-team salary, tax, apron, rookie
  minimum, incomplete-roster, and hold values are named in `constants.ts`.
- The accounting bases are deliberately separate:
  - cap-room salary = active standard payroll + explicit-rights cap holds + charges below
    12 standard contracts + dead money (added by Phase 5a);
  - tax payroll = active standard payroll + dead money;
  - apron payroll = active standard payroll + dead money.
- A simplified hold is the greater of 150% of prior salary or the configured rookie
  minimum. Only a current free agent with explicit rights owned by that team creates one;
  seeded free agents without rights create no hold.
- `getTeamCapStatus`, `getTeamFinancialSummary`, and `getLeagueFinancialSummary` expose the
  derived result. `belowSalaryFloor` is analytic state, not an independent stored fact.

**Original phase boundary:** Phase 3 was compute-only and did not change transaction
legality. Phase 4 subsequently consumed its projections in the shared gate.

**Establishes:** the cap-status accessor that Phase 4 turns into a gate.

---

## Phase 4 — Salary matching & cap enforcement

**Status:** Implemented. Save schema v4 introduced explicit re-signing rights and supports
persisted hard-cap state.

**Goal:** the first phase that *constrains* the Phase 1 transaction engine. Trades get hard here.

**Implemented shape:**
- Trade matching chooses one deterministic mode per team: `room`, `standard`,
  `aggregated_standard`, or `expanded`. Room uses fully projected Team Salary; Standard
  uses one outgoing player's salary; aggregation and Expanded matching are separate
  mechanisms with named 2025-26 constants.
- The $0.25M trade allowance is removed when projected Team Salary is above the first
  apron. Aggregation is unavailable when projected apron payroll remains above the second
  apron; Expanded matching is unavailable when it remains above the first.
- Aggregation triggers a second-apron hard cap and Expanded matching triggers a
  first-apron hard cap. `Team.hardCappedAtApron` is persisted event-set state, can only
  become stricter, and is enforced on later trades and signings. Phase 5a added exception
  triggers; sign-and-trade remains Phase 5b.
- The intentionally conservative hard-cap basis is projected **Team Salary** (the broader
  cap-room basis, including holds, incomplete-roster charges, and now dead money), not the
  narrower apron-payroll basis. Preserve this approved game rule unless a later phase
  explicitly changes it.
- Cuts assign a deterministic Bird/Early Bird/Non-Bird proxy from contract type and league
  experience because team-tenure history does not yet exist. v3 → v4 reconstructs rights
  only from the latest applicable immutable cut snapshot.
- Signings support room, Bird, Early Bird, Non-Bird, and the configured minimum exception;
  the player's own hold is replaced rather than stacked.
- Trading is legal through the single configured deadline and fails closed on missing or
  invalid dates. NTC consent is modeled only for a player leaving the controlled team;
  CPU-side NTCs are treated as waived off-screen.
- Minimum-team-salary compliance is a **non-blocking warning** on successful trades,
  signings, and cuts. It is not a validator and does not reject the transaction.

**Out of scope for this phase:** the AI's opinion, sign-and-trade, and full real-CBA apron
mechanics beyond the modeled matching/aggregation predicates. Legality is deterministic
and shared; *whether the CPU wants the deal* stays in Phase 6.

**This phase most perturbs the validation architecture.** The atomic validate-then-mutate gate now runs a **financial validation pass alongside** the roster-legality pass. Keep them as **composable validators returning a unified reason**, not nested conditionals. The stack is roughly: roster-legality → cap-legality → apron-legality → temporal/NTC, each independently testable.

**Establishes:** trade legality is now a real, shared, deterministic function — the clean boundary the trade AI needs.

---

## Phase 5a — Dead money, exceptions & contract lifecycle

**Status:** Implemented. Save schema v5 introduced TPE grants and operated-under-cap
history.

**Goal:** the deterministic financial-consequence layer. Everything here is a rule the engine *applies*; nothing here requires composing the trade engine with contract instantiation. Ships before 5b because 5b stress-tests it.

**Implemented shape:**
- **Dead money and stretch:** `computeDeadMoney` derives charges from immutable cut
  snapshots in stable order. Unstretched contracts charge the corresponding schedule year;
  stretch spreads all modeled remaining salary evenly over `2n + 1` cap years starting in
  the cut year. Two-way contracts produce no dead money and cannot elect stretch. Dead
  money feeds the existing cap-room, tax, apron, projection, floor-warning, and hard-cap
  bases without collapsing them.
- **Banked Standard TPEs:** only a successful `standard` matching plan with unused incoming
  capacity creates a grant, using the deterministic highest-salary outgoing player (stable
  ID tie-break) as the source. Room, aggregated, and Expanded plans create no banked grant.
  Grants are append-only event-state; usage lives on immutable trade entries and remaining
  balance/expiry are derived. A grant expires exactly one calendar year after creation and
  may absorb one incoming standard-contract player per trade, then be reused in later
  trades until exhausted or expired. It is not combined with outgoing salary for that
  player. Use of a prior-cap-year TPE triggers a first-apron hard cap.
- **Signing exceptions:** the Non-Taxpayer MLE, Taxpayer MLE, Room MLE, and BAE are modeled
  with named 2025-26 amounts and maximum terms. Usage and partial balances derive from
  append-only sign entries. Teams with positive room must use room before an MLE/BAE;
  operated-under-cap history from successful room transactions governs later Room MLE
  availability. NTMLE/TMLE/Room MLE exclusivity is preserved, TMLE cannot coexist with BAE,
  and BAE cannot be used in consecutive cap years. NTMLE and BAE trigger the first-apron
  hard cap; TMLE triggers the second-apron hard cap; Room MLE triggers none.
- **Dates:** pure canonical-date helpers define July 1 cap years, cap-year offsets, and the
  February 29 anniversary rule used by dead money, TPEs, exception history, and rollover.
- **Contract lifecycle:** `processContractRollover` is a pure, tested transaction-layer
  seam. It advances salary schedules once, deterministically exercises favorable player or
  team options (equality exercises), releases declined/expired players with rights and
  desired contracts, appends lifecycle events in player-ID order, carries historical logs,
  grants, and prior exception history, and resets hard caps for the new league year.
- v4 → v5 empty-inits `tradeExceptions` and `teamExceptionStates`; legacy logs are never
  rewritten. Legacy operated-under-cap/exception use that cannot be reconstructed remains
  canonically absent.

**Approved game simplifications:** all salary in the cut snapshot, including an option
year, is treated as guaranteed; there are no buyouts, set-off reductions, September 1
distinction, or stretch ceiling. Signing-exception contracts stay flat. Disabled Player
Exception remains deferred.

**Out of scope for this phase:** sign-and-trade (Phase 5b), waiver claims, CPU initiative,
UI, and app/franchise rollover integration. The app currently has no offseason rollover
route or persisted controlled-franchise identity, so the pure seam is ready for a future
offseason/franchise-flow phase but is not wired into season advancement.

**Establishes:** the deterministic consequence model for the financial events currently in
game scope. Phase 5b subsequently supplied the composition test, and future franchise flow
must call the rollover seam before lifecycle behavior is user-facing.

---

## Phase 5b — Sign-and-trade (the composition stress test)

**Status:** Implemented. `scripts/test-phase5b.ts` is the focused executable acceptance
harness. The implementation composes the existing ledgers and validators without a new
persisted shape, so the save schema remains v6.

**Goal:** one mechanic, deliberately isolated, because it is **the integration test of the whole financial stack** — it composes the trade engine (Phase 1) + contract instantiation (Phase 2) + salary matching (Phase 4) + exception/dead-money logic (Phase 5a), and it **triggers a hard cap** (Phase 4 event-state).

**Shipped contract:**
- **Sign-and-trade** mechanics: instantiate a new contract for a free agent *and* move them in a single atomic transaction, subject to matching, apron restrictions, and the hard-cap trigger.

**Out of scope for this phase:** still no CPU initiative. The modeled core rules are
essentially complete after this; approved deferrals such as waiver claims and the Disabled
Player Exception remain outside that claim.

**Why its own phase:** it touches every validator and every financial structure at once. If it shares a migration and a calibration sign-off with 5a, a failure anywhere in the stack surfaces as "sign-and-trade is broken" with a huge blast radius. Isolated, it's the clean final assembly check on the financial rules.

**Establishes:** the modeled core financial-rules layer is proven to compose. After this,
the main arc shifts from rules to agency and long-horizon balance.

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

**Baseline first:** run it with **AI trades disabled** on the post-S2/F2/F3/F4/F5 world required by `docs/ROADMAP.md`, immediately before Phase 6, and record the resting values. These are the control. When Phase 6 turns trades on, the assertion is "balance metrics stay within tolerance of the trade-free baseline," not "balance looks plausible" — you can't eyeball decade-scale drift.

**Out of scope:** any trade-AI logic. This phase only *measures*; Phase 6 supplies the thing being measured. Building the harness here keeps it from being half-born inside the Phase 6 feature prompt.

**Establishes:** the multi-season acceptance test, with a known baseline, ready for Phase 6 to be judged against.

---

## Phase 6 — Trade AI (CPU valuation)

**Goal:** swap in the `evaluateTradeForCpu` stub. Only viable now because Phases 2–5 gave the AI something to reason about (player value, contract value, cap fit, team needs).

**Adds:**
- **Player valuation model** — a trade-value number per player from ratings, age, potential (`derivePotential` output is a natural input), and **contract** (salary vs. production: a good player on a bad contract is worth less). This is the basketball-judgment core and **deserves its own calibration pass.**
- **Team-context valuation** — the same player is worth more to a team that needs the position/role. **Reuse the lineup-fit and positional-scarcity logic from the sim engine** rather than inventing a parallel notion of value.
- **Acceptance logic** — `evaluateTradeForCpu` decides desirability only: accept when
  incoming value clears the outgoing-value threshold and fits the team's situation, and
  otherwise reject with a reason. The separate execution path still runs the shared Phase
  4/5a legality gate before mutation; do not duplicate or move legality into valuation.
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
- **Qualifying offers** — a team tenders a QO to make its outgoing player a *restricted*
  free agent (vs. unrestricted). Extend the explicit rights-owned cap-hold model shipped in
  Phases 3–4; do not revive the removed numeric stub.
- **Offer sheets** — rival teams (incl. CPU, via Phase 6 valuation + Phase 7 agency) extend offer sheets to RFAs.
- **Right of first refusal / matching** — the original team may match the offer sheet within a window and retain the player. A new legality-adjacent decision point on the controlled team; a Phase 6-valuation decision for the CPU.

**Depends on:** explicit rights-owned cap holds (Phases 3–4), FA signing flow (Phases
2/4/5a), and CPU agency (Phase 7).

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

- **Waiver wire / claims** — the real version of Phase 1's collapsed cut: a waiver period
  where other teams (incl. CPU) can claim the player and assume the contract before they
  reach the FA pool. This now requires a future contract-lifecycle extension plus Phase 7
  CPU claim behavior; it was not part of the completed Phase 5a scope.
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
- **No value-pump loops (shared base-value referee).** The classic trade-AI failure is asymmetric valuation plus repeated execution that transfers value systematically. A pairwise "repeated reversing trades" check is **insufficient** — it misses two real laundering paths:
  - **Cyclic laundering:** A→B→C→A. No pair ever reverses; value still pumps around the loop.
  - **Slow asymmetric bleed:** many distinct, non-reversing deals that each leak a little value in a consistent direction.

  The guard has three distinct checks under one versioned context-free base-value model:
  - **Bounded per-trade imbalance:** sent and received base totals must be within named absolute and relative tolerances. This is a fairness/exploit guard, not "value creation."
  - **Asset-universe conservation:** typed assets exist exactly once before and after execution and their summed context-free value is unchanged except for explicit transaction consequences. This catches duplication or mutation that truly creates value.
  - **Sequence flow:** Phase 5c tracks cumulative marked-at-trade-time transfers and value-bearing cycles. A cycle is not a failure merely because it exists; it fails when value transported around it exceeds tolerance or shows repeatable laundering.

  The per-team `evaluateTradeForCpu` desirability model may still differ, allowing legitimate fit-adjusted mutual gains. The base-value checks live in shared game-facing orchestration outside the legality gate; Phase 5c supplies the normative long-horizon anti-laundering assertion.

---

## Phase sequencing (quick reference)

```
Phase 1    Roster transaction layer                         IMPLEMENTED
Phase 2    Contracts                                        IMPLEMENTED
Phase 3    Salary cap & financial state (compute only)      IMPLEMENTED
Phase 4    Salary matching & cap enforcement                IMPLEMENTED
Phase 5a   Dead money, exceptions & contract lifecycle      IMPLEMENTED
Phase 5b   Sign-and-trade (composition stress test)         IMPLEMENTED
Phase 5c   League-balance harness (infrastructure)           PLANNED
Phase 6    Trade AI (CPU valuation)                         PLANNED
Phase 7    AI-initiated trades & ecosystem                  PLANNED
Phase 7.5  Restricted free agency                          PLANNED
Phase 8    The draft                                        PLANNED
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
    asset-universe value conserved, cumulative team value flow bounded,
    and no value-bearing laundering / oscillating-trade loops.
[ ] Scope guard: nothing from a later phase was built early.
```
