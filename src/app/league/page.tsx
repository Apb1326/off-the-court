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

export default function LeaguePage() {
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
          No team data found. Build the NBA-derived production league first:
        </p>
        <pre className="inline-block px-4 py-2 rounded text-sm" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          npm run build-league
        </pre>
        <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>The builder requires the local normalized NBA-data artifacts.</p>
      </div>
    );
  }

  const eastTeams = teams.filter((t) => t.conference === 'East');
  const westTeams = teams.filter((t) => t.conference === 'West');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold tracking-tight">League Office</h1>
        <Link href="/schedule" className="ootp-btn">Sim Full Season →</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConferencePanel title="Eastern Conference" teams={eastTeams} />
        <ConferencePanel title="Western Conference" teams={westTeams} />
      </div>
    </div>
  );
}

function ConferencePanel({ title, teams }: { title: string; teams: Team[] }) {
  const divisions = [...new Set(teams.map((t) => t.division))].sort();

  return (
    <div className="ootp-panel">
      <div className="ootp-panel-header">{title}</div>
      <div className="p-2">
        {divisions.map((div) => (
          <div key={div} className="mb-2 last:mb-0">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider px-2 py-1" style={{ color: 'var(--muted)', background: 'var(--table-header)' }}>
              {div}
            </h3>
            <div>
              {teams
                .filter((t) => t.division === div)
                .map((team) => (
                  <Link
                    key={team.id}
                    href={`/roster?team=${team.id}`}
                    className="flex items-center justify-between px-2 py-1.5 text-[13px] transition-colors"
                    style={{ borderBottom: '1px solid rgba(40,50,66,0.4)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--table-row-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>
                      <span className="font-bold inline-block w-9" style={{ color: 'var(--accent)' }}>{team.abbreviation}</span>
                      <span>{team.city} {team.name}</span>
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{team.roster.length} players</span>
                  </Link>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
