'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  city: string;
  fullName: string;
  abbreviation: string;
  conference: 'East' | 'West';
  division: string;
  roster: string[];
}

export default function Dashboard() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/teams')
      .then((r) => r.json())
      .then((data) => {
        setTeams(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center py-20" style={{ color: 'var(--muted)' }}>Loading teams...</div>;
  }

  if (teams.length === 0) {
    return (
      <div className="text-center py-20">
        <h1 className="text-3xl font-bold mb-4">Welcome to Off The Court</h1>
        <p className="mb-6" style={{ color: 'var(--muted)' }}>
          No team data found. Run the data ingestion script first:
        </p>
        <pre className="inline-block px-4 py-2 rounded text-sm" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          BALLDONTLIE_API_KEY=your_key npm run ingest
        </pre>
        <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>
          Get a free API key at{' '}
          <span style={{ color: 'var(--accent)' }}>https://app.balldontlie.io</span>
        </p>
      </div>
    );
  }

  const eastTeams = teams.filter((t) => t.conference === 'East');
  const westTeams = teams.filter((t) => t.conference === 'West');

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link
          href="/game/sim"
          className="px-4 py-2 rounded font-medium text-sm text-white"
          style={{ background: 'var(--accent)' }}
        >
          Quick Sim
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ConferencePanel title="Eastern Conference" teams={eastTeams} />
        <ConferencePanel title="Western Conference" teams={westTeams} />
      </div>
    </div>
  );
}

function ConferencePanel({ title, teams }: { title: string; teams: Team[] }) {
  const divisions = [...new Set(teams.map((t) => t.division))].sort();

  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {divisions.map((div) => (
        <div key={div} className="mb-4 last:mb-0">
          <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
            {div}
          </h3>
          <div className="space-y-1">
            {teams
              .filter((t) => t.division === div)
              .map((team) => (
                <Link
                  key={team.id}
                  href={`/roster?team=${team.id}`}
                  className="flex items-center justify-between px-3 py-2 rounded text-sm transition-colors"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--table-row-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span>
                    <span className="font-medium" style={{ color: 'var(--accent)' }}>{team.abbreviation}</span>
                    {' '}
                    <span>{team.city} {team.name}</span>
                  </span>
                  <span style={{ color: 'var(--muted)' }}>{team.roster.length} players</span>
                </Link>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
