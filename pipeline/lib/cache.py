"""Raw response cache: the checkpoint/resume layer.

Layout: data/nba/raw/<season>/<endpoint_group>/<stable_param_key>.json
Non-seasonal groups (static) live under the pseudo-season "_static".
Each file wraps the verbatim endpoint response in a small metadata envelope.
Never hand-edited.
"""

import datetime
from pathlib import Path

from lib.util import RAW_DIR, read_json, stable_param_key, write_json

FAILURES_PATH = RAW_DIR / "_failures.json"


def raw_path(season: str, group: str, params: dict) -> Path:
    return RAW_DIR / season / group / f"{stable_param_key(params)}.json"


def is_cached(season: str, group: str, params: dict) -> bool:
    return raw_path(season, group, params).exists()


def save_raw(season: str, group: str, params: dict, endpoint_name: str,
             nba_api_version: str, response: dict) -> Path:
    path = raw_path(season, group, params)
    write_json(path, {
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "endpoint": endpoint_name,
        "params": params,
        "nba_api_version": nba_api_version,
        "response": response,
    })
    return path


def load_raw(season: str, group: str, params: dict) -> dict:
    return read_json(raw_path(season, group, params))


def load_failures() -> list:
    if FAILURES_PATH.exists():
        return read_json(FAILURES_PATH)
    return []


def save_failures(failures: list) -> None:
    write_json(FAILURES_PATH, failures)
