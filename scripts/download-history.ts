/**
 * Downloads historical NBA datasets to data/history/ for offline engine
 * calibration. All sources are openly licensed and statically hosted, so this
 * runs without any API key and only needs to be run once.
 *
 * Source: FiveThirtyeight open-data repo (CC BY 4.0)
 *   https://github.com/fivethirtyeight/data
 *
 * Usage:  npm run download-history          (skips files already present)
 *         npm run download-history -- --force   (re-download everything)
 */
import { writeFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const HISTORY_DIR = path.join(process.cwd(), 'data', 'history');

interface Source {
  file: string;
  url: string;
  description: string;
}

const SOURCES: Source[] = [
  {
    file: 'nbaallelo.csv',
    url: 'https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/nbaallelo.csv',
    description: 'Every NBA/ABA game 1946-2015 (scores, dates, home/away, Elo)',
  },
  {
    file: 'historical_RAPTOR_by_player.csv',
    url: 'https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-raptor/historical_RAPTOR_by_player.csv',
    description: 'Player-season RAPTOR ratings 1977-2022',
  },
  {
    file: 'modern_RAPTOR_by_player.csv',
    url: 'https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-raptor/modern_RAPTOR_by_player.csv',
    description: 'Player-season RAPTOR ratings 2014-2022 (with tracking data)',
  },
];

function humanSize(bytes: number): string {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes > 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

async function main() {
  const force = process.argv.includes('--force');

  if (!existsSync(HISTORY_DIR)) {
    await mkdir(HISTORY_DIR, { recursive: true });
  }

  console.log(`Downloading ${SOURCES.length} historical datasets to data/history/\n`);

  for (const src of SOURCES) {
    const dest = path.join(HISTORY_DIR, src.file);

    if (existsSync(dest) && !force) {
      const s = await stat(dest);
      console.log(`  ✓ ${src.file} already present (${humanSize(s.size)}) — skipping`);
      continue;
    }

    process.stdout.write(`  ↓ ${src.file} … `);
    const res = await fetch(src.url);
    if (!res.ok) {
      console.log(`FAILED (HTTP ${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`${humanSize(buf.length)}  — ${src.description}`);
  }

  console.log('\nDone. Run `npm run calibrate` to analyze.');
}

main().catch((err) => {
  console.error('Download failed:', err);
  process.exit(1);
});
