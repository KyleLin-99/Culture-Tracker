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
import { localWriter, type LocalWriter, VIEWER_REFUSAL } from '../writer';

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

describe('colonization checks', () => {
  const checks = async (itemId: string) =>
    (await localQueries(db).itemChecks([itemId])).map((c) => [c.checked_on, c.percent, c.radius_mm]);

  it('logs a check offline and sends it once back online', async () => {
    server.state.online = false;
    await writer.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-20', percent: 40, radiusMm: 18, note: ' fluffy ' });
    expect(await checks('id-S-2')).toEqual([['2026-11-20', 40, 18]]);
    await sync();
    expect(lab.colonization_checks).toHaveLength(0);

    server.state.online = true;
    await sync();
    expect(lab.colonization_checks.map((c) => [c.item_id, c.percent, c.note])).toEqual([['id-S-2', 40, 'fluffy']]);
    expect(await pendingCount(db)).toBe(0);
  });

  it('logs a check on a culture made offline, sent after the culture', async () => {
    server.state.online = false;
    const { ids } = await writer.createTransfers({ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    await writer.logCheck({ itemId: ids[0], checkedOn: '2026-11-23', percent: 5, radiusMm: null });
    server.state.online = true;
    await sync();
    expect(lab.colonization_checks.map((c) => c.item_id)).toEqual([ids[0]]);
  });

  it('removes a synced check on the server; drops an unsent one without sending it', async () => {
    await writer.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-20', percent: 40, radiusMm: null });
    await sync();
    const sent = lab.colonization_checks[0].id;
    await writer.removeCheck(sent);
    expect(await checks('id-S-2')).toEqual([]);
    await sync();
    expect(lab.colonization_checks[0].deleted_at).toBeTruthy();

    server.state.online = false;
    const unsent = await writer.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-21', percent: 50, radiusMm: null });
    await writer.removeCheck(unsent.id);
    expect(await pendingCount(db)).toBe(0);
    server.state.online = true;
    await sync();
    expect(lab.colonization_checks).toHaveLength(1);
  });

  it('refuses checks the server would refuse', async () => {
    await expect(writer.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-20', percent: null, radiusMm: null })).rejects.toThrow(
      'A check needs a percent colonized or a radius',
    );
    await expect(writer.logCheck({ itemId: 'id-S-2', checkedOn: '2000-01-01', percent: 5, radiusMm: null })).rejects.toThrow(
      "A check can't be dated before the culture was made",
    );
  });

  it('undoes a check the server refuses, with the reason', async () => {
    server.state.online = false;
    await writer.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-20', percent: 40, radiusMm: null });
    // Meanwhile the culture was deleted on the server.
    Object.assign(lab.items.find((i) => i.id === 'id-S-2')!, { deleted_at: '2026-11-21T00:00:00.000Z' });
    server.state.online = true;
    await flush(db, server.remote);
    expect(await checks('id-S-2')).toEqual([]);
    expect((await failedChanges(db)).map((f) => [f.summary, f.error])).toEqual([['Check on S-2', 'Culture not found']]);
  });

  it('fails a check along with the refused transfer it was logged on', async () => {
    server.state.online = false;
    const { ids } = await writer.createTransfers({ parentId: 'id-S-1', count: 1, medium: 'agar', madeOn: '2026-11-23' });
    await writer.logCheck({ itemId: ids[0], checkedOn: '2026-11-23', percent: 5, radiusMm: null });
    await writer.logCheck({ itemId: 'id-S-3', checkedOn: '2026-11-23', percent: 20, radiusMm: null });

    // S-1 was removed on the server in the meantime.
    lab.items.splice(lab.items.findIndex((i) => i.code === 'S-1'), 1);
    server.state.online = true;
    const result = await flush(db, server.remote);

    expect(result).toEqual({ sent: 1, failed: 2, offline: false });
    expect(await checks(ids[0])).toEqual([]);
    expect(lab.colonization_checks.map((c) => c.item_id)).toEqual(['id-S-3']); // unrelated check still went through
    expect((await failedChanges(db)).map((f) => [f.summary, f.error])).toEqual([
      ['1 transfer from S-1: S-1A', 'Parent item not found'],
      ['Check on S-1A', "Depends on a change that couldn't be saved (1 transfer from S-1: S-1A)"],
    ]);
  });

  it('pulls every check, even on cultures older than the history window', async () => {
    lab.colonization_checks.push({
      id: 'old-check', account_id: ACCOUNT, item_id: 'id-S', checked_on: '2026-11-21', percent: 30, radius_mm: null,
      note: null, source: 'manual', created_at: '2024-01-05T00:00:00Z', updated_at: '2024-01-05T00:00:00Z', deleted_at: null,
    });
    const fresh = await openTestDb();
    await migrate(fresh);
    await pull(fresh, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
    expect((await localQueries(fresh).itemChecks(['id-S'])).map((c) => c.id)).toEqual(['old-check']);
    fresh.close();
  });
});

describe('refreshing a backup', () => {
  it('makes a new backup from the active parent, offline, and the server keeps the link', async () => {
    server.state.online = false;
    const { ids } = await writer.refreshBackup({ backupId: 'id-S-2A1(1)', madeOn: '2026-11-23' });
    expect(await codes(ids)).toEqual(['S-2A1(3)']);
    expect((await localQueries(db).refreshInfo('id-S-2A1(1)')).refreshedBy).toMatchObject({ code: 'S-2A1(3)', checks: 0 });

    server.state.online = true;
    await sync();
    const row = lab.items.find((i) => i.id === ids[0])!;
    expect([row.code, row.kind, row.parent_id, row.refresh_of]).toEqual(['S-2A1(3)', 'backup', 'id-S-2A1', 'id-S-2A1(1)']);
    expect((await localQueries(db).refreshInfo(ids[0])).refreshOf).toEqual({ id: 'id-S-2A1(1)', code: 'S-2A1(1)' });
  });

  it('grows a culture from the backup when the parent is no longer active', async () => {
    lab.items.find((i) => i.code === 'S-2A1')!.status = 'used';
    await sync();
    const { ids } = await writer.refreshBackup({ backupId: 'id-S-2A1(1)', madeOn: '2026-11-23' });
    expect(await codes(ids)).toEqual(['S-2A1(1)-1']);
    await sync();
    expect(lab.items.find((i) => i.id === ids[0])).toMatchObject({ kind: 'transfer', parent_id: 'id-S-2A1(1)', refresh_of: 'id-S-2A1(1)' });
  });

  it('hides a refreshed backup from active-backup refresh checks until its refresh fails', async () => {
    const { ids } = await writer.refreshBackup({ backupId: 'id-S-2A1(1)', madeOn: '2026-11-23' });
    const refreshed = async () => (await localQueries(db).activeBackups()).find((b) => b.code === 'S-2A1(1)')!.refreshed_by;
    expect(await refreshed()).toMatchObject({ id: ids[0], status: 'active' });
    await writer.setItemStatus(ids[0], 'contaminated');
    expect(await refreshed()).toMatchObject({ status: 'contaminated' });
  });

  it('refuses to refresh something that is not a backup', async () => {
    await expect(writer.refreshBackup({ backupId: 'id-S-2', madeOn: '2026-11-23' })).rejects.toThrow('Only a backup can be refreshed');
  });

  /** Makes the server refuse the items change that creates `id`, as if it broke a rule. */
  const refuseItem = (id: string) => {
    const applyItems = server.remote.applyItems;
    server.remote.applyItems = async (planned) => {
      if (planned.some((p) => p.id === id)) throw new Error('Strain not found');
      return applyItems(planned);
    };
  };

  // A refresh from the active parent has parent_id = the backup's parent, so only
  // refresh_of ties it to the backup. If that backup was made offline and refused,
  // the refresh must fail with it, not be sent pointing at a backup that never existed.
  it('fails a refresh (from the parent) along with the refused backup it refreshes', async () => {
    server.state.online = false;
    const backup = await writer.createBackups({ parentId: 'id-S-2A1', count: 1, medium: 'slant', madeOn: '2026-11-23' });
    const refresh = await writer.refreshBackup({ backupId: backup.ids[0], madeOn: '2026-11-23' });
    expect(await codes(refresh.ids)).toEqual(['S-2A1(4)']);

    refuseItem(backup.ids[0]);
    server.state.online = true;
    const result = await flush(db, server.remote);

    expect(result).toEqual({ sent: 0, failed: 2, offline: false });
    expect(await writer.readItems([...backup.ids, ...refresh.ids])).toEqual([]);
    expect(lab.items.some((i) => i.refresh_of === backup.ids[0])).toBe(false);
    expect((await failedChanges(db)).map((f) => [f.summary, f.error])).toEqual([
      ['1 backup of S-2A1: S-2A1(3)', 'Strain not found'],
      ['Refresh of S-2A1(3): S-2A1(4)', "Depends on a change that couldn't be saved (1 backup of S-2A1: S-2A1(3))"],
    ]);
  });

  it('fails a refresh (grown from the backup) along with the refused backup it refreshes', async () => {
    server.state.online = false;
    const backup = await writer.createBackups({ parentId: 'id-S-2A1', count: 1, medium: 'slant', madeOn: '2026-11-23' });
    await writer.setItemStatus('id-S-2A1', 'used');
    const refresh = await writer.refreshBackup({ backupId: backup.ids[0], madeOn: '2026-11-23' });
    expect(await codes(refresh.ids)).toEqual(['S-2A1(3)-1']);

    refuseItem(backup.ids[0]);
    server.state.online = true;
    const result = await flush(db, server.remote);

    expect(result).toEqual({ sent: 1, failed: 2, offline: false }); // the status change still went through
    expect(await writer.readItems(refresh.ids)).toEqual([]);
    expect((await failedChanges(db)).map((f) => f.error)).toEqual([
      'Strain not found',
      "Depends on a change that couldn't be saved (1 backup of S-2A1: S-2A1(3))",
    ]);
  });
});

describe("a viewer's phone", () => {
  it('refuses every change before it is queued, and can still read', async () => {
    const viewer = localWriter({ db, newId: () => 'v-1', now: () => '2026-11-23T12:00:00.000Z', initials: 'VI', canWrite: false });
    await expect(viewer.addNote(ACCOUNT, 'id-S-2', 'hi')).rejects.toThrow(VIEWER_REFUSAL);
    await expect(viewer.createTransfers({ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' })).rejects.toThrow(VIEWER_REFUSAL);
    await expect(viewer.setItemStatus('id-S-2', 'contaminated')).rejects.toThrow(VIEWER_REFUSAL);
    await expect(viewer.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-23', percent: 5, radiusMm: null })).rejects.toThrow(VIEWER_REFUSAL);
    await expect(viewer.refreshBackup({ backupId: 'id-S-2A1(1)', madeOn: '2026-11-23' })).rejects.toThrow(VIEWER_REFUSAL);
    expect(await pendingCount(db)).toBe(0);
    expect((await viewer.readItems(['id-S-2'])).map((i) => i.code)).toEqual(['S-2']);
  });

  // Guard: every writer method except the reads below must be refused for viewers.
  // MUTATION_ARGS is typed as exhaustive, so adding a writer method breaks the
  // typecheck until it's listed here; the runtime key check catches the rest.
  const READS = ['readItems'] as const;
  type Mutation = Exclude<keyof LocalWriter, (typeof READS)[number]>;
  const MUTATION_ARGS: { [K in Mutation]: Parameters<LocalWriter[K]> } = {
    createTransfers: [{ parentId: 'id-S-2', count: 1, medium: 'agar', madeOn: '2026-11-23' }],
    createBackups: [{ parentId: 'id-S-2A1', count: 1, medium: 'slant', madeOn: '2026-11-23' }],
    refreshBackup: [{ backupId: 'id-S-2A1(1)', madeOn: '2026-11-23' }],
    createOrigin: [{ accountId: ACCOUNT, strainId: STRAIN, prefix: 'W', medium: 'tissue', madeOn: '2026-11-23' }],
    setItemStatus: ['id-S-2', 'contaminated', 'green', 'trich'],
    addNote: [ACCOUNT, 'id-S-2', 'hi'],
    changeNote: ['note-1', 'edited'],
    logCheck: [{ itemId: 'id-S-2', checkedOn: '2026-11-23', percent: 5, radiusMm: null }],
    removeCheck: ['check-1'],
    createStrain: [ACCOUNT, 'Lions Mane', 'Hericium erinaceus'],
    resolveRelabel: ['relabel-1'],
  };

  /** Every row of every local table, so a refused call can't have touched anything. */
  async function snapshot() {
    const tables = await db.all<{ name: string }>("select name from sqlite_master where type = 'table' order by name");
    const out: Record<string, unknown[]> = {};
    for (const { name } of tables) out[name] = await db.all(`select * from "${name}" order by rowid`);
    return out;
  }

  /** A note, a check and a relabel, already synced, for changeNote/removeCheck/resolveRelabel to act on. */
  async function seedTargets() {
    let id = 0;
    const setup = localWriter({ db, newId: () => ['note-1', 'check-1'][id++], now: () => '2026-11-23T11:00:00.000Z', initials: 'KL' });
    await setup.addNote(ACCOUNT, 'id-S-2', 'original');
    await setup.logCheck({ itemId: 'id-S-2', checkedOn: '2026-11-23', percent: 10, radiusMm: null });
    await db.run(
      `insert into relabels (id, account_id, entity, entity_id, old_code, new_code, updated_at)
       values ('relabel-1', ?, 'item', 'id-S-2', 'S-2', 'S-9', '2026-11-23T11:00:00.000Z')`,
      [ACCOUNT],
    );
    await db.run('delete from outbox');
    await db.run('update events set local_pending = 0');
    await db.run('update colonization_checks set local_pending = 0');
  }

  it('refuses every mutating writer method, including ones added later, without touching the local copy', async () => {
    await seedTargets();
    const before = await snapshot();
    const viewer = localWriter({ db, newId: () => 'v-1', now: () => '2026-11-23T12:00:00.000Z', initials: 'VI', canWrite: false });
    const full = localWriter({ db, newId: () => 'x', now: () => 'x', initials: 'X' });

    // The viewer's writer has exactly the same methods as a full one (none dropped),
    // and every one that isn't a read is listed in MUTATION_ARGS.
    expect(Object.keys(viewer).sort()).toEqual(Object.keys(full).sort());
    const mutations = Object.keys(viewer).filter((k) => !(READS as readonly string[]).includes(k));
    expect(mutations.sort()).toEqual(Object.keys(MUTATION_ARGS).sort());

    for (const name of mutations) {
      const fn = (viewer as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
      const args = (MUTATION_ARGS as Record<string, unknown[]>)[name];
      await expect(fn(...args)).rejects.toThrow(VIEWER_REFUSAL);
      // With no arguments too: a refusal that depends on the arguments isn't a guard.
      await expect(fn()).rejects.toThrow(VIEWER_REFUSAL);
    }

    expect(await pendingCount(db)).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('the guard arguments are real: a full writer accepts every one of them', async () => {
    // Otherwise the viewer test could pass on arguments that would fail anyway.
    await seedTargets();
    for (const [name, args] of Object.entries(MUTATION_ARGS)) {
      const fn = (writer as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
      await expect(fn(...args)).resolves.not.toThrow();
    }
    expect(await pendingCount(db)).toBe(Object.keys(MUTATION_ARGS).length);
  });

  it('owners and techs (the default) can still write', async () => {
    const tech = localWriter({ db, newId: () => 't-1', now: () => '2026-11-23T12:00:00.000Z', initials: 'TE', canWrite: true });
    await tech.addNote(ACCOUNT, 'id-S-2', 'ok');
    expect(await pendingCount(db)).toBe(1);
  });
});
