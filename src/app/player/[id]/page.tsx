'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  secondaryPosition?: string;
  height: number;
  weight: number;
  age: number;
  experience: number;
  teamId: string;
  jerseyNumber: number;
  ratings: Record<string, number>;
  potential: Record<string, number>;
  scoutingAccuracy: number;
  tendencies: Record<string, number>;
  contract: { yearsRemaining: number; salaryPerYear: number };
  health: { healthy: boolean; injury?: string };
  careerStats: Array<{
    season: string;
    gamesPlayed: number;
    minutesPerGame: number;
    stats: Record<string, number>;
  }>;
}

interface Team {
  id: string;
  name: string;
  city: string;
  abbreviation: string;
}

function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function getRatingColor(value: number): string {
  if (value >= 70) return '#22c55e';
  if (value >= 60) return '#3b82f6';
  if (value >= 50) return '#8b5cf6';
  if (value >= 40) return '#f59e0b';
  if (value >= 30) return '#f97316';
  return '#ef4444';
}

function getRatingLabel(value: number): string {
  if (value >= 70) return 'Elite';
  if (value >= 60) return 'All-Star';
  if (value >= 50) return 'Above Avg';
  if (value >= 40) return 'Average';
  if (value >= 30) return 'Below Avg';
  return 'Poor';
}

const RATING_GROUPS = {
  Offensive: [
    { key: 'outsideShooting', label: '3PT Shooting' },
    { key: 'midrangeShooting', label: 'Mid-Range' },
    { key: 'interiorScoring', label: 'Interior' },
    { key: 'freeThrowShooting', label: 'Free Throws' },
    { key: 'ballHandling', label: 'Ball Handling' },
    { key: 'passing', label: 'Passing' },
    { key: 'offensiveIQ', label: 'Offensive IQ' },
  ],
  Defensive: [
    { key: 'perimeterDefense', label: 'Perimeter Def' },
    { key: 'interiorDefense', label: 'Interior Def' },
    { key: 'defensiveIQ', label: 'Defensive IQ' },
    { key: 'steal', label: 'Steal' },
    { key: 'block', label: 'Block' },
  ],
  Physical: [
    { key: 'athleticism', label: 'Athleticism' },
    { key: 'strength', label: 'Strength' },
    { key: 'rebounding', label: 'Rebounding' },
    { key: 'stamina', label: 'Stamina' },
    { key: 'durability', label: 'Durability' },
  ],
};

export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [player, setPlayer] = useState<Player | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/players').then((r) => r.json()),
      fetch('/api/teams').then((r) => r.json()),
    ]).then(([players, teamsData]) => {
      const found = players.find((p: Player) => p.id === id);
      setPlayer(found ?? null);
      setTeams(teamsData);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div style={{ color: 'var(--muted)' }}>Loading...</div>;
  if (!player) return <div>Player not found</div>;

  const team = teams.find((t) => t.id === player.teamId);
  const overall = Math.round(
    Object.values(player.ratings).reduce((a, b) => a + b, 0) / Object.values(player.ratings).length
  );
  const potentialOverall = Math.round(
    Object.values(player.potential).reduce((a, b) => a + b, 0) / Object.values(player.potential).length
  );

  return (
    <div>
      {/* Header */}
      <div className="rounded-lg p-6 mb-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl font-bold" style={{ color: 'var(--muted)' }}>#{player.jerseyNumber}</span>
              <h1 className="text-3xl font-bold">{player.firstName} {player.lastName}</h1>
            </div>
            <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--muted)' }}>
              <span>{player.position}{player.secondaryPosition ? `/${player.secondaryPosition}` : ''}</span>
              <span>{formatHeight(player.height)}, {player.weight} lbs</span>
              <span>Age {player.age}</span>
              <span>{player.experience} yr{player.experience !== 1 ? 's' : ''} exp</span>
              {team && (
                <Link href={`/roster?team=${team.id}`} style={{ color: 'var(--accent)' }}>
                  {team.city} {team.name}
                </Link>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold" style={{ color: getRatingColor(overall) }}>{overall}</div>
            <div className="text-xs uppercase" style={{ color: 'var(--muted)' }}>Overall</div>
            <div className="text-lg mt-1" style={{ color: getRatingColor(potentialOverall) }}>{potentialOverall} POT</div>
          </div>
        </div>

        {/* Contract */}
        <div className="mt-4 pt-4 flex gap-6 text-sm" style={{ borderTop: '1px solid var(--card-border)' }}>
          <span style={{ color: 'var(--muted)' }}>
            Contract: <span style={{ color: 'var(--foreground)' }}>${player.contract.salaryPerYear.toFixed(1)}M/yr</span>
            {' '}&middot; {player.contract.yearsRemaining} yr{player.contract.yearsRemaining !== 1 ? 's' : ''} remaining
          </span>
          <span style={{ color: player.health.healthy ? 'var(--success)' : 'var(--danger)' }}>
            {player.health.healthy ? 'Healthy' : player.health.injury}
          </span>
        </div>
      </div>

      {/* Ratings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {Object.entries(RATING_GROUPS).map(([group, ratings]) => (
          <div key={group} className="rounded-lg p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <h2 className="font-semibold mb-3">{group}</h2>
            <div className="space-y-2">
              {ratings.map(({ key, label }) => {
                const current = player.ratings[key] ?? 0;
                const pot = player.potential[key] ?? 0;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-24 shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
                    <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'var(--background)' }}>
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${(current / 80) * 100}%`,
                          background: getRatingColor(current),
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <span className="text-sm font-mono w-8 text-right font-bold" style={{ color: getRatingColor(current) }}>
                      {current}
                    </span>
                    <span className="text-xs font-mono w-6 text-right" style={{ color: getRatingColor(pot), opacity: 0.6 }}>
                      {pot}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Career Stats */}
      {player.careerStats.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          <div className="px-4 py-3 font-semibold" style={{ background: 'var(--table-header)' }}>Career Stats</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--table-header)' }}>
                  <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--muted)' }}>Season</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>GP</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>MPG</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>PPG</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>FG%</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>3P%</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>FT%</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>RPG</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>APG</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>SPG</th>
                  <th className="px-2 py-2 text-right text-xs" style={{ color: 'var(--muted)' }}>BPG</th>
                </tr>
              </thead>
              <tbody>
                {player.careerStats.map((season) => (
                  <tr key={season.season} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td className="px-3 py-1.5 font-medium">{season.season}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{season.gamesPlayed}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{season.minutesPerGame.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold">{season.stats.points?.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{((season.stats.fieldGoalPct ?? 0) * 100).toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{((season.stats.threePointPct ?? 0) * 100).toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{((season.stats.freeThrowPct ?? 0) * 100).toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{season.stats.rebounds?.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{season.stats.assists?.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{season.stats.steals?.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{season.stats.blocks?.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
