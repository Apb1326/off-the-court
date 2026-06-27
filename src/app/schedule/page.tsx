'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  city: string;
  abbreviation: string;
  conference: 'East' | 'West';
  division: string;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  teamId: string;
  ratings?: Record<string, number>;
}

interface Standing {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  homeWins: number;
  homeLosses: number;
  awayWins: number;
  awayLosses: number;
  streak: number;
  lastTen: ('W' | 'L')[];
}

interface PlayerStat {
  playerId: string;
  teamId: string;
  gamesPlayed: number;
  mpg: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  topg: number;
  fgPct: number;
  tpPct: number;
  ftPct: number;
}

interface GameSummary {
  id: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  overtimePeriods: number;
  winnerId: string;
}

interface Marker {
  type: string;
  date: string;
  label: string;
}

interface SeasonData {
  seasonId: string;
  startDate: string;
  endDate: string;
  currentDate: string;
  controlledTeamId: string | null;
  controlledTeamMissing?: boolean;
  gamesPlayed: number;
  totalGames: number;
  seasonOver: boolean;
  markers: Marker[];
  standings: Standing[];
  playerStats: PlayerStat[];
  recentDate: string | null;
  recent: GameSummary[];
  upcoming: { date: string; games: { id: string; homeTeamId: string; awayTeamId: string }[] } | null;
}

type LeaderKey = 'ppg' | 'rpg' | 'apg' | 'spg' | 'bpg' | 'fgPct' | 'tpPct';

function parseDate(d: string): Date {
  return new Date(d + 'T00:00:00Z');
}
function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return parseDate(d).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

const LEADER_TABS: { key: LeaderKey; label: string; pct?: boolean }[] = [
  { key: 'ppg', label: 'Points' },
  { key: 'rpg', label: 'Rebounds' },
  { key: 'apg', label: 'Assists' },
  { key: 'spg', label: 'Steals' },
  { key: 'bpg', label: 'Blocks' },
  { key: 'fgPct', label: 'FG%', pct: true },
  { key: 'tpPct', label: '3P%', pct: true },
];

function winPct(s: Standing): number {
  return s.wins / Math.max(1, s.wins + s.losses);
}

/** A player's overall: the mean of their rating values (mirrors calculateOverall). */
function playerOverall(ratings?: Record<string, number>): number {
  if (!ratings) return 0;
  const vals = Object.values(ratings);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

/**
 * A rough roster-strength read for the team picker: the average overall of a
 * team's top eight players. Display-only — the simulation never values a lineup
 * this way (it's relational; see AGENTS.md), so this is purely to keep the player
 * from choosing blind.
 */
function rosterStrength(teamId: string, players: Player[]): number | null {
  const ovrs = players
    .filter((p) => p.teamId === teamId)
    .map((p) => playerOverall(p.ratings))
    .filter((x) => x > 0)
    .sort((a, b) => b - a)
    .slice(0, 8);
  if (!ovrs.length) return null;
  return Math.round(ovrs.reduce((a, b) => a + b, 0) / ovrs.length);
}

/** Color a strength/overall value on the same scale the rest of the app uses. */
function strengthColor(value: number): string {
  if (value >= 70) return '#22c55e';
  if (value >= 60) return '#3b82f6';
  if (value >= 50) return '#8b5cf6';
  if (value >= 40) return '#f59e0b';
  if (value >= 30) return '#f97316';
  return '#ef4444';
}

type AdvanceMode = 'day' | 'week' | 'marker' | 'rest';

export default function SchedulePage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [season, setSeason] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'standings' | 'leaders'>('standings');
  const [leaderTab, setLeaderTab] = useState<LeaderKey>('ppg');
  // New-game team-selection screen. Opens automatically when there's no season,
  // or on demand via the "New" button when one is in progress.
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/teams').then((r) => r.json()),
      fetch('/api/players').then((r) => r.json()),
      fetch('/api/season').then((r) => r.json()),
    ]).then(([teamsData, playersData, seasonRes]) => {
      setTeams(teamsData);
      setPlayers(playersData);
      setSeason(seasonRes.state ?? null);
      setLoading(false);
    });
  }, []);

  const teamById = (id: string) => teams.find((t) => t.id === id);
  const playerById = (id: string) => players.find((p) => p.id === id);

  const post = async (body: object) => {
    setBusy(true);
    const res = await fetch('/api/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok && data.state) setSeason(data.state);
    setBusy(false);
  };

  // Start a new game with the chosen franchise. The controlled team is persisted
  // as part of SeasonState, so it survives the save/load round trip.
  const startNewGame = async (controlledTeamId: string) => {
    await post({ action: 'new', start: 'season', seed: Math.floor(Math.random() * 1_000_000), controlledTeamId });
    setSetupOpen(false);
  };
  const advance = (mode: AdvanceMode) => post({ action: 'advance', mode });

  const conferenceStandings = (conf: 'East' | 'West'): Standing[] => {
    if (!season) return [];
    return season.standings
      .filter((s) => teamById(s.teamId)?.conference === conf)
      .sort((a, b) => winPct(b) - winPct(a));
  };

  const leaders = (key: LeaderKey): PlayerStat[] => {
    if (!season) return [];
    const gamesPerTeam = season.gamesPlayed / 15; // ~ games played by each team
    const minGames = Math.max(1, gamesPerTeam * 0.4);
    return [...season.playerStats]
      .filter((p) => p.gamesPlayed >= minGames && p.mpg >= 15)
      .sort((a, b) => b[key] - a[key])
      .slice(0, 15);
  };

  const nextMarker = season
    ? [...season.markers].filter((m) => m.date > season.currentDate).sort((a, b) => (a.date < b.date ? -1 : 1))[0]
    : undefined;

  if (loading) {
    return <div className="ootp-panel p-8 text-center" style={{ color: 'var(--muted)' }}>Loading…</div>;
  }

  // The new-game setup takes over the page when there's no season yet, or when
  // the player opens it via "New" on an in-progress season.
  if (!season || setupOpen) {
    return (
      <NewGameSetup
        teams={teams}
        players={players}
        busy={busy}
        existingSeason={!!season}
        onStart={startNewGame}
        onCancel={season ? () => setSetupOpen(false) : undefined}
      />
    );
  }

  return (
    <div>
      <ControlBar
        season={season}
        nextMarker={nextMarker}
        teamById={teamById}
        busy={busy}
        onAdvance={advance}
        onNew={() => setSetupOpen(true)}
      />

      {season.controlledTeamMissing && (
        <div
          className="ootp-panel mt-4 px-4 py-3 text-[13px]"
          style={{ borderLeft: '3px solid var(--danger)', color: 'var(--foreground)' }}
        >
          Your controlled team is no longer in this league&apos;s rosters — continuing in a
          league-wide spectator view. Start a new game to pick a franchise.
        </div>
      )}

      <MarkersTimeline season={season} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <ResultsPanel season={season} teamById={teamById} />
        <UpNextPanel season={season} teamById={teamById} />
      </div>

      <div className="flex gap-2 mt-5 mb-3">
        <TabButton active={view === 'standings'} onClick={() => setView('standings')}>Standings</TabButton>
        <TabButton active={view === 'leaders'} onClick={() => setView('leaders')}>League Leaders</TabButton>
      </div>

      {view === 'standings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StandingsTable title="Eastern Conference" standings={conferenceStandings('East')} teamById={teamById} controlledTeamId={season.controlledTeamId} />
          <StandingsTable title="Western Conference" standings={conferenceStandings('West')} teamById={teamById} controlledTeamId={season.controlledTeamId} />
        </div>
      )}

      {view === 'leaders' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            {LEADER_TABS.map((t) => (
              <TabButton key={t.key} active={leaderTab === t.key} onClick={() => setLeaderTab(t.key)} small>
                {t.label}
              </TabButton>
            ))}
          </div>
          <LeadersTable
            stats={leaders(leaderTab)}
            statKey={leaderTab}
            isPct={LEADER_TABS.find((t) => t.key === leaderTab)?.pct ?? false}
            playerById={playerById}
            teamById={teamById}
          />
        </div>
      )}
    </div>
  );
}

function ControlBar({ season, nextMarker, teamById, busy, onAdvance, onNew }: {
  season: SeasonData;
  nextMarker?: Marker;
  teamById: (id: string) => Team | undefined;
  busy: boolean;
  onAdvance: (m: AdvanceMode) => void;
  onNew: () => void;
}) {
  const pct = Math.round((season.gamesPlayed / season.totalGames) * 100);
  const myTeam = season.controlledTeamId ? teamById(season.controlledTeamId) : undefined;
  return (
    <div className="ootp-panel">
      <div className="ootp-statusbar flex flex-wrap items-center gap-4 px-4 py-3">
        <div>
          <div className="text-lg font-bold text-white leading-tight">
            {season.seasonOver ? 'Regular Season Complete' : fmtDate(season.currentDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--chrome-text)', opacity: 0.8 }}>
            {myTeam && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>GM · {myTeam.city} {myTeam.name} · </span>}
            Game {season.gamesPlayed.toLocaleString()} of {season.totalGames.toLocaleString()} · {pct}%
            {nextMarker && !season.seasonOver && (
              <span> · {nextMarker.label} in {Math.max(0, daysBetween(season.currentDate, nextMarker.date))}d</span>
            )}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!season.seasonOver ? (
            <>
              <button onClick={() => onAdvance('day')} disabled={busy} className="ootp-btn ootp-btn-primary">
                {busy ? 'Simming…' : '▶ Next Day'}
              </button>
              <button onClick={() => onAdvance('week')} disabled={busy} className="ootp-btn">Sim Week</button>
              {nextMarker && (
                <button onClick={() => onAdvance('marker')} disabled={busy} className="ootp-btn">
                  To {nextMarker.label}
                </button>
              )}
              <button onClick={() => onAdvance('rest')} disabled={busy} className="ootp-btn">Sim to Finale</button>
            </>
          ) : (
            <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Season finished — view final standings below</span>
          )}
          <button onClick={onNew} disabled={busy} className="ootp-btn" title="Start a new season">⟳ New</button>
        </div>
      </div>
      <div style={{ height: '4px', background: 'var(--background)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

function MarkersTimeline({ season }: { season: SeasonData }) {
  const total = Math.max(1, daysBetween(season.startDate, season.endDate));
  const pos = (d: string) => Math.min(100, Math.max(0, (daysBetween(season.startDate, d) / total) * 100));
  const todayPos = pos(season.currentDate);

  return (
    <div className="ootp-panel mt-4">
      <div className="ootp-panel-header">Season Calendar</div>
      <div className="px-5 pt-8 pb-7 relative">
        <div className="relative h-1.5 rounded" style={{ background: 'var(--table-header)' }}>
          <div className="absolute h-1.5 rounded" style={{ width: `${todayPos}%`, background: 'var(--accent)', opacity: 0.5 }} />
          {/* today marker */}
          <div className="absolute -top-1.5 flex flex-col items-center" style={{ left: `${todayPos}%`, transform: 'translateX(-50%)' }}>
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--accent)', border: '2px solid var(--background)' }} />
          </div>
          {season.markers.filter((m) => m.type !== 'all_star_game').map((m) => {
            const left = pos(m.date);
            const reached = m.date <= season.currentDate;
            const up = m.type === 'trade_deadline';
            // Keep edge labels inside the panel instead of centering off the edge.
            const align: React.CSSProperties =
              left <= 2 ? { left: '0%', transform: 'none', alignItems: 'flex-start' }
              : left >= 98 ? { right: '0%', transform: 'none', alignItems: 'flex-end' }
              : { left: `${left}%`, transform: 'translateX(-50%)', alignItems: 'center' };
            return (
              <div key={m.type} className="absolute flex flex-col" style={{ ...align, top: up ? '-46px' : '12px' }}>
                {!up && <div className="w-px h-3" style={{ background: 'var(--card-border)' }} />}
                <div className="text-[10px] whitespace-nowrap font-semibold" style={{ color: reached ? 'var(--muted-dim)' : 'var(--foreground)' }}>
                  {m.label}
                </div>
                <div className="text-[9px] whitespace-nowrap" style={{ color: 'var(--muted-dim)' }}>{fmtDate(m.date, { month: 'short', day: 'numeric' })}</div>
                {up && <div className="w-px h-3" style={{ background: 'var(--card-border)' }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResultsPanel({ season, teamById }: { season: SeasonData; teamById: (id: string) => Team | undefined }) {
  const ab = (id: string) => teamById(id)?.abbreviation ?? '—';
  return (
    <div className="ootp-panel">
      <div className="ootp-panel-header">
        <span>Latest Results</span>
        <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{season.recentDate ? fmtDate(season.recentDate) : '—'}</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {season.recent.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>No games played yet.</div>
        ) : (
          season.recent.map((g) => {
            const homeWon = g.homeScore > g.awayScore;
            return (
              <div key={g.id} className="flex items-center justify-between px-4 py-1.5 text-[13px]" style={{ borderBottom: '1px solid rgba(40,50,66,0.4)' }}>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums" style={{ color: !homeWon ? 'var(--foreground)' : 'var(--muted)', fontWeight: !homeWon ? 700 : 400 }}>
                    {ab(g.awayTeamId)} {g.awayScore}
                  </span>
                  <span style={{ color: 'var(--muted-dim)' }}>@</span>
                  <span className="font-mono tabular-nums" style={{ color: homeWon ? 'var(--foreground)' : 'var(--muted)', fontWeight: homeWon ? 700 : 400 }}>
                    {ab(g.homeTeamId)} {g.homeScore}
                  </span>
                </div>
                {g.overtimePeriods > 0 && <span className="text-[10px]" style={{ color: 'var(--accent)' }}>{g.overtimePeriods}OT</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function UpNextPanel({ season, teamById }: { season: SeasonData; teamById: (id: string) => Team | undefined }) {
  const ab = (id: string) => teamById(id)?.abbreviation ?? '—';
  const name = (id: string) => teamById(id)?.name ?? '—';
  return (
    <div className="ootp-panel">
      <div className="ootp-panel-header">
        <span>Up Next</span>
        <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{season.upcoming ? fmtDate(season.upcoming.date) : '—'}</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {!season.upcoming ? (
          <div className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Season complete.</div>
        ) : (
          season.upcoming.games.map((g) => (
            <div key={g.id} className="flex items-center gap-2 px-4 py-1.5 text-[13px]" style={{ borderBottom: '1px solid rgba(40,50,66,0.4)' }}>
              <span style={{ color: 'var(--muted)' }}>{ab(g.awayTeamId)} {name(g.awayTeamId)}</span>
              <span style={{ color: 'var(--muted-dim)' }}>@</span>
              <span style={{ color: 'var(--foreground)' }}>{ab(g.homeTeamId)} {name(g.homeTeamId)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${small ? 'px-3 py-1 text-[11px]' : 'px-4 py-1.5 text-xs'} font-semibold uppercase tracking-wider transition-colors`}
      style={{
        background: active ? 'linear-gradient(180deg, var(--chrome-top), var(--chrome-bottom))' : 'var(--card-bg)',
        color: active ? '#fff' : 'var(--muted)',
        border: '1px solid var(--card-border)',
        borderRadius: '3px',
        borderBottom: active ? '2px solid var(--accent)' : '1px solid var(--card-border)',
      }}
    >
      {children}
    </button>
  );
}

function StandingsTable({ title, standings, teamById, controlledTeamId }: {
  title: string;
  standings: Standing[];
  teamById: (id: string) => Team | undefined;
  controlledTeamId: string | null;
}) {
  const leaderWins = standings[0]?.wins ?? 0;
  const leaderLosses = standings[0]?.losses ?? 0;

  return (
    <div className="ootp-panel">
      <div className="ootp-panel-header">{title}</div>
      <div className="overflow-x-auto">
        <table className="ootp-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Team</th>
              <th style={{ textAlign: 'right' }}>W</th>
              <th style={{ textAlign: 'right' }}>L</th>
              <th style={{ textAlign: 'right' }}>PCT</th>
              <th style={{ textAlign: 'right' }}>GB</th>
              <th style={{ textAlign: 'right' }}>PF</th>
              <th style={{ textAlign: 'right' }}>PA</th>
              <th style={{ textAlign: 'right' }}>Strk</th>
              <th style={{ textAlign: 'left' }}>L10</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const team = teamById(s.teamId);
              const gp = s.wins + s.losses;
              const gb = ((leaderWins - s.wins) + (s.losses - leaderLosses)) / 2;
              const l10w = s.lastTen.filter((x) => x === 'W').length;
              const isPlayoff = i < 8;
              const isMine = controlledTeamId != null && s.teamId === controlledTeamId;
              return (
                <tr
                  key={s.teamId}
                  style={{
                    ...(isPlayoff ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined),
                    ...(isMine ? { background: 'var(--table-row-hover)' } : undefined),
                  }}
                >
                  <td className="whitespace-nowrap">
                    <span className="mr-2 inline-block w-4 text-right num" style={{ color: isPlayoff ? 'var(--accent)' : 'var(--muted-dim)', fontWeight: isPlayoff ? 700 : 400 }}>{i + 1}</span>
                    <Link href={`/roster?team=${s.teamId}`} className="hover:underline" style={{ color: 'var(--foreground)' }}>
                      <span className="font-bold" style={{ color: 'var(--accent)' }}>{team?.abbreviation}</span> {team?.name}
                    </Link>
                    {isMine && (
                      <span
                        className="ml-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded"
                        style={{ background: 'var(--accent)', color: 'var(--background)' }}
                      >
                        My Team
                      </span>
                    )}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{s.wins}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{s.losses}</td>
                  <td className="num">{winPct(s).toFixed(3).replace(/^0/, '')}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{gb === 0 ? '-' : gb.toFixed(1)}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{(s.pointsFor / Math.max(1, gp)).toFixed(1)}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{(s.pointsAgainst / Math.max(1, gp)).toFixed(1)}</td>
                  <td className="num" style={{ color: s.streak > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {s.streak > 0 ? `W${s.streak}` : `L${-s.streak}`}
                  </td>
                  <td style={{ textAlign: 'left', color: 'var(--muted)' }}>{l10w}-{s.lastTen.length - l10w}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadersTable({ stats, statKey, isPct, playerById, teamById }: {
  stats: PlayerStat[];
  statKey: LeaderKey;
  isPct: boolean;
  playerById: (id: string) => Player | undefined;
  teamById: (id: string) => Team | undefined;
}) {
  const fmt = (v: number) => (isPct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
  const label = LEADER_TABS.find((t) => t.key === statKey)?.label;
  return (
    <div className="ootp-panel">
      <div className="ootp-panel-header">League Leaders · {label}</div>
      <div className="overflow-x-auto">
        <table className="ootp-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>#</th>
              <th style={{ textAlign: 'left' }}>Player</th>
              <th style={{ textAlign: 'left' }}>Team</th>
              <th style={{ textAlign: 'right' }}>GP</th>
              <th style={{ textAlign: 'right' }}>MPG</th>
              <th style={{ textAlign: 'right', color: 'var(--accent)' }}>{label}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((p, i) => {
              const player = playerById(p.playerId);
              const team = teamById(p.teamId);
              return (
                <tr key={p.playerId}>
                  <td className="num" style={{ color: 'var(--muted-dim)', textAlign: 'left' }}>{i + 1}</td>
                  <td>
                    <Link href={`/player/${p.playerId}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                      {player ? `${player.firstName} ${player.lastName}` : p.playerId}
                    </Link>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{team?.abbreviation}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{p.gamesPlayed}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{p.mpg.toFixed(1)}</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(p[statKey])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * New-game setup. The player picks the one franchise they'll control; every other
 * team is CPU-run. Each team shows a quick roster-strength read so the choice
 * isn't blind. The selected id is sent to the API, which persists it on
 * SeasonState — the season-start path today, and the offseason-start path once
 * that lands (the API validates the selection the same way for both).
 */
function NewGameSetup({ teams, players, busy, existingSeason, onStart, onCancel }: {
  teams: Team[];
  players: Player[];
  busy: boolean;
  existingSeason: boolean;
  onStart: (teamId: string) => void;
  onCancel?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? teams.find((t) => t.id === selectedId) : undefined;

  if (teams.length < 2) {
    return (
      <div className="ootp-panel p-10 text-center" style={{ color: 'var(--muted)' }}>
        No team data found. Run the data ingestion script first.
      </div>
    );
  }

  const playerCount = (teamId: string) => players.filter((p) => p.teamId === teamId).length;

  const renderConf = (conf: 'East' | 'West', title: string) => {
    const confTeams = teams.filter((t) => t.conference === conf);
    const divisions = [...new Set(confTeams.map((t) => t.division))].sort();
    return (
      <div className="ootp-panel">
        <div className="ootp-panel-header">{title}</div>
        <div className="p-2">
          {divisions.map((div) => (
            <div key={div} className="mb-2 last:mb-0">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-wider px-2 py-1" style={{ color: 'var(--muted)', background: 'var(--table-header)' }}>
                {div}
              </h3>
              <div>
                {confTeams
                  .filter((t) => t.division === div)
                  .map((team) => {
                    const strength = rosterStrength(team.id, players);
                    const isSel = team.id === selectedId;
                    return (
                      <button
                        key={team.id}
                        onClick={() => setSelectedId(team.id)}
                        className="w-full flex items-center justify-between px-2 py-1.5 text-[13px] text-left transition-colors"
                        style={{
                          borderBottom: '1px solid rgba(40,50,66,0.4)',
                          background: isSel ? 'var(--table-row-hover)' : 'transparent',
                          boxShadow: isSel ? 'inset 3px 0 0 var(--accent)' : undefined,
                        }}
                      >
                        <span>
                          <span className="font-bold inline-block w-9" style={{ color: 'var(--accent)' }}>{team.abbreviation}</span>
                          <span>{team.city} {team.name}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{playerCount(team.id)} players</span>
                          {strength != null && (
                            <span
                              className="num font-bold tabular-nums w-6 text-right"
                              style={{ color: strengthColor(strength) }}
                              title="Roster strength — average overall of the top 8 players"
                            >
                              {strength}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold tracking-tight">New Game · Choose Your Team</h1>
        {onCancel && (
          <button onClick={onCancel} disabled={busy} className="ootp-btn">Cancel</button>
        )}
      </div>

      <p className="mb-4 text-[13px]" style={{ color: 'var(--muted)' }}>
        Pick the franchise you&apos;ll control — every other team is run by the CPU. The number beside
        each team is a quick roster-strength read (average overall of its top eight players).
        {existingSeason && (
          <span style={{ color: 'var(--danger)' }}> Starting a new game replaces your current one.</span>
        )}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderConf('East', 'Eastern Conference')}
        {renderConf('West', 'Western Conference')}
      </div>

      <div className="ootp-panel mt-4 flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="text-[13px]">
          {selected ? (
            <span>
              Controlling{' '}
              <span className="font-bold" style={{ color: 'var(--accent)' }}>{selected.city} {selected.name}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--muted)' }}>Select a team to begin.</span>
          )}
        </div>
        <button
          onClick={() => selectedId && onStart(selectedId)}
          disabled={busy || !selectedId}
          className="ootp-btn ootp-btn-primary ml-auto"
        >
          {busy ? 'Setting up…' : '▶ Start Season'}
        </button>
      </div>
    </div>
  );
}
