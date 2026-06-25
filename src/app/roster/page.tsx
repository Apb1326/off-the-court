'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { ratingCell } from '@/lib/ui';

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

function RosterContent() {
  const searchParams = useSearchParams();
  const teamIdParam = searchParams.get('team');

  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(teamIdParam ?? '');
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersTeamId, setPlayersTeamId] = useState<string | null>(null);
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
        setTeamsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!selectedTeamId) return;
    fetch(`/api/players?teamId=${selectedTeamId}`)
      .then((r) => r.json())
      .then((data: Player[]) => {
        setPlayers(data);
        setPlayersTeamId(selectedTeamId);
      });
  }, [selectedTeamId]);

  // Loading until teams are fetched and the players for the selected team have arrived.
  const loading = !teamsLoaded || playersTeamId !== selectedTeamId;

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

  const sortProps = { sortBy, sortAsc, onSort: handleSort };

  return (
    <div>
      <h1 className="text-xl font-bold mb-3 tracking-tight">Roster</h1>

      <div className="ootp-panel">
        {/* Toolbar */}
        <div className="ootp-toolbar">
          <label className="flex items-center gap-2">
            <span className="uppercase tracking-wider text-[11px]" style={{ color: 'var(--muted)' }}>Team</span>
            <select
              className="ootp-select"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.city} {t.name}</option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-1.5">
            <span className="uppercase tracking-wider text-[11px]" style={{ color: 'var(--muted)' }}>View</span>
            <span style={{ color: 'var(--foreground)' }}>Batting Ratings — All Positions</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="uppercase tracking-wider text-[11px]" style={{ color: 'var(--muted)' }}>Scouting</span>
            <span style={{ color: 'var(--accent)' }}>★★★★★</span>
          </span>
          <span className="ml-auto uppercase tracking-wider text-[11px]" style={{ color: 'var(--muted)' }}>
            {players.length} Players · Active Roster
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center" style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="ootp-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>#</th>
                  <SortHeader col="name" label="Name" {...sortProps} />
                  <th style={{ textAlign: 'left' }}>Pos</th>
                  <SortHeader col="age" label="Age" align="right" {...sortProps} />
                  <th style={{ textAlign: 'left' }}>Ht</th>
                  <SortHeader col="overall" label="OVR" align="center" {...sortProps} />
                  <SortHeader col="outsideShooting" label="3PT" align="center" {...sortProps} />
                  <SortHeader col="midrangeShooting" label="MID" align="center" {...sortProps} />
                  <SortHeader col="interiorScoring" label="INT" align="center" {...sortProps} />
                  <SortHeader col="passing" label="PAS" align="center" {...sortProps} />
                  <SortHeader col="perimeterDefense" label="P.DEF" align="center" {...sortProps} />
                  <SortHeader col="interiorDefense" label="I.DEF" align="center" {...sortProps} />
                  <SortHeader col="athleticism" label="ATH" align="center" {...sortProps} />
                  <SortHeader col="rebounding" label="REB" align="center" {...sortProps} />
                  <SortHeader col="ppg" label="PPG" align="right" {...sortProps} />
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => {
                  const ovr = getOverall(p.ratings);
                  const isStarter = selectedTeam?.rotation.starters.includes(p.id);
                  const currentStats = p.careerStats[0]?.stats;
                  return (
                    <tr key={p.id}>
                      <td style={{ color: 'var(--muted-dim)', textAlign: 'left' }} className="num">{p.jerseyNumber}</td>
                      <td>
                        <Link href={`/player/${p.id}`} style={{ color: 'var(--accent)' }} className="hover:underline">
                          {isStarter && <span className="mr-1" style={{ color: 'var(--success)' }} title="Starter">●</span>}
                          {p.firstName} {p.lastName}
                        </Link>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{p.position}</td>
                      <td className="num">{p.age}</td>
                      <td style={{ color: 'var(--muted)' }}>{formatHeight(p.height)}</td>
                      <td style={ratingCell(ovr)}>{ovr}</td>
                      <RatingCell value={p.ratings.outsideShooting} />
                      <RatingCell value={p.ratings.midrangeShooting} />
                      <RatingCell value={p.ratings.interiorScoring} />
                      <RatingCell value={p.ratings.passing} />
                      <RatingCell value={p.ratings.perimeterDefense} />
                      <RatingCell value={p.ratings.interiorDefense} />
                      <RatingCell value={p.ratings.athleticism} />
                      <RatingCell value={p.ratings.rebounding} />
                      <td className="num" style={{ fontWeight: 600 }}>{currentStats?.points?.toFixed(1) ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RatingCell({ value }: { value: number }) {
  return <td style={ratingCell(value)}>{value}</td>;
}

function SortHeader({
  col,
  label,
  align = 'left',
  sortBy,
  sortAsc,
  onSort,
}: {
  col: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  sortBy: string;
  sortAsc: boolean;
  onSort: (col: string) => void;
}) {
  return (
    <th
      className="cursor-pointer"
      style={{ color: sortBy === col ? 'var(--accent)' : undefined, textAlign: align }}
      onClick={() => onSort(col)}
    >
      {label}{sortBy === col ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

export default function RosterPage() {
  return (
    <Suspense fallback={<div style={{ color: 'var(--muted)' }}>Loading...</div>}>
      <RosterContent />
    </Suspense>
  );
}
