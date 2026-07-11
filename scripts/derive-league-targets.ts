/**
 * Stage 1 league-target derivation: reads the normalized NBA data contracts
 * in data/nba/normalized/ (Stage 0 pipeline output) and derives the empirical
 * league calibration targets that scripts/profile-engine.ts enforces.
 *
 * Usage:
 *   npx tsx scripts/derive-league-targets.ts [--seasons=2023-24,2024-25,2025-26] [--check]
 *
 *   --seasons  Comma-separated NBA season list. Default: the last 3 seasons
 *              that have shot_events data — the "last 3 completed seasons"
 *              modern-game window. This default is a design decision, not a
 *              data limitation: deeper history exists for some contracts, but
 *              zone baselines and shot mix must come from the modern game so
 *              the three-point environment isn't dragged backwards.
 *   --check    Re-render the provenance report in memory and byte-compare it
 *              against the committed docs/LEAGUE_TARGETS.md. Exit 1 on any
 *              mismatch, write nothing. This is the idempotency gate: the
 *              derivation is a pure function of the normalized data.
 *
 * Determinism: no RNG, no timestamps, sorted iteration everywhere, fixed
 * float formatting. Re-running on the same data produces byte-identical
 * output (same discipline as pipeline/normalize.py).
 *
 * Every emitted value carries provenance: season range, sample sizes,
 * source dataset, numerator/denominator/units. Percentages and rates are
 * computed from summed counts across the pooled sample — never averaged
 * across players or across seasons.
 *
 * The derived numbers are hand-transcribed (with provenance annotations)
 * into scripts/profile-engine.ts (targets) and tuned toward in
 * src/engine/constants.ts (base knobs). This script also prints a
 * ready-to-paste transcription block to reduce copy errors.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  listPbpGameIds,
  listSeasons,
  loadBoxAdvanced,
  loadGames,
  loadManifest,
  loadPbpGame,
  loadPlayTypes,
  loadShotEvents,
} from '../src/data/nba/load';
import { PbpActionRow, ShotEventRow } from '../src/data/nba/types';
import { classifyShot, SIX_ZONES, SixZone, HEAVE_DISTANCE_FT, HEAVE_SECONDS_LEFT, MIDRANGE_SPLIT_FT, DEEP_THREE_FT } from '../src/data/nba/shot-classification';

// ---------------------------------------------------------------------------
// Zone mapping (the Stage 1 settled mapping) + heave rule
// ---------------------------------------------------------------------------
//
// The engine has six shot zones; NBA shot-chart data has seven "basic" zones.
// Settled mapping (resolves the split flagged for Stage 1 review in
// pipeline/lib/zones.py; the same spec is documented above BASE_FG_PCT_BY_ZONE
// in src/engine/constants.ts and in docs/LEAGUE_TARGETS.md):
//
//   rim               = Restricted Area (at-basket finishes, <=4 ft)
//   short_midrange    = In The Paint (Non-RA)  OR  Mid-Range with distance < 14 ft
//                       (floaters / short pull-ups; paint-non-RA median is 7 ft)
//   long_midrange     = Mid-Range with distance >= 14 ft
//   corner_three      = Left Corner 3 + Right Corner 3
//   above_break_three = Above the Break 3 with distance < 27 ft
//   deep_three        = Above the Break 3 with distance >= 27 ft
//
// The 14 ft short/long midrange split follows the common analytics convention
// and matches the engine's semantic intent for the two zones. The 27 ft
// deep-three cutoff sits at the observed efficiency step (~.359 vs ~.339) and
// safely below the 32 ft heave-distance cutoff. shotDistance is integer feet,
// floor-truncated, so `>= 27` on the field is exactly a true >= 27.0 ft cut.
//
// Heave rule (explicit, not a blanket time cut): a shot is excluded from
// per-zone FG% and shot-mix derivation iff it is in the NBA "Backcourt" zone,
// OR (shotDistance >= 32 ft AND period time remaining <= 3 s). League-total
// FGA / FG% / 3PA / 3P% still include heaves (box-score consistency).
// A blanket final-seconds exclusion would wrongly remove legitimate late-clock
// layups and jumpers; a distance-only rule would remove real 32+ ft pull-ups.


// ---------------------------------------------------------------------------
// Synergy play-type mapping
// ---------------------------------------------------------------------------
//
// Synergy harvested categories -> engine PlayType union. PRBallHandler and
// PRRollMan are combined into pick_and_roll (the roll-man split is a Stage 3
// target). "Misc" has no engine home: its share is documented and the rest
// renormalized to sum to 1. Putback is NOT a Synergy target here — Stage 0
// does not harvest Synergy's OffRebound (Putbacks) category (~5% of real
// possessions), so the renormalized shares below slightly overstate every
// category; the caveat is documented in the report. Putback frequency is
// PBP-derived and informational.

const SYNERGY_TO_ENGINE: Record<string, string> = {
  Isolation: 'isolation',
  PRBallHandler: 'pick_and_roll',
  PRRollMan: 'pick_and_roll',
  Postup: 'post_up',
  Spotup: 'spot_up',
  Transition: 'transition',
  Cut: 'cut',
  OffScreen: 'off_screen',
  Handoff: 'handoff',
};
const ENGINE_PLAY_TYPES = [
  'isolation',
  'pick_and_roll',
  'post_up',
  'spot_up',
  'transition',
  'cut',
  'off_screen',
  'handoff',
] as const;

// ---------------------------------------------------------------------------
// Tolerance floors (documented judgment calls)
// ---------------------------------------------------------------------------
//
// Band per target = max(maximum absolute deviation of any single season's
// value from the pooled multi-season value, floor below). The deviation term
// is data-driven; the floors are judgment calls sized to dominate sim
// sampling noise at the profile's ~1,290 games while staying tight enough to
// bind (zone FG% standard error at ~30k sim attempts is ~0.003).

const FLOORS: Record<string, number> = {
  pace: 1.0,
  pts: 1.5,
  ppp: 0.015,
  margin: 1.0,
  fga: 1.0,
  tpa: 1.0,
  fta: 1.0,
  orb: 0.5,
  stl: 0.5,
  blk: 0.5,
  tov: 0.5,
  drb: 0.8,
  ast: 0.8,
  reb: 1.0,
  fgPct: 0.005,
  tpPct: 0.008,
  ftPct: 0.01,
  'zoneFgPct.rim': 0.008,
  'zoneFgPct.short_midrange': 0.01,
  'zoneFgPct.long_midrange': 0.012,
  'zoneFgPct.corner_three': 0.012,
  'zoneFgPct.above_break_three': 0.008,
  'zoneFgPct.deep_three': 0.015, // smallest zone sample; fastest-trending zone
  'zoneShare.rim': 0.012,
  'zoneShare.short_midrange': 0.012,
  'zoneShare.long_midrange': 0.012,
  'zoneShare.corner_three': 0.012,
  'zoneShare.above_break_three': 0.012,
  'zoneShare.deep_three': 0.012,
  'bucketShare.rim': 0.015,
  'bucketShare.mid': 0.015,
  'bucketShare.three': 0.015,
};

// ---------------------------------------------------------------------------
// Per-season collection
// ---------------------------------------------------------------------------

interface ZoneLine {
  fga: number;
  fgm: number;
}

interface SeasonAgg {
  season: string;
  // shot_events
  perZone: Record<SixZone, ZoneLine>;
  heaves: ZoneLine;
  allShots: ZoneLine; // includes heaves (box-consistent)
  threes: ZoneLine; // includes heaves (box-consistent)
  // pbp
  fta: number;
  ftm: number;
  tov: number;
  pbpGames: number;
  madeFgTotal: number; // made FGs in shot_events (join denominator)
  madeFgJoined: number;
  assistedByZone: Record<SixZone, { made: number; assisted: number }>;
  tovSubtypes: Map<string, number>;
  andOnes: number;
  putbackFga: number;
  transitionFga: number;
  totalFgaPbp: number;
  // box_advanced (sums of perGame x gp, player-credited universe)
  box: Record<'orb' | 'drb' | 'reb' | 'ast' | 'stl' | 'blk' | 'fga' | 'fgm' | 'fta' | 'pts' | 'tov', number>;
  // games
  games: number;
  teamGames: number;
  pts: number;
  marginSum: number;
  // playtypes (offensive possessions)
  playTypePoss: Map<string, number>;
  playTypeTotalPoss: number;
}

function emptyZoneRecord(): Record<SixZone, ZoneLine> {
  return Object.fromEntries(SIX_ZONES.map((z) => [z, { fga: 0, fgm: 0 }])) as Record<SixZone, ZoneLine>;
}

function collectShots(season: string, agg: SeasonAgg): Map<string, Map<number, { zone: SixZone | 'heave'; }>> {
  const env = loadShotEvents(season);
  // made shots per game for the pbp assist join: gameId -> gameEventId -> zone
  const madeByGame = new Map<string, Map<number, { zone: SixZone | 'heave' }>>();
  for (const row of env.rows) {
    const cls = classifyShot(row);
    agg.allShots.fga++;
    if (row.made) agg.allShots.fgm++;
    if (row.shotType === '3PT Field Goal') {
      agg.threes.fga++;
      if (row.made) agg.threes.fgm++;
    }
    if (cls === 'heave') {
      agg.heaves.fga++;
      if (row.made) agg.heaves.fgm++;
    } else {
      agg.perZone[cls].fga++;
      if (row.made) agg.perZone[cls].fgm++;
    }
    if (row.made) {
      agg.madeFgTotal++;
      let gameMap = madeByGame.get(row.gameId);
      if (!gameMap) {
        gameMap = new Map();
        madeByGame.set(row.gameId, gameMap);
      }
      gameMap.set(row.gameEventId, { zone: cls });
    }
  }
  return madeByGame;
}

const AST_SUFFIX = /\(\S[^()]* \d+ AST\)/;

function collectPbpGame(
  rows: PbpActionRow[],
  madeShots: Map<number, { zone: SixZone | 'heave' }> | undefined,
  agg: SeasonAgg
): void {
  // The two team ids present in this game (for possession-change tracking).
  const teamIds = new Set<number>();
  for (const r of rows) if (r.teamId !== null) teamIds.add(r.teamId);
  const other = (t: number): number | null => {
    for (const id of teamIds) if (id !== t) return id;
    return null;
  };

  let lastMade: { personId: number | null; period: number; clock: number } | null = null;
  let lastMissTeam: number | null = null;
  // Team that most recently GAINED possession via a live change (defensive
  // rebound, turnover, opponent make / final made FT), with period + clock.
  let lastGain: { teamId: number; period: number; clock: number } | null = null;

  for (const r of rows) {
    const type = r.actionType;
    if (type === 'Made Shot' || type === 'Missed Shot') {
      agg.totalFgaPbp++;
      // transition proxy: FGA within 7s of the shooting team gaining possession
      if (
        lastGain !== null &&
        r.teamId !== null &&
        lastGain.teamId === r.teamId &&
        lastGain.period === r.period &&
        r.clockSeconds !== null &&
        lastGain.clock - r.clockSeconds <= 7
      ) {
        agg.transitionFga++;
      }
      if (r.description !== null && r.description.includes('Putback')) agg.putbackFga++;
    }

    if (type === 'Made Shot') {
      lastMade = { personId: r.personId, period: r.period, clock: r.clockSeconds ?? -1 };
      if (madeShots !== undefined) {
        const joined = madeShots.get(r.actionNumber);
        if (joined !== undefined) {
          agg.madeFgJoined++;
          if (joined.zone !== 'heave') {
            const line = agg.assistedByZone[joined.zone];
            line.made++;
            if (r.description !== null && AST_SUFFIX.test(r.description)) line.assisted++;
          }
        }
      }
      // possession flips to the other team
      if (r.teamId !== null) {
        const o = other(r.teamId);
        if (o !== null && r.clockSeconds !== null) lastGain = { teamId: o, period: r.period, clock: r.clockSeconds };
      }
    } else if (type === 'Missed Shot') {
      lastMissTeam = r.teamId;
    } else if (type === 'Free Throw') {
      agg.fta++;
      const desc = r.description ?? '';
      const made = !desc.startsWith('MISS ');
      if (made) agg.ftm++;
      // and-one proxy: made FG then a "1 of 1" FT by the same player at the
      // same stoppage (informational — also catches some away-from-play sets)
      if (
        r.subType === 'Free Throw 1 of 1' &&
        lastMade !== null &&
        r.personId !== null &&
        r.personId === lastMade.personId &&
        r.period === lastMade.period &&
        lastMade.clock - (r.clockSeconds ?? -1) <= 10
      ) {
        agg.andOnes++;
        lastMade = null; // count each make at most once
      }
      // a missed final FT behaves like a missed shot for rebounding;
      // a made final FT flips possession
      const isFinal =
        r.subType === 'Free Throw 1 of 1' || r.subType === 'Free Throw 2 of 2' || r.subType === 'Free Throw 3 of 3';
      if (isFinal) {
        if (made && r.teamId !== null) {
          const o = other(r.teamId);
          if (o !== null && r.clockSeconds !== null) lastGain = { teamId: o, period: r.period, clock: r.clockSeconds };
        } else if (!made) {
          lastMissTeam = r.teamId;
        }
      }
    } else if (type === 'Turnover') {
      agg.tov++;
      const sub = r.subType === null || r.subType === '' ? 'Unknown' : r.subType;
      agg.tovSubtypes.set(sub, (agg.tovSubtypes.get(sub) ?? 0) + 1);
      if (r.teamId !== null) {
        const o = other(r.teamId);
        if (o !== null && r.clockSeconds !== null) lastGain = { teamId: o, period: r.period, clock: r.clockSeconds };
      }
    } else if (type === 'Rebound') {
      // defensive rebound = rebounding team differs from the last missing team
      if (r.teamId !== null && lastMissTeam !== null && r.teamId !== lastMissTeam && r.clockSeconds !== null) {
        lastGain = { teamId: r.teamId, period: r.period, clock: r.clockSeconds };
      }
    }
  }
}

function collectBox(season: string, agg: SeasonAgg): void {
  const env = loadBoxAdvanced(season);
  for (const row of env.rows) {
    const gp = row.gp ?? 0;
    if (gp <= 0) continue;
    const g = row.perGame;
    agg.box.orb += (g.oreb ?? 0) * gp;
    agg.box.drb += (g.dreb ?? 0) * gp;
    agg.box.reb += (g.reb ?? 0) * gp;
    agg.box.ast += (g.ast ?? 0) * gp;
    agg.box.stl += (g.stl ?? 0) * gp;
    agg.box.blk += (g.blk ?? 0) * gp;
    agg.box.fga += (g.fga ?? 0) * gp;
    agg.box.fgm += (g.fgm ?? 0) * gp;
    agg.box.fta += (g.fta ?? 0) * gp;
    agg.box.pts += (g.pts ?? 0) * gp;
    agg.box.tov += (g.tov ?? 0) * gp;
  }
}

function collectGames(season: string, agg: SeasonAgg): void {
  const env = loadGames(season);
  for (const row of env.rows) {
    if (row.participants.length !== 2) {
      throw new Error(`${season} game ${row.gameId}: expected 2 participants, got ${row.participants.length}`);
    }
    const [a, b] = row.participants;
    if (a.score === null || b.score === null) {
      throw new Error(`${season} game ${row.gameId}: null participant score`);
    }
    agg.games++;
    agg.teamGames += 2;
    agg.pts += a.score + b.score;
    agg.marginSum += Math.abs(a.score - b.score);
  }
}

function collectPlayTypes(season: string, agg: SeasonAgg): void {
  const env = loadPlayTypes(season);
  for (const row of env.rows) {
    if (row.typeGrouping !== 'offensive') continue;
    const poss = row.poss ?? 0;
    agg.playTypePoss.set(row.playType, (agg.playTypePoss.get(row.playType) ?? 0) + poss);
    agg.playTypeTotalPoss += poss;
  }
}

function collectSeason(season: string): SeasonAgg {
  const agg: SeasonAgg = {
    season,
    perZone: emptyZoneRecord(),
    heaves: { fga: 0, fgm: 0 },
    allShots: { fga: 0, fgm: 0 },
    threes: { fga: 0, fgm: 0 },
    fta: 0,
    ftm: 0,
    tov: 0,
    pbpGames: 0,
    madeFgTotal: 0,
    madeFgJoined: 0,
    assistedByZone: Object.fromEntries(SIX_ZONES.map((z) => [z, { made: 0, assisted: 0 }])) as SeasonAgg['assistedByZone'],
    tovSubtypes: new Map(),
    andOnes: 0,
    putbackFga: 0,
    transitionFga: 0,
    totalFgaPbp: 0,
    box: { orb: 0, drb: 0, reb: 0, ast: 0, stl: 0, blk: 0, fga: 0, fgm: 0, fta: 0, pts: 0, tov: 0 },
    games: 0,
    teamGames: 0,
    pts: 0,
    marginSum: 0,
    playTypePoss: new Map(),
    playTypeTotalPoss: 0,
  };

  const madeByGame = collectShots(season, agg);
  collectBox(season, agg);
  collectGames(season, agg);
  collectPlayTypes(season, agg);

  const gameIds = listPbpGameIds(season); // sorted
  for (const gameId of gameIds) {
    const file = loadPbpGame(season, gameId);
    collectPbpGame(file.rows, madeByGame.get(gameId), agg);
    agg.pbpGames++;
  }

  // --- per-season internal cross-checks (stop-and-surface on failure) ---
  const fail = (msg: string): never => {
    throw new Error(`${season}: ${msg}`);
  };
  if (agg.games !== agg.pbpGames) fail(`games (${agg.games}) != pbp games (${agg.pbpGames})`);
  const relDiff = (a: number, b: number) => Math.abs(a - b) / b;
  if (relDiff(agg.allShots.fga, agg.box.fga) > 0.005) {
    fail(`shot_events FGA ${agg.allShots.fga} vs box FGA ${agg.box.fga.toFixed(0)} differ > 0.5%`);
  }
  if (relDiff(agg.allShots.fgm, agg.box.fgm) > 0.005) {
    fail(`shot_events FGM ${agg.allShots.fgm} vs box FGM ${agg.box.fgm.toFixed(0)} differ > 0.5%`);
  }
  if (relDiff(agg.fta, agg.box.fta) > 0.005) {
    fail(`pbp FTA ${agg.fta} vs box FTA ${agg.box.fta.toFixed(0)} differ > 0.5%`);
  }
  if (relDiff(agg.pts, agg.box.pts) > 0.005) {
    fail(`games PTS ${agg.pts} vs box PTS ${agg.box.pts.toFixed(0)} differ > 0.5%`);
  }
  // pbp turnovers include team turnovers; box player sums do not. Expect
  // pbp >= box with a modest per-team-game gap.
  const tovGapPerTeamGame = (agg.tov - agg.box.tov) / agg.teamGames;
  if (tovGapPerTeamGame < -0.1 || tovGapPerTeamGame > 1.5) {
    fail(`pbp TOV ${agg.tov} vs box player TOV ${agg.box.tov.toFixed(0)}: gap ${tovGapPerTeamGame.toFixed(2)}/team-game outside [−0.1, 1.5]`);
  }
  const coverage = agg.madeFgJoined / agg.madeFgTotal;
  if (coverage < 0.999) {
    fail(
      `assisted-rate join coverage ${(coverage * 100).toFixed(3)}% < 99.9% ` +
        `(${agg.madeFgJoined}/${agg.madeFgTotal} made FGs joined to pbp)`
    );
  }
  return agg;
}

// ---------------------------------------------------------------------------
// Pooling + target computation
// ---------------------------------------------------------------------------

type TargetValues = Record<string, number>;

/** All target values for one sample (a single season or the pooled sample). */
function computeTargets(aggs: SeasonAgg[]): TargetValues {
  const sum = (f: (a: SeasonAgg) => number) => aggs.reduce((acc, a) => acc + f(a), 0);
  const teamGames = sum((a) => a.teamGames);
  const games = sum((a) => a.games);
  const fga = sum((a) => a.allShots.fga);
  const fgm = sum((a) => a.allShots.fgm);
  const tpa = sum((a) => a.threes.fga);
  const tpm = sum((a) => a.threes.fgm);
  const fta = sum((a) => a.fta);
  const ftm = sum((a) => a.ftm);
  const tov = sum((a) => a.tov);
  const orb = sum((a) => a.box.orb);
  const pts = sum((a) => a.pts);
  const per = (x: number) => x / teamGames;
  // Same possession estimate the profile applies to the sim side
  // (scripts/profile-engine.ts): poss = FGA + 0.44·FTA + TOV − ORB.
  const poss = per(fga) + 0.44 * per(fta) + per(tov) - per(orb);

  const t: TargetValues = {
    pace: poss,
    pts: per(pts),
    ppp: per(pts) / poss,
    fga: per(fga),
    fgPct: fgm / fga,
    tpa: per(tpa),
    tpPct: tpm / tpa,
    fta: per(fta),
    ftPct: ftm / fta,
    orb: per(orb),
    drb: per(sum((a) => a.box.drb)),
    reb: per(sum((a) => a.box.reb)),
    ast: per(sum((a) => a.box.ast)),
    stl: per(sum((a) => a.box.stl)),
    blk: per(sum((a) => a.box.blk)),
    tov: per(tov),
    margin: sum((a) => a.marginSum) / games,
  };

  // zones (post-heave)
  const zoneFgaTotal = SIX_ZONES.reduce((acc, z) => acc + sum((a) => a.perZone[z].fga), 0);
  const bucket = { rim: 0, mid: 0, three: 0 };
  for (const z of SIX_ZONES) {
    const zFga = sum((a) => a.perZone[z].fga);
    const zFgm = sum((a) => a.perZone[z].fgm);
    t[`zoneFgPct.${z}`] = zFgm / zFga;
    t[`zoneShare.${z}`] = zFga / zoneFgaTotal;
    if (z === 'rim') bucket.rim += zFga;
    else if (z === 'short_midrange' || z === 'long_midrange') bucket.mid += zFga;
    else bucket.three += zFga;
  }
  t['bucketShare.rim'] = bucket.rim / zoneFgaTotal;
  t['bucketShare.mid'] = bucket.mid / zoneFgaTotal;
  t['bucketShare.three'] = bucket.three / zoneFgaTotal;

  // informational: assisted rate by zone, overall
  let madeAll = 0;
  let assistedAll = 0;
  for (const z of SIX_ZONES) {
    const made = sum((a) => a.assistedByZone[z].made);
    const assisted = sum((a) => a.assistedByZone[z].assisted);
    t[`assistedRate.${z}`] = assisted / made;
    madeAll += made;
    assistedAll += assisted;
  }
  t['assistedRate.overall'] = assistedAll / madeAll;

  // informational: Synergy play-type shares (Misc excluded, renormalized)
  const possByEngine = new Map<string, number>();
  let nonMisc = 0;
  let misc = 0;
  let allPoss = 0;
  for (const a of aggs) {
    for (const [pt, poss2] of a.playTypePoss) {
      allPoss += poss2;
      if (pt === 'Misc') {
        misc += poss2;
        continue;
      }
      const engine = SYNERGY_TO_ENGINE[pt];
      if (engine === undefined) throw new Error(`Unmapped Synergy play type "${pt}"`);
      nonMisc += poss2;
      possByEngine.set(engine, (possByEngine.get(engine) ?? 0) + poss2);
    }
  }
  for (const pt of ENGINE_PLAY_TYPES) t[`playType.${pt}`] = (possByEngine.get(pt) ?? 0) / nonMisc;
  t['playType.miscExcludedShare'] = misc / allPoss;

  // informational: PBP-derived rates
  const madeFg = sum((a) => a.madeFgTotal);
  const fgaPbp = sum((a) => a.totalFgaPbp);
  t['pbp.transitionFgaShare'] = sum((a) => a.transitionFga) / fgaPbp;
  t['pbp.andOneRate'] = sum((a) => a.andOnes) / madeFg;
  t['pbp.putbackFgaShare'] = sum((a) => a.putbackFga) / fgaPbp;
  t['pbp.orbRate'] = orb / (orb + sum((a) => a.box.drb));
  return t;
}

// ---------------------------------------------------------------------------
// Report rendering (deterministic)
// ---------------------------------------------------------------------------

const ENFORCED_BOX: [key: string, label: string][] = [
  ['pace', 'Pace (poss/team-game)'],
  ['pts', 'Points'],
  ['ppp', 'Points per possession'],
  ['fga', 'FGA'],
  ['fgPct', 'FG%'],
  ['tpa', '3PA'],
  ['tpPct', '3P%'],
  ['fta', 'FTA'],
  ['ftPct', 'FT%'],
  ['orb', 'OREB'],
  ['drb', 'DREB'],
  ['reb', 'REB'],
  ['ast', 'AST'],
  ['stl', 'STL'],
  ['blk', 'BLK'],
  ['tov', 'TOV'],
  ['margin', 'Avg abs margin'],
];

function isRateKey(key: string): boolean {
  return (
    key === 'ppp' ||
    key.endsWith('Pct') ||
    key.startsWith('zoneFgPct.') ||
    key.startsWith('zoneShare.') ||
    key.startsWith('bucketShare.') ||
    key.startsWith('assistedRate.') ||
    key.startsWith('playType.') ||
    key.startsWith('pbp.')
  );
}

function fmtVal(key: string, v: number): string {
  return isRateKey(key) ? v.toFixed(4) : v.toFixed(2);
}

interface Band {
  tol: number;
  boundBy: 'season-dev' | 'floor';
  maxDev: number;
}

function bandFor(key: string, pooled: TargetValues, perSeason: Map<string, TargetValues>): Band {
  let maxDev = 0;
  for (const t of perSeason.values()) maxDev = Math.max(maxDev, Math.abs(t[key] - pooled[key]));
  const floor = FLOORS[key];
  if (floor === undefined) throw new Error(`No tolerance floor documented for ${key}`);
  return maxDev >= floor ? { tol: maxDev, boundBy: 'season-dev', maxDev } : { tol: floor, boundBy: 'floor', maxDev };
}

function renderReport(
  seasons: string[],
  aggs: SeasonAgg[],
  pooled: TargetValues,
  perSeason: Map<string, TargetValues>,
  manifestVersions: string[]
): string {
  const L: string[] = [];
  const sum = (f: (a: SeasonAgg) => number) => aggs.reduce((acc, a) => acc + f(a), 0);

  const row = (key: string, label: string, tiered: boolean) => {
    const per = seasons.map((s) => fmtVal(key, perSeason.get(s)![key])).join(' | ');
    if (tiered) {
      const b = bandFor(key, pooled, perSeason);
      L.push(`| ${label} | ${fmtVal(key, pooled[key])} | ${per} | ±${fmtVal(key, b.tol)} (${b.boundBy}) |`);
    } else {
      L.push(`| ${label} | ${fmtVal(key, pooled[key])} | ${per} |`);
    }
  };

  L.push('# League calibration targets (Stage 1)');
  L.push('');
  L.push('Generated by `npx tsx scripts/derive-league-targets.ts` from the normalized');
  L.push('NBA data contracts in `data/nba/normalized/` (Stage 0 pipeline output).');
  L.push('**Do not hand-edit this file** — re-run the script (it is a pure,');
  L.push('deterministic function of the normalized data; `--check` verifies the');
  L.push('committed copy byte-for-byte). Derived values are hand-transcribed, with');
  L.push('provenance annotations, into `scripts/profile-engine.ts` (targets) and');
  L.push('tuned toward in `src/engine/constants.ts` (base knobs are NOT direct');
  L.push('transcriptions — see the targets-vs-base-constants note below).');
  L.push('');
  L.push(`- Season range: ${seasons.join(', ')} (default = last 3 completed seasons; modern-game window is a design decision)`);
  L.push(`- Normalized schema_version: 3; nba_api versions in manifest: ${manifestVersions.join(', ')}`);
  L.push(`- Games: ${sum((a) => a.games)} (${aggs.map((a) => `${a.season}: ${a.games}`).join(', ')}); team-games: ${sum((a) => a.teamGames)}`);
  L.push(`- Shot attempts (shot_events): ${sum((a) => a.allShots.fga)}; heaves excluded from zone tables: ${sum((a) => a.heaves.fga)} (${aggs.map((a) => `${a.season}: ${a.heaves.fga}`).join(', ')})`);
  L.push(`- Made-FG assist join coverage: ${((sum((a) => a.madeFgJoined) / sum((a) => a.madeFgTotal)) * 100).toFixed(3)}% (${sum((a) => a.madeFgJoined)}/${sum((a) => a.madeFgTotal)}; gate ≥ 99.9%)`);
  L.push('');
  L.push('All rates are computed from summed counts across the pooled sample — never');
  L.push('averaged across players or seasons. Tolerance band per target =');
  L.push('max(max single-season |value − pooled|, documented floor); the floors are');
  L.push('judgment calls (see `FLOORS` in the script) sized above the profile\'s');
  L.push('sim sampling noise at ~1,290 games.');
  L.push('');
  L.push('## Tier assignment (fixed before tuning; never outcome-based)');
  L.push('');
  L.push('**ENFORCED (profile pass/fail):** pace, pts, ppp, fga, fg%, 3pa, 3p%, fta,');
  L.push('ft%, oreb, dreb, reb, ast, stl, blk, tov, avg margin; realized FG% per');
  L.push('engine zone (6); six-zone FGA shares; three-bucket rim/mid/three shares.');
  L.push('');
  L.push('**INFORMATIONAL (logged, never fails):** play-type distribution (owner:');
  L.push('Stage 2 — selection mechanism is hardcoded in `src/engine/play-types.ts`,');
  L.push('out of Stage 1 scope), assisted-shot rate by zone (owner: Stage 2/3 — the');
  L.push('NBA scorekeeper assist definition is materially more liberal than the');
  L.push('engine\'s strict pass-into-the-make chain), PBP transition cross-check');
  L.push('(owner: Stage 2), turnover-type mix / and-one rate / putback rate /');
  L.push('offensive-rebound rate (owner: Stage 3).');
  L.push('');
  L.push('## Six-zone mapping (settled Stage 1 decision)');
  L.push('');
  L.push('NBA shot-chart zones → engine zones (heave exclusion applied first):');
  L.push('');
  L.push('| Engine zone | Rule |');
  L.push('|---|---|');
  L.push('| rim | Restricted Area |');
  L.push(`| short_midrange | In The Paint (Non-RA), or Mid-Range < ${MIDRANGE_SPLIT_FT} ft |`);
  L.push(`| long_midrange | Mid-Range ≥ ${MIDRANGE_SPLIT_FT} ft |`);
  L.push('| corner_three | Left Corner 3 + Right Corner 3 |');
  L.push(`| above_break_three | Above the Break 3 < ${DEEP_THREE_FT} ft |`);
  L.push(`| deep_three | Above the Break 3 ≥ ${DEEP_THREE_FT} ft |`);
  L.push('');
  L.push('Judgment calls: Paint (Non-RA) belongs to `short_midrange` (median distance');
  L.push('7 ft — floater/short-roll territory, matching the engine\'s semantic intent;');
  L.push('`rim` stays at-basket finishes only). The NBA\'s single Mid-Range zone is');
  L.push(`split at ${MIDRANGE_SPLIT_FT} ft (standard short/long midrange convention). \`deep_three\``);
  L.push(`is defined as above-the-break threes at ≥ ${DEEP_THREE_FT} ft — below the ${HEAVE_DISTANCE_FT} ft`);
  L.push('heave-distance cutoff; it is the fastest-trending zone in the pooled window.');
  L.push('This resolves the Mid-Range/deep-three split flagged for Stage 1 review in');
  L.push('`pipeline/lib/zones.py` (the resolution lives here + in `constants.ts`;');
  L.push('the Python provisional five-zone mapping is unchanged).');
  L.push('');
  L.push(`Heave rule (explicit, not a blanket time cut): excluded iff NBA zone is`);
  L.push(`"Backcourt" OR (shot distance ≥ ${HEAVE_DISTANCE_FT} ft AND ≤ ${HEAVE_SECONDS_LEFT} s left in the period).`);
  L.push('`shotDistance` is integer feet (floor-truncated), so the field comparisons');
  L.push('are exact true-distance cuts. Heaves stay in league FGA/FG%/3PA/3P%');
  L.push('(box-score consistency); they are excluded from per-zone FG% and shot mix.');
  L.push('');
  L.push('## Targets vs base constants (binding rule)');
  L.push('');
  L.push('Observed league values below are **profile targets** (the pass/fail oracle');
  L.push('for realized engine output). They are never transcribed directly into');
  L.push('`BASE_FG_PCT_BY_ZONE` or other base constants: realized FG% = base + the');
  L.push('average of the modifier stack (contest, shooter/defender, fatigue, play');
  L.push('type, form, spacing), which does not average to zero. Base knobs are tuned');
  L.push('until realized profile output lands on target.');
  L.push('');
  L.push('## ENFORCED — league box profile (per team-game)');
  L.push('');
  L.push(`| Stat | Pooled target | ${seasons.join(' | ')} | Tolerance |`);
  L.push(`|---|---|${seasons.map(() => '---|').join('')}---|`);
  for (const [key, label] of ENFORCED_BOX) row(key, label, true);
  L.push('');
  L.push('Sources & formulas (numerator / denominator; all "per team-game" use');
  L.push(`team-games = ${sum((a) => a.teamGames)}):`);
  L.push('');
  L.push('- `fga`, `fg%`, `3pa`, `3p%` — shot_events (all attempts, heaves included;');
  L.push('  3PT = `shotType === "3PT Field Goal"`). FG% = ΣFGM/ΣFGA.');
  L.push('- `fta`, `ft%` — pbp `Free Throw` rows; made = description without the');
  L.push('  `MISS ` prefix (pbp FT rows carry `shotResult: null`). Cross-checked');
  L.push('  against box_advanced Σ(fta×gp) within 0.5%.');
  L.push('- `tov` — pbp `Turnover` rows (includes team turnovers, matching the real');
  L.push('  box convention and the sim\'s possession-ending turnover universe).');
  L.push('- `oreb`,`dreb`,`reb`,`ast`,`stl`,`blk` — box_advanced Σ(perGame×gp) over');
  L.push('  players (player-credited universe, matching how the sim accumulates');
  L.push('  team totals from player events). perGame values are rounded to 1');
  L.push('  decimal upstream; the reconstruction error is random-sign and small');
  L.push('  relative to the tolerance floors.');
  L.push('- `pts`, `avg abs margin` — games contract, from `participants[].score`');
  L.push('  (10 games across 2024-25/2025-26 have null home/away designations but');
  L.push('  full participant scores).');
  L.push('- `pace` — poss/team-game = FGA + 0.44·FTA + TOV − ORB (identical to the');
  L.push('  sim-side estimate in scripts/profile-engine.ts, so both sides share one');
  L.push('  definition; the NBA\'s own possession convention would disagree by a');
  L.push('  formula constant). `ppp` = pts/poss.');
  L.push('');
  L.push('## ENFORCED — shooting profile (post-heave)');
  L.push('');
  L.push('Realized FG% per engine zone:');
  L.push('');
  L.push(`| Zone | FGA (pooled) | FG% target | ${seasons.join(' | ')} | Tolerance |`);
  L.push(`|---|---|---|${seasons.map(() => '---|').join('')}---|`);
  for (const z of SIX_ZONES) {
    const key = `zoneFgPct.${z}`;
    const b = bandFor(key, pooled, perSeason);
    const per = seasons.map((s) => fmtVal(key, perSeason.get(s)![key])).join(' | ');
    L.push(`| ${z} | ${sum((a) => a.perZone[z].fga)} | ${fmtVal(key, pooled[key])} | ${per} | ±${fmtVal(key, b.tol)} (${b.boundBy}) |`);
  }
  L.push('');
  L.push('Shot mix (share of non-heave FGA):');
  L.push('');
  L.push(`| Zone | Share target | ${seasons.join(' | ')} | Tolerance |`);
  L.push(`|---|---|${seasons.map(() => '---|').join('')}---|`);
  for (const z of SIX_ZONES) row(`zoneShare.${z}`, z, true);
  for (const bkt of ['rim', 'mid', 'three']) row(`bucketShare.${bkt}`, `bucket:${bkt}`, true);
  L.push('');
  L.push('The three-bucket rows sum the six-zone counts (rim = rim; mid = short +');
  L.push('long midrange; three = corner + above-break + deep), so buckets and zones');
  L.push('cannot disagree. Note this "mid" bucket includes Paint (Non-RA) — do not');
  L.push('sanity-check it against colloquial ~10% "midrange" figures.');
  L.push('');
  L.push('## INFORMATIONAL — play-type distribution (owner: Stage 2)');
  L.push('');
  L.push('League share of Synergy offensive possessions, Σposs per category over');
  L.push(`Σposs (poss-weighted, never averaged possPct). Misc excluded and the rest`);
  L.push(`renormalized to 1; Misc share of all offensive possessions: ${fmtVal('playType.miscExcludedShare', pooled['playType.miscExcludedShare'])}.`);
  L.push('PRBallHandler + PRRollMan are combined into `pick_and_roll` (roll-man split');
  L.push('is a Stage 3 target). **Caveat:** Stage 0 does not harvest Synergy\'s');
  L.push('OffRebound (Putbacks) category (~5% of real possessions), so each');
  L.push('renormalized share below is slightly overstated; putback frequency is');
  L.push('PBP-derived below. The engine-side distribution is measured from terminal');
  L.push('emitted play-by-play event types (the chain can replace the initial play');
  L.push('type), with the engine\'s `putback` share reported separately and excluded');
  L.push('before comparison.');
  L.push('');
  L.push(`| Engine play type | Share target | ${seasons.join(' | ')} |`);
  L.push(`|---|---|${seasons.map(() => '---|').join('')}`);
  for (const pt of ENGINE_PLAY_TYPES) row(`playType.${pt}`, pt, false);
  L.push('');
  L.push('## INFORMATIONAL — assisted-shot rate by zone (owner: Stage 2/3)');
  L.push('');
  L.push('Derivation: made shot_events joined to pbp `Made Shot` rows on');
  L.push('(gameId, gameEventId = actionNumber); zone from the shot event (settled');
  L.push('mapping above); assisted iff the pbp description carries a trailing');
  L.push('`(<name> <n> AST)` attribution. Semantic gap (why this is informational):');
  L.push('the NBA scorekeeper credits assists through a dribble or two after the');
  L.push('catch; the engine\'s chain assist is strictly the pass into the make. The');
  L.push('enforced chain constraint remains total assists per game in the box');
  L.push('profile. Diagnostic: corner-three assisted rate should be the highest of');
  L.push('any zone by a wide margin (sign-level chain sanity check).');
  L.push('');
  L.push(`| Zone | Assisted share | ${seasons.join(' | ')} |`);
  L.push(`|---|---|${seasons.map(() => '---|').join('')}`);
  for (const z of SIX_ZONES) row(`assistedRate.${z}`, z, false);
  row('assistedRate.overall', 'overall', false);
  L.push('');
  L.push('## INFORMATIONAL — PBP-derived rates (owners: Stage 2/3)');
  L.push('');
  L.push(`| Metric | Value | ${seasons.join(' | ')} | Owner |`);
  L.push(`|---|---|${seasons.map(() => '---|').join('')}---|`);
  {
    const infoRows: [string, string, string][] = [
      ['pbp.transitionFgaShare', 'Transition FGA share (≤7 s after possession gain)', 'Stage 2'],
      ['pbp.andOneRate', 'And-one rate (per made FG)', 'Stage 3'],
      ['pbp.putbackFgaShare', 'Putback FGA share ("Putback" in description)', 'Stage 3'],
      ['pbp.orbRate', 'Offensive-rebound rate ORB/(ORB+DRB)', 'Stage 3'],
    ];
    for (const [key, label, owner] of infoRows) {
      const per = seasons.map((s) => fmtVal(key, perSeason.get(s)![key])).join(' | ');
      L.push(`| ${label} | ${fmtVal(key, pooled[key])} | ${per} | ${owner} |`);
    }
  }
  L.push('');
  L.push('The transition share is a timing proxy (share of FGA within 7 s of the');
  L.push('shooting team gaining possession via defensive rebound, turnover, or');
  L.push('opponent score) and is a cross-check only — Synergy\'s Transition frequency');
  L.push('above is the canonical target; the two definitions disagree materially');
  L.push('(Synergy counts possessions and includes free-throw trips; the proxy');
  L.push('counts field-goal attempts). The and-one proxy is a same-player');
  L.push('made-FG → "Free Throw 1 of 1" adjacency and also catches a small number');
  L.push('of away-from-play free throws.');
  L.push('');
  L.push('## INFORMATIONAL — turnover-type mix (owner: Stage 3)');
  L.push('');
  L.push('Share of pbp turnovers by subType (pooled; subtypes under 1% collapsed');
  L.push('into "(other)"):');
  L.push('');
  L.push('| Turnover subType | Share |');
  L.push('|---|---|');
  {
    const totals = new Map<string, number>();
    let all = 0;
    for (const a of aggs) {
      for (const [sub, n] of a.tovSubtypes) {
        totals.set(sub, (totals.get(sub) ?? 0) + n);
        all += n;
      }
    }
    let other = 0;
    const entries = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [sub, n] of entries) {
      if (n / all < 0.01) {
        other += n;
        continue;
      }
      L.push(`| ${sub} | ${(n / all).toFixed(4)} |`);
    }
    L.push(`| (other) | ${(other / all).toFixed(4)} |`);
  }
  L.push('');
  L.push('## Caveats');
  L.push('');
  L.push('- Pooling 2023-24..2025-26 averages across a live trend (3PA and the deep-');
  L.push('  three share rose across the window), so pooled targets sit slightly');
  L.push('  behind the newest season by design; the season-deviation tolerance term');
  L.push('  absorbs this.');
  L.push('- 2025-26 heave-rule basis shift: from 2025-26 the NBA charges end-of-');
  L.push('  period heaves as team attempts, removing them from player shot charts —');
  L.push('  hence the season\'s much lower excluded-heave count above. For 2025-26');
  L.push('  the "heaves stay in league FGA/FG%/3PA/3P%" convention therefore only');
  L.push('  partially applies (the rule-removed ~0.25 FGA/team-game never reach');
  L.push('  shot_events, flattering that season\'s 3P% by ~+0.003). The effect is');
  L.push('  well inside every tolerance band; a future single-season 2025-26+');
  L.push('  window should re-decide the convention deliberately.');
  L.push('- The putback FGA share above is the immediate tip/putback ATTEMPT proxy,');
  L.push('  not Synergy\'s putback POSSESSION concept (~5-6% of possessions incl.');
  L.push('  kick-outs and fouls drawn off offensive rebounds). Stage 3 must not');
  L.push('  tune the engine putback play-type frequency to this number.');
  L.push('- box_advanced perGame values are rounded upstream (1 decimal); the');
  L.push('  Σ(perGame×gp) reconstruction carries small random-sign error.');
  L.push('- pbp free-throw made/missed is inferred from the `MISS ` description');
  L.push('  prefix (the contract carries `shotResult: null` for FTs).');
  L.push('- Synergy OffRebound (Putbacks) is not harvested; see play-type section.');
  L.push('- Jensen caveat: centered or re-centered engine inputs do not guarantee');
  L.push('  the aggregate lands where arithmetic says (nonlinear mix shifts,');
  L.push('  clamping). The profile run is the only proof a retune is done.');
  L.push('');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Transcription block (stdout convenience — reduces hand-copy errors)
// ---------------------------------------------------------------------------

function renderTranscription(seasons: string[], aggs: SeasonAgg[], pooled: TargetValues, perSeason: Map<string, TargetValues>): string {
  const L: string[] = [];
  const range = `${seasons[0]}..${seasons[seasons.length - 1]}`;
  const sum = (f: (a: SeasonAgg) => number) => aggs.reduce((acc, a) => acc + f(a), 0);
  const teamGames = sum((a) => a.teamGames);
  L.push('// ---- ready-to-paste TARGETS entries (see docs/LEAGUE_TARGETS.md) ----');
  for (const [key] of ENFORCED_BOX) {
    const b = bandFor(key, pooled, perSeason);
    L.push(`  ${key}: { v: ${fmtVal(key, pooled[key])}, tol: ${fmtVal(key, b.tol)} }, // ${range}, n=${teamGames} team-games (${b.boundBy})`);
  }
  for (const z of SIX_ZONES) {
    const key = `zoneFgPct.${z}`;
    const b = bandFor(key, pooled, perSeason);
    L.push(`  '${key}': { v: ${fmtVal(key, pooled[key])}, tol: ${fmtVal(key, b.tol)} }, // ${range}, n=${sum((a) => a.perZone[z].fga)} FGA (${b.boundBy})`);
  }
  for (const z of SIX_ZONES) {
    const key = `zoneShare.${z}`;
    const b = bandFor(key, pooled, perSeason);
    L.push(`  '${key}': { v: ${fmtVal(key, pooled[key])}, tol: ${fmtVal(key, b.tol)} }, // ${range} (${b.boundBy})`);
  }
  for (const bkt of ['rim', 'mid', 'three']) {
    const key = `bucketShare.${bkt}`;
    const b = bandFor(key, pooled, perSeason);
    L.push(`  '${key}': { v: ${fmtVal(key, pooled[key])}, tol: ${fmtVal(key, b.tol)} }, // ${range} (${b.boundBy})`);
  }
  L.push('// ---- informational ----');
  for (const pt of ENGINE_PLAY_TYPES) {
    const key = `playType.${pt}`;
    L.push(`  '${key}': ${fmtVal(key, pooled[key])},`);
  }
  for (const z of SIX_ZONES) {
    const key = `assistedRate.${z}`;
    L.push(`  '${key}': ${fmtVal(key, pooled[key])},`);
  }
  L.push(`  'assistedRate.overall': ${fmtVal('assistedRate.overall', pooled['assistedRate.overall'])},`);
  for (const key of ['pbp.transitionFgaShare', 'pbp.andOneRate', 'pbp.putbackFgaShare', 'pbp.orbRate']) {
    L.push(`  '${key}': ${fmtVal(key, pooled[key])},`);
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { seasons: string[]; check: boolean } {
  let seasons: string[] | null = null;
  let check = false;
  for (const arg of argv) {
    if (arg.startsWith('--seasons=')) {
      seasons = arg.slice('--seasons='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--check') {
      check = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (seasons === null) {
    const available = listSeasons('shot_events');
    if (available.length < 3) throw new Error(`Need >= 3 shot_events seasons, found: ${available.join(', ')}`);
    seasons = available.slice(-3);
  }
  return { seasons: [...seasons].sort(), check };
}

function main(): void {
  const { seasons, check } = parseArgs(process.argv.slice(2));

  // Prerequisite: every requested season present in every source dataset.
  for (const contract of ['shot_events', 'games', 'playtypes', 'box_advanced'] as const) {
    const available = new Set(listSeasons(contract));
    for (const s of seasons) {
      if (!available.has(s)) throw new Error(`Season ${s} missing from ${contract}/ — stop and re-harvest`);
    }
  }
  for (const s of seasons) {
    if (listPbpGameIds(s).length === 0) throw new Error(`Season ${s} has no pbp/ games — stop and re-harvest`);
  }

  const manifest = loadManifest();
  const aggs = seasons.map((s) => {
    console.error(`collecting ${s}...`);
    return collectSeason(s);
  });
  const pooled = computeTargets(aggs);
  const perSeason = new Map(seasons.map((s, i) => [s, computeTargets([aggs[i]])]));

  const report = renderReport(seasons, aggs, pooled, perSeason, [...manifest.nba_api_versions].sort());
  const reportPath = path.join(process.cwd(), 'docs', 'LEAGUE_TARGETS.md');

  if (check) {
    const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf-8') : null;
    if (existing === report) {
      console.log(`--check OK: ${reportPath} is byte-identical to the derivation.`);
    } else {
      console.error(`--check FAILED: ${reportPath} differs from the derivation (or is missing). Re-run without --check and review the diff.`);
      process.exitCode = 1;
    }
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`Wrote ${reportPath}`);
  console.log('');
  console.log(renderTranscription(seasons, aggs, pooled, perSeason));
  console.log('');
  const coverage = aggs.reduce((a, x) => a + x.madeFgJoined, 0) / aggs.reduce((a, x) => a + x.madeFgTotal, 0);
  console.log(`assist join coverage: ${(coverage * 100).toFixed(3)}% | heaves excluded: ${aggs.reduce((a, x) => a + x.heaves.fga, 0)} | seasons: ${seasons.join(', ')}`);
}

main();
