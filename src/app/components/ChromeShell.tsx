'use client';

import { usePathname } from 'next/navigation';
import TopChrome from './TopChrome';

/**
 * Gates the in-game chrome by route. The Main Menu (`/menu`) is a full-screen
 * splash shown before you enter a game, so it renders without the TopChrome tab
 * bar and without the constrained content column. Every other route gets the
 * normal chrome.
 */
export default function ChromeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/menu') {
    return <main className="flex-1 w-full">{children}</main>;
  }

  return (
    <>
      <TopChrome />
      <main className="flex-1 max-w-[1700px] mx-auto px-4 py-5 w-full">{children}</main>
    </>
  );
}
