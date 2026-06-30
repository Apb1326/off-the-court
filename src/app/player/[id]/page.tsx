'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { ratingHex as getRatingColor } from '@/lib/ui';

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
  contract: {
    yearsRemaining?: number;
    salaryPerYear?: number;
    salarySchedule?: number[];
    type?: string;
    noTradeClause?: boolean;
  };
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
      <div className="ootp-panel mb-4" style={{ borderTop: `3px solid ${getRatingColor(overall)}` }}>
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl font-bold" style={{ color: 'var(--muted-dim)' }}>#{player.jerseyNumber}</span>
                <h1 className="text-2xl font-bold">{player.firstName} {player.lastName}</h1>
              </div>
              <div className="flex items-center gap-4 text-[13px]" style={{ color: 'var(--muted)' }}>
                <span className="ootp-pill" style={{ background: 'var(--table-header)', color: 'var(--foreground)' }}>{player.position}{player.secondaryPosition ? `/${player.secondaryPosition}` : ''}</span>
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
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-4xl font-black tabular-nums" style={{ color: getRatingColor(overall) }}>{overall}</div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Overall</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold tabular-nums" style={{ color: getRatingColor(potentialOverall) }}>{potentialOverall}</div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Potential</div>
              </div>
            </div>
          </div>

          {/* Contract */}
          <div className="mt-4 pt-3 flex gap-6 text-[13px]" style={{ borderTop: '1px solid var(--card-border)' }}>
            <span style={{ color: 'var(--muted)' }}>
              Contract: <span style={{ color: 'var(--foreground)' }}>${(player.contract.salarySchedule?.[0] ?? player.contract.salaryPerYear ?? 0).toFixed(1)}M/yr</span>
              {' '}&middot; {player.contract.salarySchedule?.length ?? player.contract.yearsRemaining ?? 0} yr{(player.contract.salarySchedule?.length ?? player.contract.yearsRemaining ?? 0) !== 1 ? 's' : ''} remaining
            </span>
            <span style={{ color: player.health.healthy ? 'var(--success)' : 'var(--danger)' }}>
              {player.health.healthy ? '● Healthy' : `✚ ${player.health.injury}`}
            </span>
          </div>
        </div>
      </div>

      {/* Ratings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {Object.entries(RATING_GROUPS).map(([group, ratings]) => (
          <div key={group} className="ootp-panel">
            <div className="ootp-panel-header">{group}</div>
            <div className="p-3 space-y-2">
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
        <div className="ootp-panel">
          <div className="ootp-panel-header">Career Stats</div>
          <div className="overflow-x-auto">
            <table className="ootp-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Season</th>
                  <th style={{ textAlign: 'right' }}>GP</th>
                  <th style={{ textAlign: 'right' }}>MPG</th>
                  <th style={{ textAlign: 'right' }}>PPG</th>
                  <th style={{ textAlign: 'right' }}>FG%</th>
                  <th style={{ textAlign: 'right' }}>3P%</th>
                  <th style={{ textAlign: 'right' }}>FT%</th>
                  <th style={{ textAlign: 'right' }}>RPG</th>
                  <th style={{ textAlign: 'right' }}>APG</th>
                  <th style={{ textAlign: 'right' }}>SPG</th>
                  <th style={{ textAlign: 'right' }}>BPG</th>
                </tr>
              </thead>
              <tbody>
                {player.careerStats.map((season) => (
                  <tr key={season.season}>
                    <td style={{ fontWeight: 600 }}>{season.season}</td>
                    <td className="num">{season.gamesPlayed}</td>
                    <td className="num">{season.minutesPerGame.toFixed(1)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{season.stats.points?.toFixed(1)}</td>
                    <td className="num">{((season.stats.fieldGoalPct ?? 0) * 100).toFixed(1)}</td>
                    <td className="num">{((season.stats.threePointPct ?? 0) * 100).toFixed(1)}</td>
                    <td className="num">{((season.stats.freeThrowPct ?? 0) * 100).toFixed(1)}</td>
                    <td className="num">{season.stats.rebounds?.toFixed(1)}</td>
                    <td className="num">{season.stats.assists?.toFixed(1)}</td>
                    <td className="num">{season.stats.steals?.toFixed(1)}</td>
                    <td className="num">{season.stats.blocks?.toFixed(1)}</td>
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
