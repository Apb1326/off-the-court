"""Rate limiting and retry policy for stats.nba.com requests.

The pipeline sits outside the simulation, so it has no determinism
obligations — plain `random` jitter is fine here (see AGENTS.md scope note).
"""

import random
import time


class RateLimiter:
    def __init__(self, base_seconds: float = 0.9, jitter_seconds: float = 0.4):
        self.base = base_seconds
        self.jitter = jitter_seconds
        self._last = 0.0

    def wait(self) -> None:
        target = self._last + self.base + random.uniform(0, self.jitter)
        now = time.monotonic()
        if target > now:
            time.sleep(target - now)
        self._last = time.monotonic()


# Exceptions considered transient. requests is a hard dependency of nba_api,
# so importing it here does not widen the dependency set.
import requests  # noqa: E402

TRANSIENT_EXCEPTIONS = (
    requests.exceptions.Timeout,
    requests.exceptions.ConnectionError,
    requests.exceptions.ChunkedEncodingError,
)

MAX_RETRIES = 5


def fetch_with_retries(make_request, label: str, log=print):
    """Call `make_request()` with exponential backoff on transient failures.

    Retries on timeouts, connection resets, and HTTP 429/5xx. Raises the
    final exception after MAX_RETRIES attempts.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return make_request()
        except Exception as exc:  # noqa: BLE001 - classified below
            status = getattr(getattr(exc, "response", None), "status_code", None)
            transient = isinstance(exc, TRANSIENT_EXCEPTIONS) or status in (429, 500, 502, 503, 504)
            if not transient or attempt == MAX_RETRIES:
                raise
            delay = (2 ** attempt) + random.uniform(0, 1)
            log(f"    retry {attempt}/{MAX_RETRIES} for {label} in {delay:.1f}s ({type(exc).__name__})")
            time.sleep(delay)
