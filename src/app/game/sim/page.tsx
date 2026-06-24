'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  city: string;
  abbreviation: string;
}

interface SimResult {
  gameId: string;
  result: {
    homeScore: number;
    awayScore: number;
    overtimePeriods: number;
    winnerId: string;
  };
  boxScore: {
    homeTeam: TeamBoxScore;
    awayTeam: TeamBoxScore;
  };
}

interface TeamBoxScore {
  teamId: string;
  players: PlayerBoxLine[];
  totals: Record<string, number>;
}

interface PlayerBoxLine {
  playerId: string;
  starter: boolean;
  minutes: number;
  stats: Record<string, number>;
}

export default function SimPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');
  const [simming, setSimming] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [playerNames, setPlayerNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetch('/api/teams')
      .then((r) => r.json())
      .then((data: Team[]) => {
        setTeams(data);
        if (data.length >= 2) {
          setHomeTeamId(data[0].id);
          setAwayTeamId(data[1].id);
        }
      });
  }, []);

  const simulate = async () => {
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) return;
    setSimming(true);
    setResult(null);

    // Fetch player names for both teams
    const [homePlayers, awayPlayers] = await Promise.all([
      fetch(`/api/players?teamId=${homeTeamId}`).then((r) => r.json()),
      fetch(`/api/players?teamId=${awayTeamId}`).then((r) => r.json()),
    ]);
    const names = new Map<string, string>();
    for (const p of [...homePlayers, ...awayPlayers]) {
      names.set(p.id, `${p.firstName} ${p.lastName}`);
    }
    setPlayerNames(names);

    const res = await fetch('/api/sim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeTeamId, awayTeamId, seed: Date.now() }),
    });

    const data = await res.json();
    setResult(data);
    setSimming(false);
  };

  const homeTeam = teams.find((t) => t.id === homeTeamId);
  const awayTeam = teams.find((t) => t.id === awayTeamId);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Game Simulation</h1>

      <div className="rounded-lg p-6 mb-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-center gap-6 justify-center">
          <div className="text-center">
            <label className="block text-xs mb-2 uppercase" style={{ color: 'var(--muted)' }}>Home</label>
            <select
              className="rounded px-3 py-2 text-sm min-w-[200px]"
              style={{ background: 'var(--background)', border: '1px solid var(--card-border)', color: 'var(--foreground)' }}
              value={homeTeamId}
              onChange={(e) => setHomeTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.city} {t.name}</option>
              ))}
            </select>
          </div>

          <span className="text-xl font-bold" style={{ color: 'var(--muted)' }}>vs</span>

          <div className="text-center">
            <label className="block text-xs mb-2 uppercase" style={{ color: 'var(--muted)' }}>Away</label>
            <select
              className="rounded px-3 py-2 text-sm min-w-[200px]"
              style={{ background: 'var(--background)', border: '1px solid var(--card-border)', color: 'var(--foreground)' }}
              value={awayTeamId}
              onChange={(e) => setAwayTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.city} {t.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={simulate}
            disabled={simming || homeTeamId === awayTeamId}
            className="px-6 py-2 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {simming ? 'Simulating...' : 'Simulate Game'}
          </button>
        </div>

        {homeTeamId === awayTeamId && (
          <p className="text-center mt-3 text-sm" style={{ color: 'var(--danger)' }}>
            Select two different teams
          </p>
        )}
      </div>

      {result && (
        <div>
          {/* Score Banner */}
          <div className="rounded-lg p-6 mb-6 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <div className="text-sm mb-2 uppercase" style={{ color: 'var(--muted)' }}>Final{result.result.overtimePeriods > 0 ? ` (${result.result.overtimePeriods}OT)` : ''}</div>
            <div className="flex items-center justify-center gap-8 text-3xl font-bold">
              <div className={result.result.winnerId === homeTeamId ? '' : 'opacity-60'}>
                <div className="text-sm mb-1" style={{ color: 'var(--muted)' }}>{homeTeam?.abbreviation}</div>
                {result.result.homeScore}
              </div>
              <span style={{ color: 'var(--muted)' }}>-</span>
              <div className={result.result.winnerId === awayTeamId ? '' : 'opacity-60'}>
                <div className="text-sm mb-1" style={{ color: 'var(--muted)' }}>{awayTeam?.abbreviation}</div>
                {result.result.awayScore}
              </div>
            </div>
          </div>

          {/* Box Scores */}
          <div className="grid grid-cols-1 gap-6">
            <BoxScoreTable
              title={`${homeTeam?.city} ${homeTeam?.name}`}
              team={result.boxScore.homeTeam}
              playerNames={playerNames}
            />
            <BoxScoreTable
              title={`${awayTeam?.city} ${awayTeam?.name}`}
              team={result.boxScore.awayTeam}
              playerNames={playerNames}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BoxScoreTable({
  title,
  team,
  playerNames,
}: {
  title: string;
  team: TeamBoxScore;
  playerNames: Map<string, string>;
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="px-4 py-3 font-semibold" style={{ background: 'var(--table-header)' }}>{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--table-header)' }}>
              <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--muted)', width: '180px' }}>Player</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>MIN</th>
              <th className="px-2 py-2 text-right text-xs font-bold" style={{ color: 'var(--foreground)' }}>PTS</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>FG</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>3PT</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>FT</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>REB</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>AST</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>STL</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>BLK</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>TO</th>
              <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>+/-</th>
            </tr>
          </thead>
          <tbody>
            {team.players.map((p, i) => {
              const s = p.stats;
              const fgParts = `${s.fieldGoalsMade}-${s.fieldGoalsAttempted}`;
              const threeParts = `${s.threePointersMade}-${s.threePointersAttempted}`;
              const ftParts = `${s.freeThrowsMade}-${s.freeThrowsAttempted}`;
              const showDivider = i === 4; // after starters

              return (
                <tr
                  key={p.playerId}
                  style={{
                    borderTop: showDivider ? '2px solid var(--accent)' : '1px solid var(--card-border)',
                  }}
                >
                  <td className="px-3 py-1.5">
                    <Link href={`/player/${p.playerId}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                      {playerNames.get(p.playerId) ?? p.playerId}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--muted)' }}>{Math.round(p.minutes)}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{s.points}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>{fgParts}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>{threeParts}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>{ftParts}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.rebounds}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.assists}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.steals}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.blocks}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.turnovers}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{
                    color: s.plusMinus > 0 ? 'var(--success)' : s.plusMinus < 0 ? 'var(--danger)' : 'var(--muted)'
                  }}>
                    {s.plusMinus > 0 ? '+' : ''}{s.plusMinus}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr style={{ borderTop: '2px solid var(--card-border)', background: 'var(--table-header)' }}>
              <td className="px-3 py-2 font-semibold">TOTALS</td>
              <td className="px-2 py-2 text-right font-mono" style={{ color: 'var(--muted)' }}></td>
              <td className="px-2 py-2 text-right font-mono font-bold">{team.totals.points}</td>
              <td className="px-2 py-2 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                {team.totals.fieldGoalsMade}-{team.totals.fieldGoalsAttempted}
              </td>
              <td className="px-2 py-2 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                {team.totals.threePointersMade}-{team.totals.threePointersAttempted}
              </td>
              <td className="px-2 py-2 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                {team.totals.freeThrowsMade}-{team.totals.freeThrowsAttempted}
              </td>
              <td className="px-2 py-2 text-right font-mono">{team.totals.rebounds}</td>
              <td className="px-2 py-2 text-right font-mono">{team.totals.assists}</td>
              <td className="px-2 py-2 text-right font-mono">{team.totals.steals}</td>
              <td className="px-2 py-2 text-right font-mono">{team.totals.blocks}</td>
              <td className="px-2 py-2 text-right font-mono">{team.totals.turnovers}</td>
              <td className="px-2 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
