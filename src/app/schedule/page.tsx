'use client';

export default function SchedulePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Schedule & Standings</h1>
      <div className="rounded-lg p-8 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <p style={{ color: 'var(--muted)' }}>
          Season mode coming soon. Use{' '}
          <a href="/game/sim" style={{ color: 'var(--accent)' }}>Quick Sim</a>
          {' '}to simulate individual games.
        </p>
      </div>
    </div>
  );
}
