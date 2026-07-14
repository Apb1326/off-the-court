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

interface PlayoffSeries {
  id: string;
  round: 'play_in' | 'first_round' | 'conference_semifinals' | 'conference_finals' | 'finals';
  conference: 'East' | 'West' | null;
  bracketPosition: string;
  teamAId: string;
  teamBId: string;
  teamASeed: number;
  teamBSeed: number;
  teamAWins: number;
  teamBWins: number;
  winsRequired: number;
  winnerTeamId: string | null;
}

interface SeasonData {
  seasonId: string;
  startDate: string;
  endDate: string;
  currentDate: string;
  gamesPlayed: number;
  totalGames: number;
  phase: 'preseason' | 'regular_season' | 'playoffs' | 'offseason';
  regularSeasonComplete: boolean;
  seasonComplete: boolean;
  seasonOver: boolean;
  markers: Marker[];
  standings: Standing[];
  playerStats: PlayerStat[];
  recentDate: string | null;
  recent: GameSummary[];
  upcoming: { date: string; games: { id: string; homeTeamId: string; awayTeamId: string }[] } | null;
  playoffs: {
    status: 'pending' | 'in_progress' | 'complete' | 'grandfathered_complete';
    playInEnabled: boolean;
    gamesPlayed: number;
    championTeamId: string | null;
    series: PlayoffSeries[];
  };
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

type AdvanceMode = 'day' | 'week' | 'marker' | 'rest';

export default function SchedulePage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [season, setSeason] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'standings' | 'leaders' | 'playoffs'>('standings');
  const [leaderTab, setLeaderTab] = useState<LeaderKey>('ppg');

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

  const newSeason = () => {
    if (season && !confirm('Start a new season? This replaces the current one.')) return;
    // +1 keeps the UI-chosen seed within the API's supported range (min 1).
    post({ action: 'new', seed: Math.floor(Math.random() * 1_000_000) + 1 });
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

  if (!season) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-4">Season</h1>
        <div className="ootp-panel p-10 text-center">
          <p className="mb-4" style={{ color: 'var(--muted)' }}>
            No season in progress. Start a fresh 82-game regular season and advance it day by day.
          </p>
          <button onClick={newSeason} disabled={busy || teams.length < 2} className="ootp-btn ootp-btn-primary">
            {busy ? 'Setting up…' : '▶ Start New Season'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ControlBar
        season={season}
        nextMarker={nextMarker}
        busy={busy}
        onAdvance={advance}
        onNew={newSeason}
        championName={season.playoffs.championTeamId
          ? `${teamById(season.playoffs.championTeamId)?.city ?? ''} ${teamById(season.playoffs.championTeamId)?.name ?? season.playoffs.championTeamId}`.trim()
          : null}
      />

      <MarkersTimeline season={season} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <ResultsPanel season={season} teamById={teamById} />
        <UpNextPanel season={season} teamById={teamById} />
      </div>

      <div className="flex gap-2 mt-5 mb-3">
        <TabButton active={view === 'standings'} onClick={() => setView('standings')}>Standings</TabButton>
        <TabButton active={view === 'leaders'} onClick={() => setView('leaders')}>League Leaders</TabButton>
        <TabButton active={view === 'playoffs'} onClick={() => setView('playoffs')}>Playoffs</TabButton>
      </div>

      {view === 'standings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StandingsTable title="Eastern Conference" standings={conferenceStandings('East')} teamById={teamById} />
          <StandingsTable title="Western Conference" standings={conferenceStandings('West')} teamById={teamById} />
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

      {view === 'playoffs' && (
        <PlayoffBracket playoffs={season.playoffs} teamById={teamById} />
      )}
    </div>
  );
}

function ControlBar({ season, nextMarker, busy, onAdvance, onNew, championName }: {
  season: SeasonData;
  nextMarker?: Marker;
  busy: boolean;
  onAdvance: (m: AdvanceMode) => void;
  onNew: () => void;
  championName: string | null;
}) {
  const pct = Math.round((season.gamesPlayed / season.totalGames) * 100);
  const activeRound = season.playoffs.series.find((series) => !series.winnerTeamId)?.round;
  const playoffLabel = activeRound ? ROUND_LABEL[activeRound] : 'Postseason';
  return (
    <div className="ootp-panel">
      <div className="ootp-statusbar flex flex-wrap items-center gap-4 px-4 py-3">
        <div>
          <div className="text-lg font-bold text-white leading-tight">
            {season.seasonComplete
              ? (championName ? `Champion: ${championName}` : 'Season Complete')
              : fmtDate(season.currentDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--chrome-text)', opacity: 0.8 }}>
            {season.phase === 'playoffs'
              ? `${playoffLabel} · ${season.playoffs.gamesPlayed} postseason games played`
              : `Game ${season.gamesPlayed.toLocaleString()} of ${season.totalGames.toLocaleString()} · ${pct}%`}
            {nextMarker && !season.regularSeasonComplete && (
              <span> · {nextMarker.label} in {Math.max(0, daysBetween(season.currentDate, nextMarker.date))}d</span>
            )}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!season.seasonComplete ? (
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
              <button onClick={() => onAdvance('rest')} disabled={busy} className="ootp-btn">Sim to Season End</button>
            </>
          ) : (
            <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Season finished — view the bracket below</span>
          )}
          <button onClick={onNew} disabled={busy} className="ootp-btn" title="Start a new season">⟳ New</button>
        </div>
      </div>
      {season.phase !== 'playoffs' && (
        <div style={{ height: '4px', background: 'var(--background)' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
      )}
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
          <div className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            {season.seasonComplete ? 'Season complete.' : 'Awaiting the next postseason matchup.'}
          </div>
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

const ROUND_LABEL: Record<PlayoffSeries['round'], string> = {
  play_in: 'Play-In',
  first_round: 'First Round',
  conference_semifinals: 'Conference Semifinals',
  conference_finals: 'Conference Finals',
  finals: 'NBA Finals',
};

function PlayoffBracket({ playoffs, teamById }: {
  playoffs: SeasonData['playoffs'];
  teamById: (id: string) => Team | undefined;
}) {
  const rounds: PlayoffSeries['round'][] = [
    'play_in', 'first_round', 'conference_semifinals', 'conference_finals', 'finals',
  ];
  if (playoffs.status === 'pending') {
    return <div className="ootp-panel p-8 text-center" style={{ color: 'var(--muted)' }}>The bracket locks when the regular season ends.</div>;
  }
  if (playoffs.status === 'grandfathered_complete') {
    return <div className="ootp-panel p-8 text-center" style={{ color: 'var(--muted)' }}>This legacy season finished before playoff brackets were tracked.</div>;
  }
  return (
    <div className="space-y-4">
      {playoffs.championTeamId && (
        <div className="ootp-panel p-5 text-center">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Champion</div>
          <div className="text-2xl font-black mt-1" style={{ color: 'var(--accent)' }}>
            {teamById(playoffs.championTeamId)?.city} {teamById(playoffs.championTeamId)?.name}
          </div>
        </div>
      )}
      {rounds.map((round) => {
        const series = playoffs.series.filter((item) => item.round === round);
        if (series.length === 0) return null;
        return (
          <section key={round} className="ootp-panel">
            <div className="ootp-panel-header">{ROUND_LABEL[round]}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 p-3">
              {series.map((item) => (
                <div key={item.id} className="p-3 rounded-sm" style={{ background: 'var(--table-header)', border: '1px solid var(--card-border)' }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--muted-dim)' }}>
                    {item.conference ?? 'League'} · {item.bracketPosition}
                  </div>
                  {([
                    [item.teamAId, item.teamASeed, item.teamAWins],
                    [item.teamBId, item.teamBSeed, item.teamBWins],
                  ] as const).map(([teamId, seed, wins]) => (
                    <div key={teamId} className="flex items-center gap-2 py-1 text-sm" style={{ fontWeight: item.winnerTeamId === teamId ? 800 : 500 }}>
                      <span className="w-5 text-right" style={{ color: 'var(--muted)' }}>{seed}</span>
                      <span className="flex-1">{teamById(teamId)?.abbreviation ?? teamId}</span>
                      <span className="font-mono" style={{ color: item.winnerTeamId === teamId ? 'var(--accent)' : 'var(--foreground)' }}>{wins}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StandingsTable({ title, standings, teamById }: {
  title: string;
  standings: Standing[];
  teamById: (id: string) => Team | undefined;
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
              return (
                <tr key={s.teamId} style={isPlayoff ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                  <td className="whitespace-nowrap">
                    <span className="mr-2 inline-block w-4 text-right num" style={{ color: isPlayoff ? 'var(--accent)' : 'var(--muted-dim)', fontWeight: isPlayoff ? 700 : 400 }}>{i + 1}</span>
                    <Link href={`/roster?team=${s.teamId}`} className="hover:underline" style={{ color: 'var(--foreground)' }}>
                      <span className="font-bold" style={{ color: 'var(--accent)' }}>{team?.abbreviation}</span> {team?.name}
                    </Link>
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
