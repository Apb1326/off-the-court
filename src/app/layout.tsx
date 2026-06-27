import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ChromeShell from "./components/ChromeShell";
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
        <ChromeShell>{children}</ChromeShell>
      </body>
    </html>
  );
}
