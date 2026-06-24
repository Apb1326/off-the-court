'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

interface Team {
  id: string;
  name: string;
  city: string;
  abbreviation: string;
  conference: string;
  roster: string[];
  rotation: { starters: string[] };
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  height: number;
  weight: number;
  age: number;
  jerseyNumber: number;
  ratings: Record<string, number>;
  careerStats: Array<{ stats: Record<string, number>; minutesPerGame: number; gamesPlayed: number }>;
}

function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function getOverall(ratings: Record<string, number>): number {
  const values = Object.values(ratings);
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function getRatingColor(value: number): string {
  if (value >= 70) return '#22c55e';
  if (value >= 60) return '#3b82f6';
  if (value >= 50) return '#8b5cf6';
  if (value >= 40) return '#f59e0b';
  if (value >= 30) return '#f97316';
  return '#ef4444';
}

function RosterContent() {
  const searchParams = useSearchParams();
  const teamIdParam = searchParams.get('team');

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(teamIdParam ?? '');
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>('overall');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    fetch('/api/teams')
      .then((r) => r.json())
      .then((data: Team[]) => {
        setTeams(data);
        if (!selectedTeamId && data.length > 0) {
          setSelectedTeamId(data[0].id);
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedTeamId) return;
    setLoading(true);
    fetch(`/api/players?teamId=${selectedTeamId}`)
      .then((r) => r.json())
      .then((data: Player[]) => {
        setPlayers(data);
        setLoading(false);
      });
  }, [selectedTeamId]);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  const sortedPlayers = [...players].sort((a, b) => {
    let aVal: number, bVal: number;
    if (sortBy === 'overall') {
      aVal = getOverall(a.ratings);
      bVal = getOverall(b.ratings);
    } else if (sortBy === 'name') {
      return sortAsc
        ? a.lastName.localeCompare(b.lastName)
        : b.lastName.localeCompare(a.lastName);
    } else if (sortBy === 'age') {
      aVal = a.age;
      bVal = b.age;
    } else if (sortBy === 'ppg') {
      aVal = a.careerStats[0]?.stats.points ?? 0;
      bVal = b.careerStats[0]?.stats.points ?? 0;
    } else {
      aVal = a.ratings[sortBy] ?? 0;
      bVal = b.ratings[sortBy] ?? 0;
    }
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const SortHeader = ({ col, label, width }: { col: string; label: string; width?: string }) => (
    <th
      className="px-2 py-2 text-left text-xs font-medium uppercase cursor-pointer select-none"
      style={{ color: sortBy === col ? 'var(--accent)' : 'var(--muted)', width }}
      onClick={() => handleSort(col)}
    >
      {label} {sortBy === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Roster</h1>
        <select
          className="rounded px-3 py-1.5 text-sm"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--foreground)' }}
          value={selectedTeamId}
          onChange={(e) => setSelectedTeamId(e.target.value)}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Loading...</div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--table-header)' }}>
                  <SortHeader col="name" label="Player" width="200px" />
                  <th className="px-2 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>Pos</th>
                  <SortHeader col="age" label="Age" />
                  <th className="px-2 py-2 text-left text-xs font-medium uppercase" style={{ color: 'var(--muted)' }}>Ht</th>
                  <SortHeader col="overall" label="OVR" />
                  <SortHeader col="outsideShooting" label="3PT" />
                  <SortHeader col="midrangeShooting" label="MID" />
                  <SortHeader col="interiorScoring" label="INT" />
                  <SortHeader col="passing" label="PAS" />
                  <SortHeader col="perimeterDefense" label="P.DEF" />
                  <SortHeader col="interiorDefense" label="I.DEF" />
                  <SortHeader col="athleticism" label="ATH" />
                  <SortHeader col="rebounding" label="REB" />
                  <SortHeader col="ppg" label="PPG" />
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => {
                  const ovr = getOverall(p.ratings);
                  const isStarter = selectedTeam?.rotation.starters.includes(p.id);
                  const currentStats = p.careerStats[0]?.stats;
                  return (
                    <tr
                      key={p.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--card-border)' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--table-row-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td className="px-2 py-2">
                        <Link href={`/player/${p.id}`} style={{ color: 'var(--accent)' }} className="hover:underline">
                          {isStarter && <span className="text-xs mr-1" title="Starter">*</span>}
                          {p.firstName} {p.lastName}
                        </Link>
                      </td>
                      <td className="px-2 py-2" style={{ color: 'var(--muted)' }}>{p.position}</td>
                      <td className="px-2 py-2">{p.age}</td>
                      <td className="px-2 py-2" style={{ color: 'var(--muted)' }}>{formatHeight(p.height)}</td>
                      <td className="px-2 py-2 font-bold" style={{ color: getRatingColor(ovr) }}>{ovr}</td>
                      <RatingCell value={p.ratings.outsideShooting} />
                      <RatingCell value={p.ratings.midrangeShooting} />
                      <RatingCell value={p.ratings.interiorScoring} />
                      <RatingCell value={p.ratings.passing} />
                      <RatingCell value={p.ratings.perimeterDefense} />
                      <RatingCell value={p.ratings.interiorDefense} />
                      <RatingCell value={p.ratings.athleticism} />
                      <RatingCell value={p.ratings.rebounding} />
                      <td className="px-2 py-2">{currentStats?.points?.toFixed(1) ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RatingCell({ value }: { value: number }) {
  return (
    <td className="px-2 py-2 font-mono text-xs" style={{ color: getRatingColor(value) }}>
      {value}
    </td>
  );
}

export default function RosterPage() {
  return (
    <Suspense fallback={<div style={{ color: 'var(--muted)' }}>Loading...</div>}>
      <RosterContent />
    </Suspense>
  );
}
