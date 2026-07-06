'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { SaveMetadata, GamePhase } from '@/models/save';
import { SEED_MIN, SEED_MAX } from '@/lib/seed';

/** The slice of the season GET payload the menu needs to decide on "Continue". */
interface ActiveState {
  currentDate: string;
  gamesPlayed: number;
  totalGames: number;
  seasonOver: boolean;
}

interface MenuData {
  active: ActiveState | null;
  saves: SaveMetadata[];
}

const PHASE_LABEL: Record<GamePhase, string> = {
  preseason: 'Preseason',
  regular_season: 'Regular Season',
  offseason: 'Offseason',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: '3px',
  color: 'var(--foreground)',
  padding: '6px 10px',
  fontSize: '13px',
};

/** Force any typed value into the API's supported seed range. */
function clampSeed(value: number): number {
  if (!Number.isFinite(value)) return SEED_MIN;
  return Math.min(SEED_MAX, Math.max(SEED_MIN, Math.floor(value)));
}

function randomSeed(): number {
  // UI-only randomness (seed picker). Simulation RNG is seeded server-side.
  // Must stay within the API's supported seed range (min 1, so no +0).
  return Math.floor(Math.random() * 1_000_000) + 1;
}

function fmtInGameDate(d: string): string {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function fetchMenuData(): Promise<MenuData> {
  const seasonRes = await fetch('/api/season').then((r) => r.json()).catch(() => ({ state: null }));
  const savesRes = await fetch('/api/saves').then((r) => r.json()).catch(() => ({ saves: [] }));

  return {
    active: seasonRes?.state ?? null,
    saves: Array.isArray(savesRes?.saves) ? savesRes.saves : [],
  };
}

export default function MenuPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState<ActiveState | null>(null);
  const [saves, setSaves] = useState<SaveMetadata[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSeed, setNewSeed] = useState(randomSeed);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Sequence season → saves: the season GET imports any legacy save into the
  // autosave slot before we list, so a migrated game shows up immediately.
  const refresh = useCallback(async () => {
    const data = await fetchMenuData();
    setActive(data.active);
    setSaves(data.saves);
  }, []);

  useEffect(() => {
    let ignore = false;

    fetchMenuData()
      .then((data) => {
        if (ignore) return;
        setActive(data.active);
        setSaves(data.saves);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const post = async (body: object): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
    const res = await fetch('/api/saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const startNewGame = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'new', seed: newSeed }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { error?: string }).error ?? 'Failed to start a new game.');
      setBusy(false);
      return;
    }
    // Best-effort: snapshot the fresh game into a named checkpoint. The autosave
    // is the live game either way, so we enter regardless.
    const name = newName.trim();
    if (name) await post({ op: 'create', name });
    router.push('/schedule');
  };

  const loadSave = async (saveId: string) => {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ op: 'load', saveId });
    if (!ok) {
      setError((data as { error?: string }).error ?? 'Failed to load save.');
      setBusy(false);
      return;
    }
    router.push('/schedule');
  };

  const deleteSave = async (saveId: string) => {
    if (!confirm('Delete this save? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    await post({ op: 'delete', saveId });
    await refresh();
    setBusy(false);
  };

  const commitRename = async () => {
    const name = renameValue.trim();
    const id = renamingId;
    setRenamingId(null);
    if (!id || !name) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ op: 'rename', saveId: id, name });
    if (!ok) setError((data as { error?: string }).error ?? 'Failed to rename save.');
    await refresh();
    setBusy(false);
  };

  const continueGame = () => router.push('/schedule');

  const autosave = saves.find((s) => s.isAutosave);
  const manualSaves = saves.filter((s) => !s.isAutosave);
  const hasActive = active !== null || autosave !== undefined;

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        {/* Branding */}
        <div className="flex flex-col items-center text-center mb-8 mt-4">
          <div className="flex items-center gap-3">
            <span
              className="flex items-center justify-center w-12 h-12 rounded font-black text-xl"
              style={{ background: 'var(--accent)', color: '#1a1206' }}
            >
              OTC
            </span>
            <span className="text-3xl font-black tracking-wide text-white">OFF THE COURT</span>
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em] mt-2" style={{ color: 'var(--muted)' }}>
            OOTP-style basketball simulation
          </div>
        </div>

        {error && (
          <div
            className="mb-4 px-4 py-2 text-sm rounded"
            style={{ background: 'rgba(220,60,60,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="ootp-panel p-10 text-center" style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <>
            {/* Continue */}
            {hasActive && (
              <button
                onClick={continueGame}
                disabled={busy}
                className="ootp-panel w-full text-left mb-4 transition-colors"
                style={{ display: 'block', cursor: busy ? 'not-allowed' : 'pointer' }}
              >
                <div className="ootp-statusbar flex items-center gap-4 px-4 py-3">
                  <div>
                    <div className="text-lg font-bold text-white leading-tight">▶ Continue</div>
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--chrome-text)', opacity: 0.85 }}>
                      {autosave?.summary ??
                        (active
                          ? `${fmtInGameDate(active.currentDate)} · ${active.gamesPlayed}/${active.totalGames} games`
                          : 'Resume your game')}
                    </div>
                  </div>
                  <span className="ml-auto text-2xl" style={{ color: 'var(--accent)' }}>→</span>
                </div>
              </button>
            )}

            {/* New Game */}
            <div className="ootp-panel mb-4">
              {!showNew ? (
                <button
                  onClick={() => {
                    setNewSeed(randomSeed());
                    setNewName('');
                    setShowNew(true);
                    setError(null);
                  }}
                  disabled={busy}
                  className="w-full px-4 py-3 text-left flex items-center gap-3"
                  style={{ cursor: busy ? 'not-allowed' : 'pointer' }}
                >
                  <span className="text-lg font-bold" style={{ color: 'var(--accent)' }}>＋ New Game</span>
                  <span className="text-[12px]" style={{ color: 'var(--muted)' }}>Start a fresh 82-game season</span>
                </button>
              ) : (
                <div>
                  <div className="ootp-panel-header">New Game</div>
                  <div className="p-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Save name (optional)</span>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="e.g. My Dynasty"
                        style={inputStyle}
                        autoFocus
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Seed</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={newSeed}
                          onChange={(e) => setNewSeed(clampSeed(Number(e.target.value)))}
                          style={{ ...inputStyle, width: '160px' }}
                        />
                        <button type="button" onClick={() => setNewSeed(randomSeed())} className="ootp-btn" title="Random seed">🎲 Reroll</button>
                      </div>
                    </label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={startNewGame} disabled={busy} className="ootp-btn ootp-btn-primary">
                        {busy ? 'Setting up…' : '▶ Start Game'}
                      </button>
                      <button onClick={() => setShowNew(false)} disabled={busy} className="ootp-btn">Cancel</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Saved games */}
            <div className="ootp-panel">
              <div className="ootp-panel-header">Saved Games</div>
              {manualSaves.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
                  No saved games yet. Start a new game to create one.
                </div>
              ) : (
                <div>
                  {manualSaves.map((s) => (
                    <div
                      key={s.saveId}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{ borderBottom: '1px solid rgba(40,50,66,0.4)' }}
                    >
                      <div className="flex-1 min-w-0">
                        {renamingId === s.saveId ? (
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onBlur={commitRename}
                            style={{ ...inputStyle, width: '100%' }}
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="font-bold truncate" style={{ color: 'var(--foreground)' }}>{s.name}</span>
                              <span
                                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--table-header)', color: 'var(--muted)' }}
                              >
                                {PHASE_LABEL[s.phase]}
                              </span>
                            </div>
                            <div className="text-[12px] truncate" style={{ color: 'var(--muted)' }}>{s.summary}</div>
                            <div className="text-[10.5px]" style={{ color: 'var(--muted-dim)' }}>
                              {fmtInGameDate(s.inGameDate)} · updated {relTime(s.updatedAt)}
                            </div>
                          </>
                        )}
                      </div>
                      {renamingId !== s.saveId && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => loadSave(s.saveId)} disabled={busy} className="ootp-btn ootp-btn-primary">Load</button>
                          <button
                            onClick={() => { setRenamingId(s.saveId); setRenameValue(s.name); }}
                            disabled={busy}
                            className="ootp-btn"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => deleteSave(s.saveId)}
                            disabled={busy}
                            className="ootp-btn"
                            style={{ color: 'var(--danger)' }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
