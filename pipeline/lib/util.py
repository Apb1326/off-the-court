"""Shared helpers for the NBA data pipeline. Stdlib only."""

import json
import re
from pathlib import Path

# pipeline/lib/util.py -> parents[2] is the repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "nba" / "raw"
NORMALIZED_DIR = REPO_ROOT / "data" / "nba" / "normalized"

SCHEMA_VERSION = 1


def season_str(start_year: int) -> str:
    """1996 -> '1996-97' (NBA API season notation)."""
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def seasons_from_range(rng: dict) -> list:
    """{'from': 1996, 'to': 2025} -> ['1996-97', ..., '2025-26']."""
    return [season_str(y) for y in range(rng["from"], rng["to"] + 1)]


def stable_param_key(params: dict) -> str:
    """Deterministic filesystem-safe key from request params.

    Sorted by key so the same params always produce the same filename.
    """
    parts = []
    for k in sorted(params):
        v = str(params[k])
        v = re.sub(r"[^A-Za-z0-9.\-]+", "_", v)
        parts.append(f"{k}={v}")
    return "&".join(parts) if parts else "default"


def write_json(path: Path, obj, *, sort_keys: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, sort_keys=sort_keys, indent=1)
        f.write("\n")


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
