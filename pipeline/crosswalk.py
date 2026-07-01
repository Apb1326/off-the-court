#!/usr/bin/env python3
"""Build the transitional BDL-id <-> NBA-personId crosswalk.

Usage:
    python pipeline/crosswalk.py

Matches players in data/players.json (BallDontLie-derived ids of the form
"player_<bdlId>") to NBA personIds from the harvested static player index,
by normalized name, disambiguated by team and rough age agreement.
Manual fixes in pipeline/overrides/crosswalk_overrides.json win over
automatic matching. Writes data/nba/normalized/crosswalk.json and prints a
match-rate report.

This crosswalk is transitional: a later stage migrates new leagues to NBA
personIds as the canonical Player.id source. It touches nothing else.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.names import normalize_name
from lib.util import NORMALIZED_DIR, RAW_DIR, REPO_ROOT, SCHEMA_VERSION, read_json

PLAYERS_JSON = REPO_ROOT / "data" / "players.json"
TEAMS_JSON = REPO_ROOT / "data" / "teams.json"
OVERRIDES = Path(__file__).resolve().parent / "overrides" / "crosswalk_overrides.json"
BIO_INDEX_DIR = RAW_DIR / "_static" / "player_index"
OUT = NORMALIZED_DIR / "crosswalk.json"

MAX_AGE_DELTA = 2


def load_bio_rows() -> list:
    files = sorted(BIO_INDEX_DIR.glob("*.json"))
    if not files:
        print(f"no harvested player index at {BIO_INDEX_DIR}; "
              "run harvest.py (player_index group) first")
        raise SystemExit(1)
    raw = read_json(files[0])
    rs = raw["response"]["resultSets"][0]
    return [dict(zip(rs["headers"], row)) for row in rs["rowSet"]]


def main() -> int:
    if not PLAYERS_JSON.exists():
        print(f"{PLAYERS_JSON} does not exist — nothing to crosswalk. "
              "The crosswalk is optional infrastructure; this is fine.")
        return 0

    bdl_players = read_json(PLAYERS_JSON)
    teams = {t["id"]: t for t in read_json(TEAMS_JSON)} if TEAMS_JSON.exists() else {}
    overrides = read_json(OVERRIDES).get("overrides", {})

    bio_rows = load_bio_rows()
    by_name = defaultdict(list)
    for r in bio_rows:
        name = normalize_name(f"{r.get('PLAYER_FIRST_NAME','')} {r.get('PLAYER_LAST_NAME','')}")
        by_name[name].append(r)

    rows, unmatched = [], []
    for p in bdl_players:
        # The pool holds two id families: "player_<bdlId>" (BallDontLie) and
        # "espn_player_<n>" (ESPN-sourced). bdlId is null for the latter;
        # sourceId is the authoritative key.
        source_id = str(p["id"])
        bdl_id = (int(source_id.replace("player_", ""))
                  if source_id.startswith("player_") else None)
        display = f"{p.get('firstName','')} {p.get('lastName','')}".strip()

        if source_id in overrides:
            rows.append({"sourceId": source_id, "bdlId": bdl_id,
                         "nbaPersonId": overrides[source_id],
                         "name": display, "matchMethod": "override"})
            continue

        candidates = by_name.get(normalize_name(display), [])
        method = None
        if len(candidates) == 1:
            match, method = candidates[0], "name"
        elif len(candidates) > 1:
            # Disambiguate by current team abbreviation, then recency
            team_abbr = (teams.get(p.get("teamId"), {}) or {}).get("abbreviation")
            by_team = [c for c in candidates if c.get("TEAM_ABBREVIATION") == team_abbr]
            if len(by_team) == 1:
                match, method = by_team[0], "name+team"
            else:
                # Rough age agreement: TO_YEAR - (age at ingest) ~ draft era.
                # BDL age and FROM_YEAR give an expected debut year.
                age = p.get("age")
                if age is not None:
                    expected_debut = 2025 - (age - 19)  # rough rookie age of 19
                    scored = sorted(
                        (c for c in candidates if c.get("FROM_YEAR") is not None),
                        key=lambda c: abs(int(c["FROM_YEAR"]) - expected_debut))
                    if scored and abs(int(scored[0]["FROM_YEAR"]) - expected_debut) <= MAX_AGE_DELTA + 2:
                        match, method = scored[0], "name+age"
        if method is None:
            unmatched.append({"sourceId": source_id, "bdlId": bdl_id,
                              "name": display, "teamId": p.get("teamId"),
                              "age": p.get("age")})
            continue
        rows.append({"sourceId": source_id, "bdlId": bdl_id,
                     "nbaPersonId": match["PERSON_ID"],
                     "name": display, "matchMethod": method})

    rows.sort(key=lambda r: r["sourceId"])
    unmatched.sort(key=lambda r: r["sourceId"])
    NORMALIZED_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"schema_version": SCHEMA_VERSION, "rows": rows,
                   "unmatched": unmatched},
                  f, ensure_ascii=False, sort_keys=True, indent=1)
        f.write("\n")

    total = len(bdl_players)
    rate = len(rows) / total * 100 if total else 0.0
    by_method = defaultdict(int)
    for r in rows:
        by_method[r["matchMethod"]] += 1
    print(f"crosswalk: {len(rows)}/{total} matched ({rate:.1f}%) -> {OUT}")
    for m, n in sorted(by_method.items()):
        print(f"  {m}: {n}")
    if unmatched:
        print(f"  unmatched ({len(unmatched)}):")
        for u in unmatched:
            print(f"    {u['sourceId']}: {u['name']} (team {u['teamId']}, age {u['age']})")
        print("  add fixes to pipeline/overrides/crosswalk_overrides.json and re-run.")
    if rate < 95.0:
        print("WARNING: match rate below 95% — investigate before relying on this crosswalk.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
