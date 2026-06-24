import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Off The Court",
  description: "OOTP-style basketball management simulation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="sticky top-0 z-50 border-b" style={{ background: 'var(--header-bg)', borderColor: 'var(--card-border)' }}>
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-8">
            <Link href="/" className="text-lg font-bold" style={{ color: 'var(--accent)' }}>
              Off The Court
            </Link>
            <div className="flex gap-6 text-sm">
              <Link href="/" className="hover:opacity-80" style={{ color: 'var(--muted)' }}>Dashboard</Link>
              <Link href="/roster" className="hover:opacity-80" style={{ color: 'var(--muted)' }}>Roster</Link>
              <Link href="/game/sim" className="hover:opacity-80" style={{ color: 'var(--muted)' }}>Simulate</Link>
              <Link href="/schedule" className="hover:opacity-80" style={{ color: 'var(--muted)' }}>Schedule</Link>
            </div>
          </div>
        </nav>
        <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
          {children}
        </main>
      </body>
    </html>
  );
}
