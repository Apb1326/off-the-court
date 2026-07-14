# S2c1-R — Candidate Play-Type Selection Diagnosis

> **Frozen historical evidence (pre-S2d candidate evaluation).** Its generator was
> retired at S2d activation; the measurements below are preserved and are not a
> current executable regeneration contract. The observer was read-only, consumed no
> RNG, and left the canonical denominator unchanged.

## Provenance

- Repository commit: **21fe8e6f23ec577a52f56d5ee039113f63647b18**.
- Candidate input: **/Users/atticusboyle/Desktop/Claude Code/OffTheCourt/data/league-candidate**.
- Fixed full-season seed: **2026**; candidate selection mode is explicitly enabled; schedule and game-seed stream mirrors profile-engine.ts.
- Candidate pool build/check prerequisite: `69b152a` landing series (`849c2fa`, `7a8bddd`, `69b152a`).
- Synergy source: normalized 2025-26 playtypes, mapped categories with Misc excluded.

## Denominator audit

- Engine canonical terminal denominator: **280912** events = made shots + missed shots + and-ones + turnovers.
- Excluded engine events: foul 42955.
- Harvested Synergy mapped possession mass: **220485.0** across the mapped offensive categories; Misc and unmapped categories are excluded.
- The two universes are not row-for-row identical (Synergy is player/category possession mass; the engine is terminal emitted events), but they are the closest reproducible comparison already used by the Stage-1 informational report. No denominator change is made.

## Derived roster tendency mass

The first row is a rostered-player usage-weighted proxy for the derived tendency mass. The second weights each player by observed simulated primary-player opportunities; neither is a simple player mean.

| Weighting           | isolation | pick_and_roll | post_up | spot_up | transition | cut  | off_screen | handoff |
| ------------------- | --------- | ------------- | ------- | ------- | ---------- | ---- | ---------- | ------- |
| Roster usage        | 7.5%      | 24.0%         | 3.8%    | 27.7%   | 20.3%      | 8.4% | 3.6%       | 4.7%    |
| Primary opportunity | 8.4%      | 24.4%         | 4.6%    | 25.5%   | 20.0%      | 8.0% | 4.3%       | 4.9%    |
| Synergy target      | 8.2%      | 25.4%         | 4.2%    | 25.6%   | 19.7%      | 7.3% | 4.1%       | 5.5%    |

## Primary actor distribution

- Primary-player opportunities observed: **288742**.
- Position shares: C 8.6%, PF 12.2%, PG 39.5%, SF 27.8%, SG 11.9%.
| Top primary actors | Share |
| ------------------ | ----- |
| nba_1630162        | 0.8%  |
| nba_1628378        | 0.8%  |
| nba_1628983        | 0.8%  |
| nba_1628973        | 0.7%  |
| nba_201939         | 0.7%  |
| nba_1630595        | 0.7%  |
| nba_202695         | 0.7%  |
| nba_201142         | 0.7%  |
| nba_1626164        | 0.7%  |
| nba_1629029        | 0.7%  |
| nba_1630178        | 0.7%  |
| nba_1629008        | 0.6%  |

## Initial selection

### Initial all-possession distribution

| Play type     | Share | Synergy | Delta  |
| ------------- | ----- | ------- | ------ |
| isolation     | 8.0%  | 8.2%    | -0.2pp |
| pick_and_roll | 25.4% | 25.4%   | +0.0pp |
| post_up       | 4.5%  | 4.2%    | +0.3pp |
| spot_up       | 26.0% | 25.6%   | +0.4pp |
| transition    | 20.0% | 19.7%   | +0.4pp |
| cut           | 8.4%  | 7.3%    | +1.1pp |
| off_screen    | 3.6%  | 4.1%    | -0.4pp |
| handoff       | 4.0%  | 5.5%    | -1.5pp |

### Non-transition selector factors

| Play type     | N     | Tendency | Derived weight | System | Position | Situation | Final weight |
| ------------- | ----- | -------- | -------------- | ------ | -------- | --------- | ------------ |
| isolation     | 23110 | 0.096    | 0.096          | 0.960  | 1.013    | 1.001     | 0.093        |
| pick_and_roll | 73349 | 0.258    | 0.258          | 1.025  | 1.024    | 1.001     | 0.271        |
| post_up       | 13016 | 0.071    | 0.071          | 0.925  | 0.981    | 1.000     | 0.065        |
| spot_up       | 74968 | 0.267    | 0.267          | 1.025  | 0.992    | 1.011     | 0.275        |
| cut           | 24326 | 0.105    | 0.105          | 0.950  | 1.003    | 1.000     | 0.100        |
| off_screen    | 10488 | 0.056    | 0.056          | 0.938  | 0.948    | 1.010     | 0.050        |
| handoff       | 11678 | 0.054    | 0.054          | 0.913  | 0.971    | 1.000     | 0.048        |

### Terminal emitted-event distribution

| Play type     | Share | Synergy | Delta  |
| ------------- | ----- | ------- | ------ |
| isolation     | 8.0%  | 8.2%    | -0.2pp |
| pick_and_roll | 25.4% | 25.4%   | -0.0pp |
| post_up       | 4.4%  | 4.2%    | +0.2pp |
| spot_up       | 26.1% | 25.6%   | +0.5pp |
| transition    | 20.0% | 19.7%   | +0.4pp |
| cut           | 8.3%  | 7.3%    | +1.0pp |
| off_screen    | 3.6%  | 4.1%    | -0.4pp |
| handoff       | 4.0%  | 5.5%    | -1.5pp |

### Initial → terminal transformation matrix

| Initial type  | Attempts | isolation | pick_and_roll | post_up | spot_up | transition | cut    | off_screen | handoff |
| ------------- | -------- | --------- | ------------- | ------- | ------- | ---------- | ------ | ---------- | ------- |
| isolation     | 22370    | 100.0%    | 0.0%          | 0.0%    | 0.0%    | 0.0%       | 0.0%   | 0.0%       | 0.0%    |
| pick_and_roll | 71314    | 0.0%      | 100.0%        | 0.0%    | 0.0%    | 0.0%       | 0.0%   | 0.0%       | 0.0%    |
| post_up       | 12491    | 0.0%      | 0.0%          | 100.0%  | 0.0%    | 0.0%       | 0.0%   | 0.0%       | 0.0%    |
| spot_up       | 73411    | 0.0%      | 0.0%          | 0.0%    | 100.0%  | 0.0%       | 0.0%   | 0.0%       | 0.0%    |
| transition    | 56313    | 0.0%      | 0.0%          | 0.0%    | 0.0%    | 100.0%     | 0.0%   | 0.0%       | 0.0%    |
| cut           | 23420    | 0.0%      | 0.0%          | 0.0%    | 0.0%    | 0.0%       | 100.0% | 0.0%       | 0.0%    |
| off_screen    | 10228    | 0.0%      | 0.0%          | 0.0%    | 0.0%    | 0.0%       | 0.0%   | 100.0%     | 0.0%    |
| handoff       | 11365    | 0.0%      | 0.0%          | 0.0%    | 0.0%    | 0.0%       | 0.0%   | 0.0%       | 100.0%  |

- A pass replaced the initial action before a shot in **126800** of **250005** observed shot terminals (50.7%). Turnover-chain passes are retained in the matrix but do not have a shot pass-count callback.
- Initial turnovers: isolation 3574, pick_and_roll 11276, post_up 1826, spot_up 6120, transition 11226, cut 2327, off_screen 948, handoff 1442.
- Terminal turnovers: isolation 3574, pick_and_roll 11276, post_up 1826, spot_up 6120, transition 11226, cut 2327, off_screen 948, handoff 1442.

## Transition routing

- Transition opportunity rate: **20.0%** of initial selections; terminal transition share: **20.0%**; Synergy: **19.7%**; real transition-FGA timing proxy: **18.9%**.
- Upstream eligible causes: turnover **34266**, long rebound **82308**, both **0**, any eligible **116574**; opportunities **57809**.
- Candidate transitionFreq is consumed conditionally by the existing upstream turnover/long-rebound gate; it is not added to the ordinary weighted-choice list, so there is no double count.

## Fallback influence

- Players listed with positional play-type fallback: **190**; rostered simulation players: **450**.
- Fallback ball-handler initiation share: **6.1%**; fallback primary/terminal share: **4.8%**.


### Physical finisher action matrix (shot terminals)

The emitted matrix above is the candidate possession-level label used for the Synergy comparison. This second matrix retains the physical finisher action selected by the unchanged receiver/chain path, so the diagnostic does not hide the chain transformation or alter shot-zone lookup semantics.

| Initial type  | Shot terminals | isolation | pick_and_roll | post_up | spot_up | transition | cut   | off_screen | handoff |
| ------------- | -------------- | --------- | ------------- | ------- | ------- | ---------- | ----- | ---------- | ------- |
| isolation     | 19536          | 87.1%     | 0.0%          | 0.0%    | 7.0%    | 0.0%       | 4.6%  | 0.0%       | 1.3%    |
| pick_and_roll | 62073          | 26.1%     | 30.2%         | 0.0%    | 22.7%   | 0.0%       | 16.2% | 0.0%       | 4.9%    |
| post_up       | 11190          | 10.8%     | 0.0%          | 70.1%   | 10.0%   | 0.0%       | 6.9%  | 0.0%       | 2.1%    |
| spot_up       | 68848          | 13.7%     | 0.0%          | 0.0%    | 75.3%   | 0.0%       | 8.5%  | 0.0%       | 2.5%    |
| transition    | 46583          | 21.6%     | 0.0%          | 0.0%    | 20.1%   | 40.1%      | 13.9% | 0.0%       | 4.2%    |
| cut           | 21999          | 15.1%     | 0.0%          | 0.0%    | 13.5%   | 0.0%       | 68.5% | 0.0%       | 2.9%    |
| off_screen    | 9540           | 25.8%     | 0.0%          | 0.0%    | 22.6%   | 0.0%       | 16.5% | 30.3%      | 4.9%    |
| handoff       | 10236          | 24.1%     | 0.0%          | 0.0%    | 21.5%   | 0.0%       | 16.1% | 0.0%       | 38.4%   |

## Team-level variation

### transition team shares

- Mean **20.0%**; SD **2.9%**.

| Bottom five | Share |
| ----------- | ----- |
| SAC         | 12.6% |
| GSW         | 16.7% |
| BOS         | 16.8% |
| PHX         | 17.5% |
| DEN         | 17.9% |
| Top five    | Share |
| MIA         | 28.9% |
| TOR         | 25.1% |
| SAS         | 23.3% |
| MEM         | 23.2% |
| DET         | 22.1% |

### isolation team shares

- Mean **8.0%**; SD **2.1%**.

| Bottom five | Share |
| ----------- | ----- |
| BKN         | 5.2%  |
| TOR         | 5.3%  |
| UTA         | 5.5%  |
| ATL         | 5.6%  |
| IND         | 5.6%  |
| Top five    | Share |
| PHI         | 12.0% |
| NOP         | 11.7% |
| OKC         | 11.1% |
| CLE         | 11.0% |
| BOS         | 10.7% |

### pick_and_roll team shares

- Mean **25.4%**; SD **5.3%**.

| Bottom five | Share |
| ----------- | ----- |
| MIA         | 10.7% |
| BKN         | 16.8% |
| UTA         | 18.6% |
| TOR         | 19.1% |
| GSW         | 19.5% |
| Top five    | Share |
| CHI         | 33.7% |
| SAC         | 32.9% |
| PHX         | 32.0% |
| WAS         | 31.6% |
| MEM         | 30.6% |

### spot_up team shares

- Mean **26.1%**; SD **4.2%**.

| Bottom five | Share |
| ----------- | ----- |
| SAC         | 17.6% |
| LAL         | 21.0% |
| DEN         | 21.3% |
| IND         | 21.9% |
| BOS         | 22.7% |
| Top five    | Share |
| MIA         | 36.5% |
| BKN         | 35.6% |
| POR         | 33.3% |
| MEM         | 31.4% |
| LAC         | 30.3% |

## Required diagnosis conclusion

- **isolation:** initial 8.0% (-0.2pp), terminal 8.0% (-0.2pp); the matrix and factor row above separate selector mass from chain transformation.
- **pick_and_roll:** initial 25.4% (+0.0pp), terminal 25.4% (-0.0pp); the matrix and factor row above separate selector mass from chain transformation.
- **post_up:** initial 4.5% (+0.3pp), terminal 4.4% (+0.2pp); the matrix and factor row above separate selector mass from chain transformation.
- **spot_up:** initial 26.0% (+0.4pp), terminal 26.1% (+0.5pp); the matrix and factor row above separate selector mass from chain transformation.
- **cut:** initial 8.4% (+1.1pp), terminal 8.3% (+1.0pp); the matrix and factor row above separate selector mass from chain transformation.
- **off_screen:** initial 3.6% (-0.4pp), terminal 3.6% (-0.4pp); the matrix and factor row above separate selector mass from chain transformation.
- **handoff:** initial 4.0% (-1.5pp), terminal 4.0% (-1.5pp); the matrix and factor row above separate selector mass from chain transformation.
- **Transition routing:** the candidate gate produced 20.0% opportunities from 116574 eligible possessions; the candidate's transitionFreq is consumed conditionally on those existing turnover/long-rebound precursors, yielding terminal 20.0% versus Synergy 19.7%.
- **Isolation/cut excess and PnR deficit:** the measured non-transition selector factors and initial→terminal matrix show whether the mismatch is introduced by the ball-handler tendency interpretation, position/system multipliers, or receiver-chain replacement; no repair is made in this diagnostic phase.

## Active-pool no-drift reference

- profile stdout SHA-256: **7482a68d7859ff8c8f962832ff4978ba32621c700594fd4deae785e82759e95a** (exit 0)
- profile stderr SHA-256: **e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855**
- calibrate stdout SHA-256: **a9f79617711614e8199ee43e48f3f74e4ef16fb6fc9379f3a62f6c41a14b90e4** (exit 0)
- calibrate stderr SHA-256: **e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855**

## Verdict

- This generated artifact records measurements and provenance only; it makes no phase-status claim. Current status and interpretation live in `docs/ROADMAP.md` (§3.2, §4.2) and `docs/PROJECT_STATUS.md`; the S2c1-R acceptance record is `docs/S2C1_CANDIDATE_PROFILE.md` with its focused harness `scripts/test-s2c1-r.ts`.
