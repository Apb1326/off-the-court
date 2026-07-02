#!/usr/bin/env python3
"""Normalize the raw cache into versioned JSON contracts.

Usage:
    python pipeline/normalize.py

Pure function of data/nba/raw/: deterministic and idempotent — running twice
with unchanged raw data produces byte-identical output. Rows are sorted by
stable keys, JSON keys are sorted, and no timestamps appear inside data
payloads (a single raw-cache-derived generated_at lives in manifest.json only). Files over
50 MB are gzipped (.json.gz, mtime pinned to 0 for byte-stability).

No derived analytics here — flattening only. Rating math, league targets,
and aggregations are Stage 1/2 work. The manifest provenance timestamp is
derived from the raw cache rather than wall-clock time.
"""

import gzip
import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.util import NORMALIZED_DIR, RAW_DIR, SCHEMA_VERSION, read_json
from lib.zones import NBA_TO_OTC, OTC_ZONES

GZIP_THRESHOLD_BYTES = 50 * 1024 * 1024

# ---------------------------------------------------------------- helpers


def snake_to_camel(name: str) -> str:
    parts = name.lower().split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def rows_as_dicts(result_set: dict) -> list:
    headers = result_set["headers"]
    return [dict(zip(headers, row)) for row in result_set["rowSet"]]


def first_result_set(raw: dict, name: str = None) -> dict:
    sets = raw["response"]["resultSets"]
    if name is None:
        return sets[0]
    return next(s for s in sets if s.get("name") == name)


def pick(row: dict, cols: list) -> dict:
    """Select columns, camelCasing keys. Missing columns become None."""
    return {snake_to_camel(c): row.get(c) for c in cols}


def carry(row: dict, skip_cols: set) -> dict:
    """All columns except skip_cols and *_RANK noise, camelCased."""
    out = {}
    for k, v in row.items():
        if k in skip_cols or k.endswith("_RANK"):
            continue
        out[snake_to_camel(k)] = v
    return out


def season_raw_files(season: str, group: str) -> list:
    d = RAW_DIR / season / group
    return sorted(d.glob("*.json")) if d.is_dir() else []


def load_single(season: str, group: str, match: str = "") -> dict:
    files = [f for f in season_raw_files(season, group) if match in f.name]
    if not files:
        return None
    return read_json(files[0])


def write_contract(relpath: str, payload: dict) -> str:
    """Write a normalized contract; gzip if over the size threshold.

    Returns the relative path actually written. Removes a stale sibling
    (.json vs .json.gz) so re-runs converge to a single file.
    """
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")) + "\n"
    raw_bytes = data.encode("utf-8")
    plain = NORMALIZED_DIR / relpath
    gzipped = plain.with_suffix(plain.suffix + ".gz")
    plain.parent.mkdir(parents=True, exist_ok=True)
    if len(raw_bytes) > GZIP_THRESHOLD_BYTES:
        buf = io.BytesIO()
        # mtime=0 keeps the gzip header byte-stable across runs
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
            gz.write(raw_bytes)
        gzipped.write_bytes(buf.getvalue())
        if plain.exists():
            plain.unlink()
        return str(gzipped.relative_to(NORMALIZED_DIR))
    plain.write_bytes(raw_bytes)
    if gzipped.exists():
        gzipped.unlink()
    return str(plain.relative_to(NORMALIZED_DIR))


def envelope(season: str, rows: list, **extra) -> dict:
    return {"schema_version": SCHEMA_VERSION, "season": season, "rows": rows, **extra}


def feet_inches_to_cm(height: str):
    """'6-2' -> 188 (cm, rounded)."""
    if not height or "-" not in str(height):
        return None
    try:
        ft, inches = str(height).split("-")
        return round((int(ft) * 12 + int(inches)) * 2.54)
    except ValueError:
        return None


def lbs_to_kg(weight):
    try:
        return round(float(weight) * 0.453592, 1)
    except (TypeError, ValueError):
        return None


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def latest_raw_fetched_at():
    """Latest source-cache timestamp without loading every large response."""
    timestamps = []
    pattern = re.compile(rb'"fetched_at"\s*:\s*"([^"]+)"')
    for path in sorted(RAW_DIR.rglob("*.json")):
        if path.name == "_failures.json":
            continue
        with open(path, "rb") as f:
            match = pattern.search(f.read(1024))
        if match:
            timestamps.append(match.group(1).decode("utf-8"))
    return max(timestamps) if timestamps else None


# ------------------------------------------------------------- contracts


def load_bio_index() -> dict:
    """personId -> bio row from the static Historical=1 PlayerIndex harvest.

    The per-season roster comes from box_advanced (the PlayerIndex Season
    param does not give per-season rosters; see pipeline/README.md)."""
    raw = load_single("_static", "player_index")
    if raw is None:
        return {}
    return {r["PERSON_ID"]: r for r in rows_as_dicts(first_result_set(raw))}


def build_players(season: str, wingspan_by_pid: dict, bio_index: dict):
    raw = load_single(season, "box_advanced", "MeasureType=Base&PerMode=Totals")
    if raw is None:
        return None
    rows = []
    for r in rows_as_dicts(first_result_set(raw)):
        pid = r["PLAYER_ID"]
        bio = bio_index.get(pid, {})
        rows.append({
            "personId": pid,
            "firstName": bio.get("PLAYER_FIRST_NAME"),
            "lastName": bio.get("PLAYER_LAST_NAME"),
            "name": r.get("PLAYER_NAME"),
            "teamId": r.get("TEAM_ID"),
            "teamAbbreviation": r.get("TEAM_ABBREVIATION"),
            "age": r.get("AGE"),
            "position": bio.get("POSITION"),
            "heightCm": feet_inches_to_cm(bio.get("HEIGHT")),
            "weightKg": lbs_to_kg(bio.get("WEIGHT")),
            "country": bio.get("COUNTRY"),
            "draftYear": to_int(bio.get("DRAFT_YEAR")),
            "draftRound": to_int(bio.get("DRAFT_ROUND")),
            "draftPick": to_int(bio.get("DRAFT_NUMBER")),
            "fromYear": to_int(bio.get("FROM_YEAR")),
            "toYear": to_int(bio.get("TO_YEAR")),
            "wingspanCm": wingspan_by_pid.get(pid),
        })
    rows.sort(key=lambda r: r["personId"])
    return envelope(season, rows)


BASE_LINE_COLS = ["GP", "W", "L", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A",
                  "FG3_PCT", "FTM", "FTA", "FT_PCT", "OREB", "DREB", "REB", "AST",
                  "TOV", "STL", "BLK", "BLKA", "PF", "PFD", "PTS", "PLUS_MINUS"]
ADVANCED_COLS = ["OFF_RATING", "DEF_RATING", "NET_RATING", "AST_PCT", "AST_TO",
                 "AST_RATIO", "OREB_PCT", "DREB_PCT", "REB_PCT", "TM_TOV_PCT",
                 "EFG_PCT", "TS_PCT", "USG_PCT", "PACE", "PIE", "POSS"]
PER100_COLS = ["FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "REB",
               "AST", "TOV", "STL", "BLK", "PF", "PFD", "PTS"]


def build_box_advanced(season: str):
    def by_pid(measure, per_mode):
        raw = load_single(season, "box_advanced",
                          f"MeasureType={measure}&PerMode={per_mode}")
        if raw is None:
            return None
        return {r["PLAYER_ID"]: r for r in rows_as_dicts(first_result_set(raw))}

    base_pg = by_pid("Base", "PerGame")
    if base_pg is None:
        return None
    advanced = by_pid("Advanced", "Totals") or {}
    usage = by_pid("Usage", "Totals") or {}
    scoring = by_pid("Scoring", "Totals") or {}
    defense = by_pid("Defense", "Totals") or {}
    per100 = by_pid("Base", "Per100Possessions") or {}

    id_cols = {"PLAYER_ID", "PLAYER_NAME", "NICKNAME", "TEAM_ID",
               "TEAM_ABBREVIATION", "AGE", "GP", "W", "L", "W_PCT", "MIN",
               "TEAM_COUNT"}
    rows = []
    for pid, base in base_pg.items():
        row = {
            "personId": pid,
            "name": base.get("PLAYER_NAME"),
            "teamId": base.get("TEAM_ID"),
            "age": base.get("AGE"),
            "gp": base.get("GP"),
            "mpg": base.get("MIN"),
            "perGame": pick(base, BASE_LINE_COLS),
            "advanced": pick(advanced[pid], ADVANCED_COLS) if pid in advanced else None,
            "usage": carry(usage[pid], id_cols) if pid in usage else None,
            "scoring": carry(scoring[pid], id_cols) if pid in scoring else None,
            "defense": carry(defense[pid], id_cols) if pid in defense else None,
            "per100": pick(per100[pid], PER100_COLS) if pid in per100 else None,
        }
        rows.append(row)
    rows.sort(key=lambda r: r["personId"])
    return envelope(season, rows)


def build_shot_zones(season: str):
    raw = load_single(season, "shot_locations")
    if raw is None:
        return None
    rs = raw["response"]["resultSets"]  # dict, not list, for this endpoint
    zone_header, col_header = rs["headers"]
    zone_names = zone_header["columnNames"]
    skip = zone_header["columnsToSkip"]
    span = zone_header["columnSpan"]
    flat_cols = col_header["columnNames"]
    id_cols = flat_cols[:skip]

    rows = []
    for row in rs["rowSet"]:
        ids = dict(zip(id_cols, row[:skip]))
        nba_zones = {}
        for zi, zone in enumerate(zone_names):
            offset = skip + zi * span
            fgm, fga, fg_pct = row[offset:offset + span]
            nba_zones[zone] = {"fgm": fgm, "fga": fga, "fgPct": fg_pct}
        otc = {z: {"fgm": 0, "fga": 0} for z in OTC_ZONES}
        for zone, otc_zone in NBA_TO_OTC.items():
            if zone in nba_zones:
                otc[otc_zone]["fgm"] += nba_zones[zone]["fgm"] or 0
                otc[otc_zone]["fga"] += nba_zones[zone]["fga"] or 0
        rows.append({
            "personId": ids.get("PLAYER_ID"),
            "name": ids.get("PLAYER_NAME"),
            "teamId": ids.get("TEAM_ID"),
            "nbaZones": nba_zones,
            "otcZones": otc,
        })
    rows.sort(key=lambda r: r["personId"])
    return envelope(season, rows)


SHOT_EVENT_COLS = ["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "TEAM_ID", "PERIOD",
                   "MINUTES_REMAINING", "SECONDS_REMAINING", "ACTION_TYPE",
                   "SHOT_TYPE", "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA",
                   "SHOT_ZONE_RANGE", "SHOT_DISTANCE", "LOC_X", "LOC_Y"]


def build_shot_events(season: str):
    files = season_raw_files(season, "shot_charts")
    if not files:
        return None
    rows = []
    for f in files:
        raw = read_json(f)
        for r in rows_as_dicts(first_result_set(raw, "Shot_Chart_Detail")):
            event = pick(r, SHOT_EVENT_COLS)
            event["made"] = bool(r.get("SHOT_MADE_FLAG"))
            rows.append(event)
    rows.sort(key=lambda r: (r["gameId"], r["gameEventId"]))
    return envelope(season, rows)


def build_playtypes(season: str):
    files = season_raw_files(season, "synergy")
    if not files:
        return None
    rows = []
    for f in files:
        raw = read_json(f)
        for r in rows_as_dicts(first_result_set(raw)):
            rows.append({
                "personId": r.get("PLAYER_ID"),
                "name": r.get("PLAYER_NAME"),
                "teamId": r.get("TEAM_ID"),
                "playType": r.get("PLAY_TYPE"),
                "typeGrouping": (r.get("TYPE_GROUPING") or "").lower(),
                "gp": r.get("GP"),
                "poss": r.get("POSS"),
                "possPct": r.get("POSS_PCT"),
                "ppp": r.get("PPP"),
                "pts": r.get("PTS"),
                "fgm": r.get("FGM"),
                "fga": r.get("FGA"),
                "fgPct": r.get("FG_PCT"),
                "efgPct": r.get("EFG_PCT"),
                "ftPossPct": r.get("FT_POSS_PCT"),
                "tovPossPct": r.get("TOV_POSS_PCT"),
                "sfPossPct": r.get("SF_POSS_PCT"),
                "scorePossPct": r.get("SCORE_POSS_PCT"),
                "percentile": r.get("PERCENTILE"),
            })
    # A traded player appears once per team, so teamId is part of the row key.
    rows.sort(key=lambda r: (r["personId"], r["typeGrouping"], r["playType"],
                             r["teamId"] or 0))
    return envelope(season, rows)


def build_tracking(season: str):
    files = season_raw_files(season, "tracking")
    if not files:
        return None
    id_cols = {"PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION",
               "AGE", "W", "L"}
    players = {}
    for f in files:
        raw = read_json(f)
        measure = raw["params"]["PtMeasureType"]
        key = measure[0].lower() + measure[1:]
        for r in rows_as_dicts(first_result_set(raw)):
            pid = r["PLAYER_ID"]
            entry = players.setdefault(pid, {
                "personId": pid,
                "name": r.get("PLAYER_NAME"),
                "teamId": r.get("TEAM_ID"),
                "measures": {},
            })
            entry["measures"][key] = carry(r, id_cols)
    rows = sorted(players.values(), key=lambda r: r["personId"])
    return envelope(season, rows)


DEFEND_CATEGORY_KEYS = {
    "Overall": "overall",
    "3 Pointers": "threePointers",
    "2 Pointers": "twoPointers",
    "Less Than 6Ft": "lessThan6Ft",
    "Less Than 10Ft": "lessThan10Ft",
    "Greater Than 15Ft": "greaterThan15Ft",
}


def build_defense(season: str):
    defend_files = season_raw_files(season, "pt_defend")
    matchup_raw = load_single(season, "matchups")
    if not defend_files and matchup_raw is None:
        return None

    players = {}

    def entry(pid, name, team_id):
        return players.setdefault(pid, {
            "personId": pid, "name": name, "teamId": team_id,
            "defended": {}, "matchupsByOppPosition": {},
        })

    for f in defend_files:
        raw = read_json(f)
        category = DEFEND_CATEGORY_KEYS.get(raw["params"]["DefenseCategory"],
                                            snake_to_camel(raw["params"]["DefenseCategory"]))
        for r in rows_as_dicts(first_result_set(raw)):
            e = entry(r["CLOSE_DEF_PERSON_ID"], r.get("PLAYER_NAME"),
                      r.get("PLAYER_LAST_TEAM_ID"))
            e["defended"][category] = {
                "gp": r.get("GP"),
                "freq": r.get("FREQ"),
                "dFgm": r.get("D_FGM"),
                "dFga": r.get("D_FGA"),
                "dFgPct": r.get("D_FG_PCT"),
                "normalFgPct": r.get("NORMAL_FG_PCT"),
                "pctPlusMinus": r.get("PCT_PLUSMINUS"),
            }

    if matchup_raw is not None:
        # Opponent position from the static bio index, where derivable
        positions = {pid: (bio.get("POSITION") or "UNK")
                     for pid, bio in load_bio_index().items()}
        for r in rows_as_dicts(first_result_set(matchup_raw)):
            e = entry(r["DEF_PLAYER_ID"], r.get("DEF_PLAYER_NAME"), None)
            pos = positions.get(r["OFF_PLAYER_ID"], "UNK")
            bucket = e["matchupsByOppPosition"].setdefault(pos, {
                "partialPoss": 0.0, "playerPts": 0, "matchupFgm": 0,
                "matchupFga": 0, "matchupFg3m": 0, "matchupFg3a": 0,
            })
            bucket["partialPoss"] = round(bucket["partialPoss"] + (r.get("PARTIAL_POSS") or 0), 2)
            bucket["playerPts"] += r.get("PLAYER_PTS") or 0
            bucket["matchupFgm"] += r.get("MATCHUP_FGM") or 0
            bucket["matchupFga"] += r.get("MATCHUP_FGA") or 0
            bucket["matchupFg3m"] += r.get("MATCHUP_FG3M") or 0
            bucket["matchupFg3a"] += r.get("MATCHUP_FG3A") or 0
        for e in players.values():
            for bucket in e["matchupsByOppPosition"].values():
                fga = bucket["matchupFga"]
                bucket["matchupFgPct"] = round(bucket["matchupFgm"] / fga, 4) if fga else None

    rows = sorted(players.values(), key=lambda r: r["personId"])
    return envelope(season, rows)


HUSTLE_COLS = ["G", "MIN", "CONTESTED_SHOTS", "CONTESTED_SHOTS_2PT",
               "CONTESTED_SHOTS_3PT", "DEFLECTIONS", "CHARGES_DRAWN",
               "SCREEN_ASSISTS", "SCREEN_AST_PTS", "OFF_LOOSE_BALLS_RECOVERED",
               "DEF_LOOSE_BALLS_RECOVERED", "LOOSE_BALLS_RECOVERED",
               "OFF_BOXOUTS", "DEF_BOXOUTS", "BOX_OUTS"]


def build_hustle(season: str):
    raw = load_single(season, "hustle")
    if raw is None:
        return None
    rows = []
    for r in rows_as_dicts(first_result_set(raw)):
        row = {"personId": r["PLAYER_ID"], "name": r.get("PLAYER_NAME"),
               "teamId": r.get("TEAM_ID")}
        row.update(pick(r, HUSTLE_COLS))
        rows.append(row)
    rows.sort(key=lambda r: r["personId"])
    return envelope(season, rows)


def parse_lineup_group_id(group_id: str) -> list:
    return [int(p) for p in group_id.strip("-").split("-") if p]


def build_lineups(season: str):
    base_raw = load_single(season, "lineups", "MeasureType=Base")
    if base_raw is None:
        return None
    adv_raw = load_single(season, "lineups", "MeasureType=Advanced")
    adv = {}
    if adv_raw is not None:
        adv = {r["GROUP_ID"]: r for r in rows_as_dicts(first_result_set(adv_raw))}
    rows = []
    for r in rows_as_dicts(first_result_set(base_raw)):
        a = adv.get(r["GROUP_ID"], {})
        rows.append({
            "personIds": sorted(parse_lineup_group_id(r["GROUP_ID"])),
            "teamId": r.get("TEAM_ID"),
            "gp": r.get("GP"),
            "minutes": r.get("MIN"),
            "possessions": a.get("POSS"),
            "offRating": a.get("OFF_RATING"),
            "defRating": a.get("DEF_RATING"),
            "netRating": a.get("NET_RATING"),
        })
    rows.sort(key=lambda r: (r["teamId"], r["personIds"]))
    return envelope(season, rows)


def build_games(season: str):
    raw = load_single(season, "game_logs")
    if raw is None:
        return None
    games = {}
    for r in rows_as_dicts(first_result_set(raw)):
        gid = r["GAME_ID"]
        g = games.setdefault(gid, {
            "gameId": gid,
            "date": r.get("GAME_DATE"),
            "participants": {},
        })
        g["participants"][r.get("TEAM_ID")] = {
            "teamId": r.get("TEAM_ID"),
            "score": r.get("PTS"),
            "matchup": r.get("MATCHUP"),
        }

    rows = []
    for game in games.values():
        participants = sorted(
            game.pop("participants").values(),
            key=lambda participant: participant["teamId"] or 0,
        )
        home = [p for p in participants if "vs." in (p["matchup"] or "")]
        home_participant = home[0] if len(home) == 1 else None
        away_participant = next(
            (p for p in participants
             if home_participant and p["teamId"] != home_participant["teamId"]),
            None,
        )
        home_away_known = home_participant is not None and away_participant is not None
        rows.append({
            **game,
            "participants": participants,
            "homeAwayKnown": home_away_known,
            "homeTeamId": home_participant["teamId"] if home_away_known else None,
            "awayTeamId": away_participant["teamId"] if home_away_known else None,
            "homeScore": home_participant["score"] if home_away_known else None,
            "awayScore": away_participant["score"] if home_away_known else None,
        })
    rows.sort(key=lambda g: g["gameId"])
    return envelope(season, rows)


def clock_to_seconds(clock: str):
    """'PT11M43.00S' -> 703.0 (seconds remaining in period)."""
    m = re.fullmatch(r"PT(\d+)M(\d+(?:\.\d+)?)S", clock or "")
    if not m:
        return None
    return round(int(m.group(1)) * 60 + float(m.group(2)), 2)


def build_pbp_game(season: str, raw: dict):
    game = raw["response"]["game"]
    rows = []
    for a in sorted(game["actions"], key=lambda a: a["actionNumber"]):
        rows.append({
            "actionNumber": a.get("actionNumber"),
            "period": a.get("period"),
            "clockSeconds": clock_to_seconds(a.get("clock")),
            "teamId": a.get("teamId") or None,
            "personId": a.get("personId") or None,
            "actionType": a.get("actionType"),
            "subType": a.get("subType") or None,
            "isFieldGoal": bool(a.get("isFieldGoal")),
            "shotResult": a.get("shotResult") or None,
            "shotValue": a.get("shotValue") or None,
            "shotDistance": a.get("shotDistance") if a.get("isFieldGoal") else None,
            "x": a.get("xLegacy") if a.get("isFieldGoal") else None,
            "y": a.get("yLegacy") if a.get("isFieldGoal") else None,
            "scoreHome": to_int(a.get("scoreHome")),
            "scoreAway": to_int(a.get("scoreAway")),
            # kept: not redundant — carries assist/steal/block attribution
            # that v3 exposes nowhere else in structured form
            "description": a.get("description"),
        })
    return envelope(season, rows, gameId=game["gameId"])


# ------------------------------------------------------------------ main


def collect_wingspans() -> dict:
    """personId -> wingspan cm, from all harvested combine years.
    If a player appears in multiple years, the latest measurement wins."""
    measurements = {}  # pid -> (season, cm)
    for season_dir in sorted(RAW_DIR.iterdir()):
        for f in season_raw_files(season_dir.name, "combine"):
            raw = read_json(f)
            for r in rows_as_dicts(first_result_set(raw)):
                wingspan = r.get("WINGSPAN")
                if wingspan is None:
                    continue
                cm = round(float(wingspan) * 2.54, 1)
                pid = r["PLAYER_ID"]
                key = str(r.get("SEASON") or "")
                if pid not in measurements or key > measurements[pid][0]:
                    measurements[pid] = (key, cm)
    return {pid: cm for pid, (_, cm) in measurements.items()}


CONTRACT_BUILDERS = [
    ("players", build_players),
    ("box_advanced", build_box_advanced),
    ("shot_zones", build_shot_zones),
    ("shot_events", build_shot_events),
    ("playtypes", build_playtypes),
    ("tracking", build_tracking),
    ("defense", build_defense),
    ("hustle", build_hustle),
    ("lineups", build_lineups),
    ("games", build_games),
]


def main() -> int:
    if not RAW_DIR.is_dir():
        print(f"no raw cache at {RAW_DIR}; run harvest.py first")
        return 1

    seasons = sorted(d.name for d in RAW_DIR.iterdir()
                     if d.is_dir() and not d.name.startswith("_"))
    written = {}
    nba_api_versions = set()

    wingspans = collect_wingspans()
    bio_index = load_bio_index()

    for season in seasons:
        for name, builder in CONTRACT_BUILDERS:
            payload = (builder(season, wingspans, bio_index) if name == "players"
                       else builder(season))
            if payload is None:
                continue
            rel = write_contract(f"{name}/{season}.json", payload)
            written.setdefault(name, []).append(season)
            print(f"wrote {rel} ({len(payload['rows'])} rows)")
        for f in season_raw_files(season, "pbp"):
            raw = read_json(f)
            nba_api_versions.add(raw.get("nba_api_version"))
            payload = build_pbp_game(season, raw)
            rel = write_contract(f"pbp/{season}/{payload['gameId']}.json", payload)
            written.setdefault("pbp", []).append(f"{season}/{payload['gameId']}")
            print(f"wrote {rel} ({len(payload['rows'])} rows)")
        # record library version from any raw file in the season
        for group_dir in (RAW_DIR / season).iterdir():
            files = sorted(group_dir.glob("*.json"))
            if files:
                nba_api_versions.add(read_json(files[0]).get("nba_api_version"))

    generated_at = latest_raw_fetched_at()
    if generated_at is None:
        print(f"no complete raw responses found under {RAW_DIR}")
        return 1
    manifest = {
        "schema_version": SCHEMA_VERSION,
        # Deterministic provenance: unchanged raw input yields identical bytes.
        "generated_at": generated_at,
        "nba_api_versions": sorted(v for v in nba_api_versions if v),
        "contracts": {k: sorted(set(v)) for k, v in written.items()},
    }
    (NORMALIZED_DIR).mkdir(parents=True, exist_ok=True)
    with open(NORMALIZED_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, sort_keys=True, indent=1)
        f.write("\n")
    print(f"\nnormalized {sum(len(v) for v in written.values())} contract files "
          f"across {len(seasons)} season(s) -> {NORMALIZED_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
