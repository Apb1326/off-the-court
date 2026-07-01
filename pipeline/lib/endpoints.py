"""Endpoint group definitions.

Every endpoint class and parameter below was verified against the installed
nba_api package (see pipeline/README.md). Each group expands a manifest entry
into concrete request specs; dynamic groups (shot_charts, pbp) enumerate
their targets from previously harvested raw files.
"""

from dataclasses import dataclass, field

import nba_api
from nba_api.stats.endpoints import (
    draftcombinestats,
    leaguedashlineups,
    leaguedashplayershotlocations,
    leaguedashplayerstats,
    leaguedashptdefend,
    leaguedashptstats,
    leaguegamelog,
    leaguehustlestatsplayer,
    leagueseasonmatchups,
    playbyplayv3,
    playerindex,
    shotchartdetail,
    synergyplaytypes,
)
from nba_api.stats.static import players as static_players
from nba_api.stats.static import teams as static_teams

from lib import cache
from lib.util import seasons_from_range

NBA_API_VERSION = nba_api.__version__

STATIC_SEASON = "_static"  # pseudo-season dir for non-seasonal data

REQUEST_TIMEOUT = 45  # seconds; stats.nba.com is slow and flaky

REGULAR_SEASON = "Regular Season"

# Verified enum values from nba_api.stats.library.parameters
BOX_MEASURE_TYPES = ["Base", "Advanced", "Usage", "Scoring", "Defense"]
BOX_PER_MODES = ["PerGame", "Totals"]
SYNERGY_PLAY_TYPES = [
    "Isolation", "PRBallHandler", "PRRollman", "Postup", "Spotup",
    "Transition", "Cut", "OffScreen", "Handoff", "Misc",
]
SYNERGY_SIDES = ["offensive", "defensive"]
TRACKING_MEASURES = [
    "Drives", "Passing", "Possessions", "PullUpShot", "CatchShoot",
    "Rebounding", "Defense", "SpeedDistance", "ElbowTouch", "PostTouch",
    "PaintTouch", "Efficiency",
]
DEFEND_CATEGORIES = [
    "Overall", "3 Pointers", "2 Pointers",
    "Less Than 6Ft", "Less Than 10Ft", "Greater Than 15Ft",
]

# Groups are always processed in this order so dynamic groups (shot_charts,
# pbp) can enumerate from prerequisites harvested in the same run.
GROUP_ORDER = [
    "static", "player_index", "box_advanced", "shot_locations", "game_logs",
    "shot_charts", "synergy", "tracking", "pt_defend", "hustle", "lineups",
    "matchups", "pbp", "combine",
]


@dataclass
class Spec:
    season: str
    group: str
    endpoint: str
    params: dict
    fetch: object = field(repr=False, default=None)  # () -> response dict


def _endpoint_fetch(cls, **kwargs):
    def fetch():
        return cls(timeout=REQUEST_TIMEOUT, **kwargs).get_dict()
    return fetch


def _static_fetch(fn):
    def fetch():
        return {"data": fn()}
    return fetch


def expand_group(group: str, cfg: dict):
    """Yield Specs for one manifest group entry."""
    seasons = seasons_from_range(cfg["seasons"]) if "seasons" in cfg else []

    if group == "static":
        yield Spec(STATIC_SEASON, group, "static.teams", {"dataset": "teams"},
                   _static_fetch(static_teams.get_teams))
        yield Spec(STATIC_SEASON, group, "static.players", {"dataset": "players"},
                   _static_fetch(static_players.get_players))

    elif group == "player_index":
        # One static call, not per-season: with Historical=0 the endpoint
        # returns only currently-rostered players (offseason-broken), and
        # with Historical=1 it returns the identical full all-time index
        # regardless of the Season param. Per-season rosters come from
        # box_advanced; this call supplies the bio fields (height, weight,
        # draft, position), which are season-invariant.
        params = {"Historical": 1, "LeagueID": "00", "Season": "2025-26"}
        yield Spec(STATIC_SEASON, group, "PlayerIndex", params,
                   _endpoint_fetch(playerindex.PlayerIndex, season="2025-26",
                                   league_id="00", historical_nullable=1))

    elif group == "box_advanced":
        # Spec table says PerGame + Totals (~10 calls). One extra call
        # (Base x Per100Possessions) backs the per-100 fields promised by
        # the box_advanced contract.
        combos = [(m, p) for m in BOX_MEASURE_TYPES for p in BOX_PER_MODES]
        combos.append(("Base", "Per100Possessions"))
        for s in seasons:
            for measure, per_mode in combos:
                params = {"Season": s, "MeasureType": measure, "PerMode": per_mode,
                          "SeasonType": REGULAR_SEASON}
                yield Spec(s, group, "LeagueDashPlayerStats", params,
                           _endpoint_fetch(leaguedashplayerstats.LeagueDashPlayerStats,
                                           season=s,
                                           measure_type_detailed_defense=measure,
                                           per_mode_detailed=per_mode,
                                           season_type_all_star=REGULAR_SEASON))

    elif group == "shot_locations":
        for s in seasons:
            params = {"Season": s, "DistanceRange": "By Zone", "PerMode": "Totals",
                      "SeasonType": REGULAR_SEASON}
            yield Spec(s, group, "LeagueDashPlayerShotLocations", params,
                       _endpoint_fetch(leaguedashplayershotlocations.LeagueDashPlayerShotLocations,
                                       season=s, distance_range="By Zone",
                                       per_mode_detailed="Totals",
                                       season_type_all_star=REGULAR_SEASON))

    elif group == "game_logs":
        for s in seasons:
            params = {"Season": s, "PlayerOrTeam": "T", "SeasonType": REGULAR_SEASON}
            yield Spec(s, group, "LeagueGameLog", params,
                       _endpoint_fetch(leaguegamelog.LeagueGameLog,
                                       season=s, player_or_team_abbreviation="T",
                                       season_type_all_star=REGULAR_SEASON))

    elif group == "shot_charts":
        for s in seasons:
            for pid in _shot_chart_player_ids(s, cfg):
                params = {"Season": s, "PlayerID": pid, "ContextMeasure": "FGA",
                          "SeasonType": REGULAR_SEASON}
                yield Spec(s, group, "ShotChartDetail", params,
                           _endpoint_fetch(shotchartdetail.ShotChartDetail,
                                           team_id=0, player_id=pid,
                                           context_measure_simple="FGA",
                                           season_nullable=s,
                                           season_type_all_star=REGULAR_SEASON))

    elif group == "synergy":
        play_types = cfg.get("play_types") or SYNERGY_PLAY_TYPES
        sides = cfg.get("sides") or SYNERGY_SIDES
        for s in seasons:
            for side in sides:
                for pt in play_types:
                    params = {"Season": s, "PlayType": pt, "TypeGrouping": side,
                              "PerMode": "Totals", "SeasonType": REGULAR_SEASON}
                    yield Spec(s, group, "SynergyPlayTypes", params,
                               _endpoint_fetch(synergyplaytypes.SynergyPlayTypes,
                                               season=s, play_type_nullable=pt,
                                               type_grouping_nullable=side,
                                               per_mode_simple="Totals",
                                               player_or_team_abbreviation="P",
                                               season_type_all_star=REGULAR_SEASON,
                                               league_id="00"))

    elif group == "tracking":
        measures = cfg.get("measures") or TRACKING_MEASURES
        for s in seasons:
            for m in measures:
                params = {"Season": s, "PtMeasureType": m, "PerMode": "Totals",
                          "SeasonType": REGULAR_SEASON}
                yield Spec(s, group, "LeagueDashPtStats", params,
                           _endpoint_fetch(leaguedashptstats.LeagueDashPtStats,
                                           season=s, pt_measure_type=m,
                                           per_mode_simple="Totals",
                                           player_or_team="Player",
                                           season_type_all_star=REGULAR_SEASON))

    elif group == "pt_defend":
        categories = cfg.get("categories") or DEFEND_CATEGORIES
        for s in seasons:
            for c in categories:
                params = {"Season": s, "DefenseCategory": c, "PerMode": "Totals",
                          "SeasonType": REGULAR_SEASON}
                yield Spec(s, group, "LeagueDashPtDefend", params,
                           _endpoint_fetch(leaguedashptdefend.LeagueDashPtDefend,
                                           season=s, defense_category=c,
                                           per_mode_simple="Totals",
                                           season_type_all_star=REGULAR_SEASON))

    elif group == "hustle":
        for s in seasons:
            params = {"Season": s, "PerMode": "Totals", "SeasonType": REGULAR_SEASON}
            yield Spec(s, group, "LeagueHustleStatsPlayer", params,
                       _endpoint_fetch(leaguehustlestatsplayer.LeagueHustleStatsPlayer,
                                       season=s, per_mode_time="Totals",
                                       season_type_all_star=REGULAR_SEASON))

    elif group == "lineups":
        for s in seasons:
            for measure in ["Base", "Advanced"]:
                params = {"Season": s, "MeasureType": measure, "GroupQuantity": 5,
                          "PerMode": "Totals", "SeasonType": REGULAR_SEASON}
                yield Spec(s, group, "LeagueDashLineups", params,
                           _endpoint_fetch(leaguedashlineups.LeagueDashLineups,
                                           season=s, group_quantity=5,
                                           measure_type_detailed_defense=measure,
                                           per_mode_detailed="Totals",
                                           season_type_all_star=REGULAR_SEASON))

    elif group == "matchups":
        for s in seasons:
            params = {"Season": s, "PerMode": "Totals", "SeasonType": REGULAR_SEASON}
            yield Spec(s, group, "LeagueSeasonMatchups", params,
                       _endpoint_fetch(leagueseasonmatchups.LeagueSeasonMatchups,
                                       season=s, per_mode_simple="Totals",
                                       season_type_playoffs=REGULAR_SEASON))

    elif group == "pbp":
        for s in seasons:
            game_ids = _game_ids(s)
            limit = cfg.get("limit_games")
            if limit:
                game_ids = game_ids[:limit]
            for gid in game_ids:
                params = {"GameID": gid}
                yield Spec(s, group, "PlayByPlayV3", params,
                           _endpoint_fetch(playbyplayv3.PlayByPlayV3, game_id=gid))

    elif group == "combine":
        for s in seasons:
            params = {"SeasonAllTime": s}
            yield Spec(s, group, "DraftCombineStats", params,
                       _endpoint_fetch(draftcombinestats.DraftCombineStats,
                                       league_id="00", season_all_time=s))

    else:
        raise ValueError(f"Unknown endpoint group in manifest: {group!r}")


class MissingPrerequisite(Exception):
    """A dynamic group's source raw file has not been harvested yet."""


def _shot_chart_player_ids(season: str, cfg: dict) -> list:
    """Player list for shot_charts: manifest override, else everyone who
    appeared in the season's Base/Totals leaguedashplayerstats raw file."""
    if cfg.get("player_ids"):
        return list(cfg["player_ids"])
    params = {"Season": season, "MeasureType": "Base", "PerMode": "Totals",
              "SeasonType": REGULAR_SEASON}
    if not cache.is_cached(season, "box_advanced", params):
        raise MissingPrerequisite(
            f"shot_charts for {season} needs box_advanced (Base/Totals) harvested first; "
            "include box_advanced for this season in the manifest")
    raw = cache.load_raw(season, "box_advanced", params)
    rs = raw["response"]["resultSets"][0]
    idx = rs["headers"].index("PLAYER_ID")
    return sorted({row[idx] for row in rs["rowSet"]})


def _game_ids(season: str) -> list:
    """Regular-season game ids from the season's harvested game log."""
    params = {"Season": season, "PlayerOrTeam": "T", "SeasonType": REGULAR_SEASON}
    if not cache.is_cached(season, "game_logs", params):
        raise MissingPrerequisite(
            f"pbp for {season} needs game_logs harvested first; "
            "include game_logs for this season in the manifest")
    raw = cache.load_raw(season, "game_logs", params)
    rs = raw["response"]["resultSets"][0]
    idx = rs["headers"].index("GAME_ID")
    return sorted({row[idx] for row in rs["rowSet"]})
