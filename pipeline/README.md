# NBA data pipeline (Stage 0)

A standalone Python tool that harvests a large offline dataset from
stats.nba.com (via [nba_api](https://github.com/swar/nba_api)) into a raw
cache, then normalizes it into stable, versioned JSON contracts that the
TypeScript side reads. It is completely fenced off from the Next.js app:
never imported or invoked by TS code, never run in CI or at app runtime.
Run it manually, occasionally, **from a residential IP** — stats.nba.com
blocks datacenter IPs.

## Architecture

```
pipeline/            (committed)  harvester / normalizer / crosswalk code
data/nba/raw/        (gitignored) verbatim cached endpoint responses — the
                                  checkpoint/resume layer. Never hand-edit.
data/nba/normalized/ (gitignored) versioned JSON contracts, schema_version 1.
                                  The ONLY Python <-> TypeScript interface.
src/data/nba/        (committed)  TS types + reader for the contracts.
```

If the NBA changes an endpoint, only the Python side changes; the normalized
contracts stay stable. TypeScript never calls stats.nba.com.

## Setup

Requires Python 3.10+ (developed on Homebrew Python 3.12: `brew install python@3.12`).

```sh
/opt/homebrew/bin/python3.12 -m venv pipeline/.venv
pipeline/.venv/bin/pip install -r pipeline/requirements.txt
```

**Dependency note:** the only direct dependency is `nba_api` (1.11.4). Since
1.9.0 it hard-requires `pandas` + `numpy`, so they come along; our code never
imports pandas (all response handling uses the `.get_dict()` accessors, never
`.get_data_frames()`).

## Workflow

All commands run from the repo root.

```sh
# 1. Smoke test (~28 requests, a minute or two) — verifies the pipeline end to end
pipeline/.venv/bin/python pipeline/harvest.py --manifest pipeline/manifests/smoke.json

# 2. Full harvest (thousands of requests — run overnight; see estimate below)
pipeline/.venv/bin/python pipeline/harvest.py --manifest pipeline/manifests/default.json

# 3. Normalize the raw cache into contracts
pipeline/.venv/bin/python pipeline/normalize.py

# 4. Build the BDL/ESPN -> NBA personId crosswalk (optional; needs data/players.json)
pipeline/.venv/bin/python pipeline/crosswalk.py

# 5. Validate the contracts from the TS side
npm run validate-nba-data
```

### Resume / checkpointing

Every request is cached to `data/nba/raw/<season>/<group>/<param-key>.json`
before the next one is made. A killed run resumed with the same manifest
picks up exactly where it left off; re-running a completed harvest is a
no-op (`summary: 0 fetched, N skipped`). Failed requests are recorded to
`data/nba/raw/_failures.json` and the run continues — re-run the same
command to retry just the failures.

Flags: `--force` re-fetches cached files; `--limit N` caps new requests in a
run (safety valve for testing).

### Full-harvest time estimate

The default manifest is roughly: box_advanced 11×30 + shot_locations 30 +
synergy 20×11 + tracking 12×13 + pt_defend 6×13 + hustle 11 + lineups 2×19 +
matchups 9 + game_logs 3 + combine 26 ≈ **1,100 league-wide calls**, plus
`shot_charts` (~570 players × 3 seasons ≈ 1,700) and `pbp` (~1,230 games × 3
seasons ≈ 3,700). At ~1.1s/request that's **6,500+ requests ≈ 2–3 hours**,
dominated by pbp + shot_charts. It is safe to kill and resume at any point;
you can also harvest in slices with `--limit`.

### Rate limiting

0.9s between requests + 0–0.4s jitter (configurable per manifest via
`rate.base_seconds` / `rate.jitter_seconds`), exponential backoff up to 5
retries on timeouts / 429 / connection resets, 45s per-request timeout.

## Endpoint groups

Every endpoint class and parameter was verified against the installed
nba_api 1.11.4 (`pipeline/lib/endpoints.py`). Groups: `static`,
`player_index`, `box_advanced`, `shot_locations`, `game_logs`, `shot_charts`,
`synergy`, `tracking`, `pt_defend`, `hustle`, `lineups`, `matchups`, `pbp`,
`combine`. Season ranges differ per group because data availability differs —
see `manifests/default.json`.

Two deviations from the original coverage table, discovered against the live
API and worth knowing about:

- **player_index is one static call, not per-season.** With `Historical=0`
  the endpoint returns only currently-rostered players (offseason-broken);
  with `Historical=1` it returns the identical full all-time index regardless
  of the Season parameter. Per-season rosters therefore come from
  `box_advanced` (Base/Totals), joined with bio fields (height, weight,
  draft, position) from the single historical index.
- **box_advanced makes 11 calls/season, not 10:** Base×Per100Possessions was
  added because the `box_advanced` contract promises per-100 stats, which no
  PerGame/Totals combination carries.

## Shot-zone mapping (Stage 1: please review)

`shot_zones/<season>.json` maps the NBA's shot-location zones onto OTC's
five-zone taxonomy (full rationale in `pipeline/lib/zones.py`):

| NBA zone | OTC zone |
|---|---|
| Restricted Area | `rim` |
| In The Paint (Non-RA) | `short_midrange` |
| Mid-Range | `long_midrange` |
| Left / Right Corner 3 | `corner_three` |
| Above the Break 3 | `above_break_three` |
| Backcourt | `above_break_three` (heaves; negligible volume) |

Judgment call: this is the only assignment that populates all five OTC zones,
at the cost that OTC "rim" = Restricted Area only and the NBA's "Mid-Range"
(which spans OTC's short and long midrange) maps wholly to `long_midrange`.
The raw NBA zone columns are kept alongside the mapped ones so Stage 1/2 can
revisit the split (e.g. using `shot_events` distances) without re-harvesting.

## Normalized contracts (v1)

Every seasonal file has the envelope
`{ "schema_version": 1, "season": "2024-25", "rows": [...] }`.
Contracts: `players/`, `box_advanced/`, `shot_zones/`, `shot_events/`,
`playtypes/`, `tracking/`, `defense/`, `hustle/`, `lineups/`, `games/`,
`pbp/<season>/<gameId>.json`, `crosswalk.json`, `manifest.json`.
TS mirrors live in `src/data/nba/types.ts`; loaders in `src/data/nba/load.ts`.

`normalize.py` is a pure function of the raw cache: deterministic and
idempotent — running it twice on unchanged raw data produces byte-identical
output (rows sorted by stable keys, sorted JSON keys, no timestamps in
payloads; the single `generated_at` lives in `manifest.json`). Files over
50 MB are gzipped (`.json.gz`, gzip mtime pinned to 0); the TS loaders handle
both forms transparently. No derived analytics are computed here — rating
math and league targets are Stage 1/2 work.

## Crosswalk

`crosswalk.py` maps the current player pool (`data/players.json`, which holds
both `player_<bdlId>` BallDontLie ids and `espn_player_<n>` ESPN ids) to NBA
personIds by normalized name (accents stripped, Jr./III suffixes dropped),
disambiguated by team and rough age agreement. Manual fixes in
`pipeline/overrides/crosswalk_overrides.json` (keyed by full source id) win
over automatic matching. Output: `data/nba/normalized/crosswalk.json` plus a
printed match-rate report. If `data/players.json` doesn't exist the script
says so and exits cleanly — the crosswalk is optional, transitional
infrastructure for a later migration to NBA personIds for new leagues.
