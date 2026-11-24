// Offline writing end to end against real SQLite and a fake server that follows
// the database's rules: plan locally, queue, send, resolve conflicts, undo rejections.
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { dismissFailed, failedChanges, flush, pendingCount } from '../outbox';
import { localQueries } from '../queries';
import { migrate } from '../schema';
import type { SqlDb } from '../sql';
import { pull } from '../sync';
import { ACCOUNT, builder, type FakeLab, fakeRemote, standardLab, STRAIN } from '../testing/fakeLab';
import { fakeServer } from '../testing/fakeServer';
import { openTestDb } from '../testing/sqljsDb';
import { localWriter, type LocalWriter } from '../writer';

let db: SqlDb & { close(): void };
let lab: FakeLab;
let server: ReturnType<typeof fakeServer>;
let writer: LocalWriter;
let n = 0;

const sync = async () => {
  const sent = await flush(db, server.remote);
  if (server.state.online) await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
  return sent;
};
const codes = async (ids: string[]) => (await writer.readItems(ids)).map((i) => i.code);
const children = async (code: string) =>
  (await localQueries(db).itemLineage(`id-${code}`, 'down')).filter((r) => r.depth === 1).map((r) => r.code);

beforeEach(async () => {
  db = await openTestDb();
  await migrate(db);
  lab = standardLab();
  server = fakeServer(lab);
  await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
  n = 0;
  writer = localWriter({
    db,
    newId: () => `new-${(n += 1)}`,
    now: () => `2026-11-23T12:00:${String(n).padStart(2, '0')}.000Z`,
    initials: 'KL',
  });
});
afterEach(() => db.close());

describe('planning on the phone', () => {
  it('numbers transfers after the existing children', async () => {
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 2, medium: 'agar', madeOn: '2026-11-23' });
    expect(await codes(ids)).toEqual(['S-2D', 'S-2E']);
  });

  it('numbers backups and origins like the database does', async () => {
    const { ids } = await writer.createBackups({ parentId: 'id-S-2A1', count: 1, medium: 'slant', madeOn: '2026-11-23' });
    expect(await codes(ids)).toEqual(['S-2A1(3)']);
    const s = await writer.createOrigin({ accountId: ACCOUNT, strainId: STRAIN, prefix: 's', medium: 'spore_print', madeOn: '2026-11-23' });
    const w = await writer.createOrigin({ accountId: ACCOUNT, strainId: STRAIN, prefix: 'W', medium: 'tissue', madeOn: '2026-11-23' });
    expect(await codes([...s.ids, ...w.ids])).toEqual(['S3', 'W']);
  });

  it('refuses codes over 20 characters before queueing anything', async () => {
    const b = builder(lab);
    let parent = 'S-1';
    for (let i = 0; i < 17; i += 1) parent = b.transfer(parent).code as string; // 20 characters
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
    await expect(
      writer.createTransfers({ parentId: `id-${parent}`, count: 1, medium: 'agar', madeOn: '2026-11-23' }),
    ).rejects.toThrow('the limit is 20');
    expect(await pendingCount(db)).toBe(0);
  });

  it('refuses a duplicate strain name the way the server does', async () => {
    await expect(writer.createStrain(ACCOUNT, ' blue oyster ', '')).rejects.toThrow('strains_name_uq');
  });
});

describe('working offline', () => {
  it('shows changes on the phone at once and queues them', async () => {
    server.state.online = false;
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 2, medium: 'agar', madeOn: '2026-11-23' });
    await writer.setItemStatus(ids[0], 'contaminated', undefined, 'trich');

    expect(await children('S-2')).toEqual(['S-2A', 'S-2B', 'S-2C', 'S-2D', 'S-2E']);
    expect((await localQueries(db).getItem(ids[0])).status).toBe('contaminated');
    expect((await localQueries(db).itemEvents('id-S-2'))[0].note).toBe('2 × agar: S-2D … S-2E');
    expect(await pendingCount(db)).toBe(2);

    const result = await flush(db, server.remote);
    expect(result).toEqual({ sent: 0, failed: 0, offline: true });
    expect(await pendingCount(db)).toBe(2); // nothing lost
  });

  it('sends everything in order once back online', async () => {
    server.state.online = false;
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    const child = await writer.createTransfers({ parentId: ids[0], count: 1, medium: 'lc', madeOn: '2026-11-23' });
    await writer.addNote(ACCOUNT, ids[0], 'fast');
    server.state.online = true;

    expect(await sync()).toEqual({ sent: 3, failed: 0, offline: false });
    expect(lab.items.find((i) => i.id === ids[0])?.code).toBe('S-2D');
    expect(lab.items.find((i) => i.id === child.ids[0])?.code).toBe('S-2D1');
    expect(lab.events.some((e) => e.note === 'fast')).toBe(true);
    expect(await pendingCount(db)).toBe(0);
    expect((await db.first<{ n: number }>('select count(*) as n from items where local_pending = 1'))!.n).toBe(0);
  });

  it('never duplicates a change that was half sent', async () => {
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    // The items arrive, then the connection drops before the event is sent.
    const applyEvent = server.remote.applyEvent;
    server.remote.applyEvent = async () => {
      throw new TypeError('Network request failed');
    };
    expect((await flush(db, server.remote)).offline).toBe(true);
    server.remote.applyEvent = applyEvent;

    await sync();
    expect(lab.items.filter((i) => i.id === ids[0])).toHaveLength(1);
    expect(lab.events.filter((e) => e.type === 'transferred')).toHaveLength(1);
  });
});

describe('code conflicts', () => {
  it('first to sync keeps the code; this phone is renumbered and asked to relabel', async () => {
    server.state.online = false;
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    const child = await writer.createTransfers({ parentId: ids[0], count: 1, medium: 'agar', madeOn: '2026-11-23' });
    expect(await codes([ids[0], child.ids[0]])).toEqual(['S-2D', 'S-2D1']);

    // Meanwhile another device made S-2D.
    const s2c = lab.items.find((i) => i.code === 'S-2C')!;
    lab.items.push({ ...s2c, id: 'other-device', code: 'S-2D', position: 4, updated_at: '2026-11-23T11:00:00.000Z' });
    server.state.online = true;
    await sync();

    expect(await codes([ids[0], child.ids[0]])).toEqual(['S-2E', 'S-2E1']);
    const relabels = await localQueries(db).openRelabels();
    expect(relabels.map((r) => `${r.old_code} → ${r.new_code}`)).toEqual(['S-2D → S-2E', 'S-2D1 → S-2E1']);

    await writer.resolveRelabel(relabels[0].id);
    expect((await localQueries(db).openRelabels()).map((r) => r.old_code)).toEqual(['S-2D1']);
    await sync();
    expect(lab.relabels.find((r) => r.old_code === 'S-2D')?.resolved_at).not.toBeNull();
  });
});

describe('rejected changes', () => {
  it('are undone on the phone, with anything built on them, and listed with the reason', async () => {
    server.state.online = false;
    const { ids } = await writer.createTransfers({ parentId: 'id-S-1', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    await writer.setItemStatus(ids[0], 'contaminated');
    await writer.setItemStatus('id-S-3', 'used');

    // S-1 was removed on the server in the meantime.
    lab.items.splice(lab.items.findIndex((i) => i.code === 'S-1'), 1);
    server.state.online = true;
    const result = await flush(db, server.remote);

    expect(result).toEqual({ sent: 1, failed: 2, offline: false });
    expect(await writer.readItems(ids)).toEqual([]);
    expect((await localQueries(db).getItem('id-S-3')).status).toBe('used'); // unrelated change still went through
    const failed = await failedChanges(db);
    expect(failed.map((f) => [f.summary, f.error])).toEqual([
      ['1 transfer from S-1: S-1A', 'Parent item not found'],
      ['S-1A marked contaminated', "Depends on a change that couldn't be saved (1 transfer from S-1: S-1A)"],
    ]);

    await dismissFailed(db, failed[0].seq);
    expect(await failedChanges(db)).toHaveLength(1);
  });

  it('restore the previous status when a status change is refused', async () => {
    server.state.online = false;
    await writer.setItemStatus('id-S-3', 'contaminated');
    Object.assign(lab.items.find((i) => i.code === 'S-3')!, { deleted_at: '2026-11-23T00:00:00Z' });
    server.state.online = true;
    await flush(db, server.remote);
    expect((await localQueries(db).getItem('id-S-3')).status).toBe('active');
    expect((await localQueries(db).itemEvents('id-S-3')).some((e) => e.type === 'contaminated')).toBe(false);
  });
});

describe('pulls', () => {
  it('never overwrite a change still waiting to be sent', async () => {
    server.state.online = false;
    await writer.setItemStatus('id-S-3', 'contaminated');
    // Something else changes S-3 on the server and comes down in a pull.
    Object.assign(lab.items.find((i) => i.code === 'S-3')!, { location: 'Shelf 2', updated_at: '2026-11-30T00:00:00.000Z' });
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
    expect((await localQueries(db).getItem('id-S-3')).status).toBe('contaminated');
  });
});

describe('editing and removing notes', () => {
  const notes = async (itemId: string) =>
    (await localQueries(db).itemEvents(itemId)).filter((e) => e.type === 'note').map((e) => e.note);
  const serverNote = (id: string) => lab.events.find((e) => e.id === id);

  it('edits and removes a synced note, offline first, then on the server', async () => {
    await writer.addNote(ACCOUNT, 'id-S-2', 'Slow growth');
    await sync();
    const id = 'new-1';
    expect(serverNote(id)?.note).toBe('Slow growth');

    server.state.online = false;
    await writer.changeNote(id, '  Fast, rhizomorphic ');
    expect(await notes('id-S-2')).toEqual(['Fast, rhizomorphic']);
    await sync();
    expect(serverNote(id)?.note).toBe('Slow growth'); // still offline

    server.state.online = true;
    await sync();
    expect(serverNote(id)?.note).toBe('Fast, rhizomorphic');

    await writer.changeNote(id, null);
    expect(await notes('id-S-2')).toEqual([]);
    await sync();
    expect(serverNote(id)?.deleted_at).toBeTruthy();
    expect(await notes('id-S-2')).toEqual([]);
    expect(await pendingCount(db)).toBe(0);
  });

  it('changes a note still waiting to be sent instead of queueing an edit', async () => {
    server.state.online = false;
    await writer.addNote(ACCOUNT, 'id-S-2', 'Slow');
    await writer.changeNote('new-1', 'Slow, then fast');
    expect(await pendingCount(db)).toBe(1);

    server.state.online = true;
    await sync();
    expect(serverNote('new-1')?.note).toBe('Slow, then fast');
  });

  it('drops an unsent note that is removed, so the server never sees it', async () => {
    server.state.online = false;
    await writer.addNote(ACCOUNT, 'id-S-2', 'Oops, wrong plate');
    await writer.changeNote('new-1', null);
    expect(await pendingCount(db)).toBe(0);
    expect(await notes('id-S-2')).toEqual([]);

    server.state.online = true;
    await sync();
    expect(serverNote('new-1')).toBeUndefined();
  });

  it('refuses to change history other than notes, and empty notes', async () => {
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    const transferEvent = (await localQueries(db).itemEvents('id-S-2')).find((e) => e.type === 'transferred')!;
    await expect(writer.changeNote(transferEvent.id, 'changed')).rejects.toThrow('Only notes can be edited or removed');

    await writer.addNote(ACCOUNT, ids[0], 'Looks clean');
    const note = (await localQueries(db).itemEvents(ids[0])).find((e) => e.type === 'note')!;
    await expect(writer.changeNote(note.id, '   ')).rejects.toThrow("A note can't be empty");
  });

  it('puts the note back when the server refuses the edit', async () => {
    await writer.addNote(ACCOUNT, 'id-S-2', 'Slow growth');
    await sync();

    server.state.online = false;
    await writer.changeNote('new-1', 'Edited on this phone');
    // Meanwhile the note was removed on another device.
    Object.assign(serverNote('new-1')!, { deleted_at: '2026-11-23T13:00:00.000Z', updated_at: '2026-11-30T00:00:00.000Z' });
    server.state.online = true;
    await flush(db, server.remote);

    expect(await notes('id-S-2')).toEqual(['Slow growth']);
    expect((await failedChanges(db)).map((f) => [f.summary, f.error])).toEqual([
      ['Edited note on S-2', 'This note was removed'],
    ]);
    // The next pull brings the removal down.
    await sync();
    expect(await notes('id-S-2')).toEqual([]);
  });
});
