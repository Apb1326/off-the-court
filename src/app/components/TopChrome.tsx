'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/league', label: 'Home', match: (p) => p.startsWith('/league') },
  { href: '/roster', label: 'Roster', match: (p) => p.startsWith('/roster') || p.startsWith('/player') },
  { href: '/game/sim', label: 'Game', match: (p) => p.startsWith('/game') },
  { href: '/schedule', label: 'Season', match: (p) => p.startsWith('/schedule') },
];

export default function TopChrome() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50">
      {/* Status bar */}
      <div className="ootp-statusbar">
        <div className="max-w-[1700px] mx-auto px-4 h-12 flex items-center gap-4">
          <Link href="/league" className="flex items-center gap-2.5 group">
            <span
              className="flex items-center justify-center w-7 h-7 rounded-sm font-black text-sm"
              style={{ background: 'var(--accent)', color: '#1a1206' }}
            >
              OTC
            </span>
            <span className="font-bold tracking-wide text-[15px] text-white">
              OFF THE COURT
            </span>
          </Link>

          <span className="hidden sm:block h-5 w-px" style={{ background: 'rgba(255,255,255,0.15)' }} />

          <Link
            href="/menu"
            className="text-[11px] uppercase tracking-wider transition-opacity hover:opacity-100"
            style={{ color: 'var(--chrome-text)', opacity: 0.8 }}
          >
            ← Main Menu
          </Link>

          <span className="hidden sm:block h-5 w-px" style={{ background: 'rgba(255,255,255,0.15)' }} />

          <div className="hidden sm:flex items-center gap-4 text-[11px] uppercase tracking-wider" style={{ color: 'var(--chrome-text)' }}>
            <span style={{ opacity: 0.65 }}>NBA</span>
            <span>2024-25 Season</span>
            <span style={{ opacity: 0.65 }}>Franchise Season</span>
          </div>

          <div className="ml-auto">
            <Link href="/game/sim" className="ootp-btn ootp-btn-primary">
              ▶ Simulate
            </Link>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <nav className="ootp-tabbar">
        <div className="max-w-[1700px] mx-auto px-2 flex items-stretch">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`ootp-tab ${tab.match(pathname) ? 'active' : ''}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
