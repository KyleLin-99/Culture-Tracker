import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { localQueries } from '../queries';
import { getMeta, migrate, SCHEMA_VERSION } from '../schema';
import type { SqlDb } from '../sql';
import { OVERLAP_MS, pull } from '../sync';
import { ACCOUNT, builder, emptyLab, fakeRemote, standardLab, STRAIN, tick } from '../testing/fakeLab';
import { openTestDb } from '../testing/sqljsDb';

const HISTORY_FROM = '2025-11-23';
let db: SqlDb & { close(): void };

beforeEach(async () => {
  db = await openTestDb();
  await migrate(db);
});
afterEach(() => db.close());

const count = async (table: string) => (await db.first<{ n: number }>(`select count(*) as n from ${table}`))!.n;

describe('first pull', () => {
  it('copies the lab to the phone', async () => {
    const lab = standardLab();
    const { remote } = fakeRemote(lab);
    const result = await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    expect(result.rows).toBe(lab.items.length + lab.strains.length);
    expect(await count('items')).toBe(lab.items.length);
    expect(await getMeta(db, 'account_id')).toBe(ACCOUNT);
    expect(await getMeta(db, 'pulled_until_items')).toBe(lab.items.at(-1)!.updated_at);
    expect(await getMeta(db, 'last_synced_at')).not.toBeNull();
  });

  it('keeps aliases readable after the round trip', async () => {
    const lab = standardLab();
    lab.items[0].aliases = ['OLD-1'];
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    const hits = await localQueries(db).lookupCode('old-1');
    expect(hits.map((h) => [h.code, h.exact])).toEqual([['S', true]]);
  });

  it('pages through large tables', async () => {
    const lab = standardLab();
    for (let i = 0; i < 1203; i += 1) {
      lab.events.push({ id: `ev-${i}`, account_id: ACCOUNT, item_id: 'id-S-2', type: 'note', occurred_at: '2026-11-20T10:00:00Z', note: `n${i}`, contam_type: null, photo_key: null, created_at: tick(), updated_at: tick(), deleted_at: null });
    }
    const { remote, calls } = fakeRemote(lab);
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect(await count('events')).toBe(1203);
    expect(calls.filter((c) => c.table === 'events').map((c) => c.offset)).toEqual([0, 500, 1000]);
  });
});

describe('history window', () => {
  function oldLab() {
    const lab = emptyLab();
    lab.strains.push({ id: STRAIN, account_id: ACCOUNT, name: 'Lion', species: null, notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
    const b = builder(lab);
    b.origin('W', null, { status: 'used', madeOn: '2023-05-01' });
    b.transfer('W', { status: 'used', madeOn: '2023-06-01' }); // W-1, old: an ancestor
    b.transfer('W', { status: 'discarded', madeOn: '2023-06-01' }); // W-2, old, nobody's ancestor
    b.transfer('W-1', { status: 'active', madeOn: '2024-01-10' }); // W-1A, active: kept
    b.transfer('W-1A', { status: 'used', madeOn: '2026-10-01' }); // W-1A1, recent: kept
    return lab;
  }

  it('skips old retired cultures but keeps active ones, recent ones and their whole ancestry', async () => {
    const { remote, calls } = fakeRemote(oldLab());
    const result = await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    const codes = (await db.all<{ code: string }>('select code from items order by code')).map((r) => r.code);
    expect(codes).toEqual(['W', 'W-1', 'W-1A', 'W-1A1']);
    expect(result.ancestors).toBe(2); // W-1 then W
    expect(calls.find((c) => c.table === 'items')?.historyFrom).toBe(HISTORY_FROM);

    const lineage = await localQueries(db).itemLineage('id-W-1A1', 'up');
    expect(lineage.map((r) => r.code)).toEqual(['W', 'W-1', 'W-1A', 'W-1A1']);
  });

  it('applies only to the first pull; later changes all come down', async () => {
    const lab = oldLab();
    const { remote, calls } = fakeRemote(lab);
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    calls.length = 0;
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect(calls.every((c) => c.historyFrom === null)).toBe(true);
  });
});

describe('later pulls', () => {
  it('ask only for recent changes, with a safety overlap, and apply them', async () => {
    const lab = standardLab();
    const { remote, calls } = fakeRemote(lab);
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    const pulledUntil = (await getMeta(db, 'pulled_until_items'))!;

    const s2b = lab.items.find((i) => i.code === 'S-2B')!;
    Object.assign(s2b, { status: 'contaminated', updated_at: tick() });
    calls.length = 0;
    const result = await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    const itemCall = calls.find((c) => c.table === 'items')!;
    expect(Date.parse(pulledUntil) - Date.parse(itemCall.since!)).toBe(OVERLAP_MS);
    expect(result.rows).toBeGreaterThanOrEqual(1);
    expect((await localQueries(db).getItem('id-S-2B')).status).toBe('contaminated');
  });

  it('hide soft-deleted rows everywhere', async () => {
    const lab = standardLab();
    const { remote } = fakeRemote(lab);
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    Object.assign(lab.items.find((i) => i.code === 'S-2C')!, { deleted_at: tick(), updated_at: tick() });
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    const q = localQueries(db);
    expect((await q.recentItems(100)).map((i) => i.code)).not.toContain('S-2C');
    expect((await q.itemLineage('id-S-2', 'down')).map((r) => r.code)).not.toContain('S-2C');
    expect((await q.strainTree(STRAIN)).map((r) => r.code)).not.toContain('S-2C');
    expect(await q.lookupCode('S-2C')).toEqual([]);
  });

  it('start fresh when a different lab signs in', async () => {
    await pull(db, fakeRemote(standardLab()).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    const other = emptyLab();
    other.strains.push({ id: 'strain-x', account_id: 'acct-2', name: 'Other', species: null, notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
    await pull(db, fakeRemote(other).remote, { accountId: 'acct-2', historyFrom: HISTORY_FROM });

    expect(await count('items')).toBe(0);
    expect((await localQueries(db).listStrains()).map((s) => s.name)).toEqual(['Other']);
  });
});

describe('schema', () => {
  it('migrates once and is safe to run again', async () => {
    await migrate(db);
    expect((await db.first<{ user_version: number }>('pragma user_version'))!.user_version).toBe(SCHEMA_VERSION);
  });
});
