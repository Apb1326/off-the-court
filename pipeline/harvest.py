#!/usr/bin/env python3
"""Harvest stats.nba.com data into the raw cache.

Usage:
    python pipeline/harvest.py --manifest pipeline/manifests/default.json
    python pipeline/harvest.py --manifest pipeline/manifests/smoke.json --limit 10
    python pipeline/harvest.py --manifest ... --force   # re-fetch cached files

Checkpoint/resume: a request whose raw cache file already exists is skipped,
so a killed run resumed with the same manifest picks up where it left off and
re-running a completed harvest is a no-op. Failures are recorded to
data/nba/raw/_failures.json and the run continues; re-run to retry them.
"""

import argparse
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import cache
from lib.endpoints import GROUP_ORDER, NBA_API_VERSION, MissingPrerequisite, expand_group
from lib.ratelimit import RateLimiter, fetch_with_retries
from lib.util import RAW_DIR, read_json


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True, help="path to a manifest JSON")
    ap.add_argument("--force", action="store_true", help="re-fetch even if cached")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap the number of new (non-cached) requests this run")
    args = ap.parse_args()

    manifest = read_json(Path(args.manifest))
    rate_cfg = manifest.get("rate", {})
    limiter = RateLimiter(rate_cfg.get("base_seconds", 0.9),
                          rate_cfg.get("jitter_seconds", 0.4))
    groups = manifest["groups"]

    unknown = set(groups) - set(GROUP_ORDER)
    if unknown:
        print(f"ERROR: unknown groups in manifest: {sorted(unknown)}")
        return 1

    fetched = skipped = failed = 0
    failures = []

    print(f"harvest: manifest={args.manifest} nba_api={NBA_API_VERSION} "
          f"raw={RAW_DIR}")
    if args.limit is not None:
        print(f"harvest: limiting to {args.limit} new requests")

    hit_limit = False
    for group in GROUP_ORDER:
        if group not in groups or hit_limit:
            continue
        print(f"\n== group: {group}")
        try:
            specs = expand_group(group, groups[group])
            for spec in specs:
                label = f"{spec.season}/{spec.group}/{spec.endpoint} {spec.params}"
                if not args.force and cache.is_cached(spec.season, spec.group, spec.params):
                    skipped += 1
                    print(f"  cached  {label}")
                    continue
                if args.limit is not None and fetched >= args.limit:
                    print(f"  --limit {args.limit} reached; stopping new requests")
                    hit_limit = True
                    break
                if spec.group != "static":
                    limiter.wait()
                try:
                    response = fetch_with_retries(spec.fetch, label)
                    cache.save_raw(spec.season, spec.group, spec.params,
                                   spec.endpoint, NBA_API_VERSION, response)
                    fetched += 1
                    print(f"  fetched {label}  [{fetched} fetched / {skipped} cached / {failed} failed]")
                except Exception as exc:  # noqa: BLE001 - recorded, run continues
                    failed += 1
                    print(f"  FAILED  {label}: {type(exc).__name__}: {exc}")
                    failures.append({
                        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "season": spec.season, "group": spec.group,
                        "endpoint": spec.endpoint, "params": spec.params,
                        "error": f"{type(exc).__name__}: {exc}",
                    })
        except MissingPrerequisite as exc:
            print(f"  SKIPPING group {group}: {exc}")
            failures.append({
                "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "season": None, "group": group, "endpoint": None, "params": None,
                "error": str(exc),
            })
            failed += 1

    if failures:
        cache.save_failures(failures)
    elif cache.FAILURES_PATH.exists():
        cache.FAILURES_PATH.unlink()  # previous failures all resolved

    print(f"\nsummary: {fetched} fetched, {skipped} skipped (cached), {failed} failed")
    if hit_limit:
        print("NOTE: run stopped at --limit; re-run to continue.")
    if failures:
        print(f"failures recorded to {cache.FAILURES_PATH} — re-run the same "
              "command to retry them (cached requests are skipped).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
