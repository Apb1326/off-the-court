import { NextRequest, NextResponse } from 'next/server';
import { getSaveStore } from '@/data/saves';

/** List all saves (metadata only) plus any folders that couldn't be read. */
export async function GET() {
  const saves = getSaveStore();
  const { saves: list, errors } = await saves.listSaves();
  return NextResponse.json({ saves: list, errors });
}

/**
 * Save operations:
 *   { op: 'create',    name }            — snapshot the live state into a new named slot
 *   { op: 'overwrite', saveId }          — overwrite an existing slot with the live state
 *   { op: 'load',      saveId }          — make a slot live (copies it into auto-save)
 *   { op: 'delete',    saveId }
 *   { op: 'rename',    saveId, name }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const op: string = body?.op ?? '';
  const saves = getSaveStore();

  switch (op) {
    case 'create': {
      const name: string = (body?.name ?? '').trim();
      if (!name) return NextResponse.json({ error: 'create requires a non-empty name' }, { status: 400 });
      const live = await saves.loadActiveSave();
      if (!live) return NextResponse.json({ error: 'No active game to save' }, { status: 400 });
      const meta = await saves.createSave(name, live);
      return NextResponse.json({ save: meta });
    }

    case 'overwrite': {
      const saveId: string = body?.saveId ?? '';
      if (!saveId) return NextResponse.json({ error: 'overwrite requires a saveId' }, { status: 400 });
      const live = await saves.loadActiveSave();
      if (!live) return NextResponse.json({ error: 'No active game to save' }, { status: 400 });
      const res = await saves.overwriteSave(saveId, live);
      if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 });
      return NextResponse.json({ save: res });
    }

    case 'load': {
      const saveId: string = body?.saveId ?? '';
      if (!saveId) return NextResponse.json({ error: 'load requires a saveId' }, { status: 400 });
      const res = await saves.copyToAutosave(saveId);
      if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    case 'delete': {
      const saveId: string = body?.saveId ?? '';
      if (!saveId) return NextResponse.json({ error: 'delete requires a saveId' }, { status: 400 });
      await saves.deleteSave(saveId);
      return NextResponse.json({ ok: true });
    }

    case 'rename': {
      const saveId: string = body?.saveId ?? '';
      const name: string = (body?.name ?? '').trim();
      if (!saveId || !name) {
        return NextResponse.json({ error: 'rename requires a saveId and a non-empty name' }, { status: 400 });
      }
      const res = await saves.renameSave(saveId, name);
      if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 });
      return NextResponse.json({ save: res });
    }

    default:
      return NextResponse.json({ error: `Unknown op "${op}"` }, { status: 400 });
  }
}
