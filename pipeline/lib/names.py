"""Name normalization for BDL <-> NBA player matching."""

import re
import unicodedata

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_name(name: str) -> str:
    """Lowercase, strip accents, punctuation, and generational suffixes.

    'Luka Dončić' -> 'luka doncic'; 'Gary Payton II' -> 'gary payton'.
    """
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z\s]", " ", s.lower())
    parts = [p for p in s.split() if p not in SUFFIXES]
    return " ".join(parts)
