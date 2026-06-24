import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import TopChrome from "./components/TopChrome";
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
        <TopChrome />
        <main className="flex-1 max-w-[1700px] mx-auto px-4 py-5 w-full">
          {children}
        </main>
      </body>
    </html>
  );
}
