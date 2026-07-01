"""NBA shot-location zones -> OTC five-zone taxonomy.

The NBA's "By Zone" shot-location breakdown has these zones:
    Restricted Area, In The Paint (Non-RA), Mid-Range,
    Left Corner 3, Right Corner 3, Above the Break 3, Backcourt
(plus an aggregate "Corner 3" column that duplicates LC3+RC3).

OTC's taxonomy: rim, short_midrange, long_midrange, corner_three,
above_break_three.

Mapping decision (Stage 0 judgment call — FLAGGED FOR STAGE 1 REVIEW):
    Restricted Area        -> rim
    In The Paint (Non-RA)  -> short_midrange
    Mid-Range              -> long_midrange
    Left/Right Corner 3    -> corner_three
    Above the Break 3      -> above_break_three
    Backcourt              -> above_break_three  (heaves; negligible volume)

Rationale: this is the only assignment of the NBA's zone set that populates
all five OTC zones. The costs, explicitly: OTC "rim" becomes RA-only
(floaters and short paint shots land in short_midrange), and the NBA's
"Mid-Range" zone — which spans both short and long midrange in OTC terms —
maps wholly to long_midrange. The raw NBA zone columns are kept alongside
the mapped ones in shot_zones/<season>.json so Stage 1/2 can revisit the
split (e.g. using shot_events distances) without re-harvesting.
"""

# NBA zone name -> OTC zone name. The aggregate "Corner 3" column is
# intentionally absent (it duplicates LC3+RC3 and would double-count).
NBA_TO_OTC = {
    "Restricted Area": "rim",
    "In The Paint (Non-RA)": "short_midrange",
    "Mid-Range": "long_midrange",
    "Left Corner 3": "corner_three",
    "Right Corner 3": "corner_three",
    "Above the Break 3": "above_break_three",
    "Backcourt": "above_break_three",
}

OTC_ZONES = ["rim", "short_midrange", "long_midrange", "corner_three", "above_break_three"]
