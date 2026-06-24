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
      <h1 className="text-xl font-bold mb-3 tracking-tight">Game Simulation</h1>

      <div className="ootp-panel mb-4">
        <div className="ootp-toolbar" style={{ justifyContent: 'center', gap: '20px' }}>
          <label className="flex items-center gap-2">
            <span className="uppercase tracking-wider text-[11px]" style={{ color: 'var(--muted)' }}>Home</span>
            <select
              className="ootp-select min-w-[190px]"
              value={homeTeamId}
              onChange={(e) => setHomeTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.city} {t.name}</option>
              ))}
            </select>
          </label>

          <span className="font-bold" style={{ color: 'var(--muted)' }}>VS</span>

          <label className="flex items-center gap-2">
            <span className="uppercase tracking-wider text-[11px]" style={{ color: 'var(--muted)' }}>Away</span>
            <select
              className="ootp-select min-w-[190px]"
              value={awayTeamId}
              onChange={(e) => setAwayTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.city} {t.name}</option>
              ))}
            </select>
          </label>

          <button
            onClick={simulate}
            disabled={simming || homeTeamId === awayTeamId}
            className="ootp-btn ootp-btn-primary"
          >
            {simming ? 'Simulating…' : '▶ Simulate Game'}
          </button>
        </div>

        {homeTeamId === awayTeamId && (
          <p className="text-center py-2 text-xs" style={{ color: 'var(--danger)' }}>
            Select two different teams
          </p>
        )}
      </div>

      {result && (
        <div>
          {/* Score Banner */}
          <div className="ootp-panel mb-4" style={{ background: 'linear-gradient(180deg, var(--chrome-top), var(--chrome-bottom))' }}>
            <div className="py-5 text-center">
              <div className="text-[11px] mb-3 uppercase tracking-widest" style={{ color: 'var(--chrome-text)', opacity: 0.7 }}>
                Final{result.result.overtimePeriods > 0 ? ` · ${result.result.overtimePeriods}OT` : ''}
              </div>
              <div className="flex items-center justify-center gap-10">
                <div className={`text-center ${result.result.winnerId === homeTeamId ? '' : 'opacity-55'}`}>
                  <div className="text-sm mb-1 font-semibold tracking-wide" style={{ color: 'var(--chrome-text)' }}>{homeTeam?.abbreviation}</div>
                  <div className="text-4xl font-black text-white tabular-nums">{result.result.homeScore}</div>
                  {result.result.winnerId === homeTeamId && <div className="text-[10px] mt-1 font-bold" style={{ color: 'var(--accent)' }}>WIN</div>}
                </div>
                <span className="text-2xl" style={{ color: 'var(--muted)' }}>–</span>
                <div className={`text-center ${result.result.winnerId === awayTeamId ? '' : 'opacity-55'}`}>
                  <div className="text-sm mb-1 font-semibold tracking-wide" style={{ color: 'var(--chrome-text)' }}>{awayTeam?.abbreviation}</div>
                  <div className="text-4xl font-black text-white tabular-nums">{result.result.awayScore}</div>
                  {result.result.winnerId === awayTeamId && <div className="text-[10px] mt-1 font-bold" style={{ color: 'var(--accent)' }}>WIN</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Box Scores */}
          <div className="grid grid-cols-1 gap-4">
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
    <div className="ootp-panel">
      <div className="ootp-panel-header">{title}</div>
      <div className="overflow-x-auto">
        <table className="ootp-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Player</th>
              <th style={{ textAlign: 'right' }}>MIN</th>
              <th style={{ textAlign: 'right', color: 'var(--foreground)' }}>PTS</th>
              <th style={{ textAlign: 'right' }}>FG</th>
              <th style={{ textAlign: 'right' }}>3PT</th>
              <th style={{ textAlign: 'right' }}>FT</th>
              <th style={{ textAlign: 'right' }}>REB</th>
              <th style={{ textAlign: 'right' }}>AST</th>
              <th style={{ textAlign: 'right' }}>STL</th>
              <th style={{ textAlign: 'right' }}>BLK</th>
              <th style={{ textAlign: 'right' }}>TO</th>
              <th style={{ textAlign: 'right' }}>+/-</th>
            </tr>
          </thead>
          <tbody>
            {team.players.map((p, i) => {
              const s = p.stats;
              const fgParts = `${s.fieldGoalsMade}-${s.fieldGoalsAttempted}`;
              const threeParts = `${s.threePointersMade}-${s.threePointersAttempted}`;
              const ftParts = `${s.freeThrowsMade}-${s.freeThrowsAttempted}`;
              const showDivider = i === 5; // after starters

              return (
                <tr
                  key={p.playerId}
                  style={showDivider ? { borderTop: '2px solid var(--chrome-border)' } : undefined}
                >
                  <td>
                    <Link href={`/player/${p.playerId}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                      {p.starter && <span className="mr-1" style={{ color: 'var(--success)' }}>●</span>}
                      {playerNames.get(p.playerId) ?? p.playerId}
                    </Link>
                  </td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{Math.round(p.minutes)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{s.points}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{fgParts}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{threeParts}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{ftParts}</td>
                  <td className="num">{s.rebounds}</td>
                  <td className="num">{s.assists}</td>
                  <td className="num">{s.steals}</td>
                  <td className="num">{s.blocks}</td>
                  <td className="num">{s.turnovers}</td>
                  <td className="num" style={{
                    color: s.plusMinus > 0 ? 'var(--success)' : s.plusMinus < 0 ? 'var(--danger)' : 'var(--muted)'
                  }}>
                    {s.plusMinus > 0 ? '+' : ''}{s.plusMinus}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr style={{ borderTop: '2px solid var(--chrome-border)', background: 'var(--table-header)' }}>
              <td style={{ fontWeight: 700 }}>TOTALS</td>
              <td></td>
              <td className="num" style={{ fontWeight: 700 }}>{team.totals.points}</td>
              <td className="num" style={{ color: 'var(--muted)' }}>{team.totals.fieldGoalsMade}-{team.totals.fieldGoalsAttempted}</td>
              <td className="num" style={{ color: 'var(--muted)' }}>{team.totals.threePointersMade}-{team.totals.threePointersAttempted}</td>
              <td className="num" style={{ color: 'var(--muted)' }}>{team.totals.freeThrowsMade}-{team.totals.freeThrowsAttempted}</td>
              <td className="num">{team.totals.rebounds}</td>
              <td className="num">{team.totals.assists}</td>
              <td className="num">{team.totals.steals}</td>
              <td className="num">{team.totals.blocks}</td>
              <td className="num">{team.totals.turnovers}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
