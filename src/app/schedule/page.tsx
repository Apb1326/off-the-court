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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Schedule &amp; Standings</h1>
        <button
          onClick={simulate}
          disabled={loading || teams.length < 2}
          className="rounded px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#0f1117' }}
        >
          {loading ? 'Simulating…' : season ? 'Re-Simulate Season' : 'Simulate Season'}
        </button>
      </div>

      {!season && !loading && (
        <div className="rounded-lg p-8 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          <p style={{ color: 'var(--muted)' }}>
            Simulate a full regular season (86 games per team) to generate standings and league leaders.
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-lg p-8 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
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
      className={`rounded ${small ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'} font-medium transition-colors`}
      style={{
        background: active ? 'var(--accent)' : 'var(--card-bg)',
        color: active ? '#0f1117' : 'var(--muted)',
        border: '1px solid var(--card-border)',
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
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="px-4 py-3 font-semibold" style={{ background: 'var(--table-header)' }}>{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--table-header)' }}>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>Team</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>W</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>L</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>PCT</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>GB</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>PF</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>PA</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>Strk</th>
              <th className="px-2 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>L10</th>
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
                <tr key={s.teamId} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="text-xs mr-2 inline-block w-4 text-right" style={{ color: isPlayoff ? 'var(--accent)' : 'var(--muted)' }}>{i + 1}</span>
                    <Link href={`/roster?team=${s.teamId}`} className="hover:underline" style={{ color: 'var(--foreground)' }}>
                      <span style={{ color: 'var(--accent)' }}>{team?.abbreviation}</span> {team?.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{s.wins}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{s.losses}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{winPct(s).toFixed(3).replace(/^0/, '')}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{gb === 0 ? '-' : gb.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{(s.pointsFor / Math.max(1, gp)).toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{(s.pointsAgainst / Math.max(1, gp)).toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: s.streak > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {s.streak > 0 ? `W${s.streak}` : `L${-s.streak}`}
                  </td>
                  <td className="px-2 py-1.5 text-left font-mono text-xs" style={{ color: 'var(--muted)' }}>{l10w}-{s.lastTen.length - l10w}</td>
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
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--table-header)' }}>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>#</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>Player</th>
              <th className="px-2 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>Team</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>GP</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>MPG</th>
              <th className="px-2 py-2 text-right text-xs font-medium uppercase" style={{ color: 'var(--accent)' }}>{LEADER_TABS.find((t) => t.key === statKey)?.label}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((p, i) => {
              const player = playerById(p.playerId);
              const team = teamById(p.teamId);
              return (
                <tr key={p.playerId} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/player/${p.playerId}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                      {player ? `${player.firstName} ${player.lastName}` : p.playerId}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--muted)' }}>{team?.abbreviation}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{p.gamesPlayed}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{p.mpg.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{fmt(p[statKey])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
