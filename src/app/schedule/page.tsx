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

interface SeasonData {
  gamesPlayed: number;
  standings: Standing[];
  playerStats: PlayerStat[];
}

type LeaderKey = 'ppg' | 'rpg' | 'apg' | 'spg' | 'bpg' | 'fgPct' | 'tpPct';

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

export default function SchedulePage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [season, setSeason] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'standings' | 'leaders'>('standings');
  const [leaderTab, setLeaderTab] = useState<LeaderKey>('ppg');

  useEffect(() => {
    Promise.all([
      fetch('/api/teams').then((r) => r.json()),
      fetch('/api/players').then((r) => r.json()),
    ]).then(([teamsData, playersData]) => {
      setTeams(teamsData);
      setPlayers(playersData);
    });
  }, []);

  const teamById = (id: string) => teams.find((t) => t.id === id);
  const playerById = (id: string) => players.find((p) => p.id === id);

  const simulate = async () => {
    setLoading(true);
    setSeason(null);
    const res = await fetch('/api/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: Math.floor(Math.random() * 1_000_000) }),
    });
    const data = await res.json();
    if (res.ok) setSeason(data);
    setLoading(false);
  };

  const conferenceStandings = (conf: 'East' | 'West'): Standing[] => {
    if (!season) return [];
    return season.standings
      .filter((s) => teamById(s.teamId)?.conference === conf)
      .sort((a, b) => winPct(b) - winPct(a));
  };

  const leaders = (key: LeaderKey): PlayerStat[] => {
    if (!season) return [];
    // Qualification: must have played a meaningful share of the season.
    const minGames = season.gamesPlayed > 0 ? Math.max(1, (season.gamesPlayed / 30) * 0.6) : 1;
    return [...season.playerStats]
      .filter((p) => p.gamesPlayed >= minGames && p.mpg >= 15)
      .sort((a, b) => b[key] - a[key])
      .slice(0, 15);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold tracking-tight">Standings &amp; Leaders</h1>
        <button
          onClick={simulate}
          disabled={loading || teams.length < 2}
          className="ootp-btn ootp-btn-primary"
        >
          {loading ? 'Simulating…' : season ? '↻ Re-Sim Season' : '▶ Simulate Season'}
        </button>
      </div>

      {!season && !loading && (
        <div className="ootp-panel p-8 text-center">
          <p style={{ color: 'var(--muted)' }}>
            Simulate a full regular season (86 games per team) to generate standings and league leaders.
          </p>
        </div>
      )}

      {loading && (
        <div className="ootp-panel p-8 text-center">
          <p style={{ color: 'var(--muted)' }}>Simulating ~1,290 games…</p>
        </div>
      )}

      {season && (
        <>
          <div className="flex gap-2 mb-4">
            <TabButton active={view === 'standings'} onClick={() => setView('standings')}>Standings</TabButton>
            <TabButton active={view === 'leaders'} onClick={() => setView('leaders')}>League Leaders</TabButton>
            <span className="ml-auto self-center text-xs" style={{ color: 'var(--muted)' }}>
              {season.gamesPlayed.toLocaleString()} games simulated
            </span>
          </div>

          {view === 'standings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StandingsTable title="Eastern Conference" standings={conferenceStandings('East')} teamById={teamById} />
              <StandingsTable title="Western Conference" standings={conferenceStandings('West')} teamById={teamById} />
            </div>
          )}

          {view === 'leaders' && (
            <div>
              <div className="flex flex-wrap gap-2 mb-4">
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
        </>
      )}
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
