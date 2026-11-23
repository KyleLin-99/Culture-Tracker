// The local queries must answer exactly like the server functions. The expected
// orders below are the same ones supabase/tests/database/01_culture_codes.test.sql
// checks against item_lineage() and strain_tree().
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { localQueries, type LocalQueries } from '../queries';
import { migrate } from '../schema';
import { pull } from '../sync';
import { ACCOUNT, fakeRemote, standardLab, STRAIN, tick } from '../testing/fakeLab';
import { openTestDb } from '../testing/sqljsDb';

let q: LocalQueries;
let close: () => void;

beforeAll(async () => {
  const db = await openTestDb();
  close = db.close;
  await migrate(db);
  const lab = standardLab();
  lab.sterilization_runs.push({ id: 'run-2', account_id: ACCOUNT, code: 'SR-002', method: 'pressure_cooker', psi: 15, minutes: 90, run_on: '2026-11-19', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
  lab.media_batches.push(
    { id: 'mb-2', account_id: ACCOUNT, code: 'MB-002', kind: 'agar', recipe: 'MEA', sterilization_run_id: 'run-2', made_on: '2026-11-19', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null },
    { id: 'mb-3', account_id: ACCOUNT, code: 'MB-003', kind: 'lc', recipe: 'Honey', sterilization_run_id: null, made_on: '2026-11-18', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null },
  );
  lab.items.find((i) => i.code === 'S-2B')!.media_batch_id = 'mb-2';
  lab.events.push(
    { id: 'e1', account_id: ACCOUNT, item_id: 'id-S-2', type: 'transferred', occurred_at: '2026-11-20T10:00:00Z', note: '2 × agar: S-2A … S-2B', contam_type: null, photo_key: null, created_at: tick(), updated_at: tick(), deleted_at: null },
    { id: 'e2', account_id: ACCOUNT, item_id: 'id-S-2', type: 'note', occurred_at: '2026-11-21T10:00:00Z', note: 'fast', contam_type: null, photo_key: null, created_at: tick(), updated_at: tick(), deleted_at: null },
  );
  await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
  q = localQueries(db);
});
afterAll(() => close());

describe('itemLineage', () => {
  it('lists ancestors first, then each child directly under its parent (as item_lineage does)', async () => {
    expect((await q.itemLineage('id-S-2', 'both')).map((r) => r.code)).toEqual([
      'S', 'S-2', 'S-2A', 'S-2A1', 'S-2A1A', 'S-2A1B', 'S-2A1(1)', 'S-2A1(2)',
      'S-2A1(2)-1', 'S-2A1(2)-1A', 'S-2A1(2)-2', 'S-2B', 'S-2C',
    ]);
  });

  it('walks up to the origin with negative depths', async () => {
    const up = await q.itemLineage('id-S-2A1', 'up');
    expect(up.map((r) => [r.code, r.depth])).toEqual([['S', -3], ['S-2', -2], ['S-2A', -1], ['S-2A1', 0]]);
  });

  it('walks down through transfers, backups and revivals', async () => {
    const down = await q.itemLineage('id-S-2A1', 'down');
    expect(down.filter((r) => r.depth > 0)).toHaveLength(7);
  });
});

describe('strainTree', () => {
  it('orders siblings numerically, so S2-10 comes after S2-9', async () => {
    const codes = (await q.strainTree(STRAIN)).map((r) => r.code).filter((c) => c.startsWith('S2-'));
    expect(codes).toEqual(['S2-1', 'S2-2', 'S2-3', 'S2-4', 'S2-5', 'S2-6', 'S2-7', 'S2-8', 'S2-9', 'S2-10']);
  });

  it('puts each origin before its children', async () => {
    const codes = (await q.strainTree(STRAIN)).map((r) => r.code);
    expect(codes.indexOf('S')).toBeLessThan(codes.indexOf('S-1'));
    expect(codes.indexOf('S-3')).toBeLessThan(codes.indexOf('S2'));
  });
});

describe('lookupCode', () => {
  it('ignores spaces and case, exact match first, then codes starting with the query', async () => {
    const hits = await q.lookupCode(' s-2a1 (2) ');
    expect(hits[0]).toMatchObject({ code: 'S-2A1(2)', exact: true, strain_name: 'Blue Oyster' });
    expect(hits.map((h) => h.code)).toEqual(['S-2A1(2)', 'S-2A1(2)-1', 'S-2A1(2)-2', 'S-2A1(2)-1A']);
  });

  it('treats % and _ literally', async () => {
    expect(await q.lookupCode('S%')).toEqual([]);
    expect(await q.lookupCode('S_2')).toEqual([]);
  });
});

describe('items and lab records', () => {
  it('returns a culture with its strain, media batch and sterilization run', async () => {
    const item = await q.getItem('id-S-2B');
    expect(item.strains).toEqual({ name: 'Blue Oyster' });
    expect(item.media_batches).toEqual({ code: 'MB-002', sterilization_runs: { code: 'SR-002' } });
    expect((await q.getItem('id-S-2A')).media_batches).toBeNull();
  });

  it('explains when a culture is not on the phone', async () => {
    await expect(q.getItem('nope')).rejects.toThrow('Connect to the internet');
  });

  it('lists recent cultures newest first', async () => {
    expect((await q.recentItems(2)).map((i) => i.code)).toEqual(['S2-10', 'S2-9']);
  });

  it('lists events newest first', async () => {
    expect((await q.itemEvents('id-S-2')).map((e) => e.note)).toEqual(['fast', '2 × agar: S-2A … S-2B']);
  });

  it('filters media batches by kind and includes their run', async () => {
    expect((await q.listBatches('agar')).map((b) => [b.code, b.sterilization_runs?.code ?? null])).toEqual([['MB-002', 'SR-002']]);
    expect((await q.listBatches(null)).map((b) => b.code)).toEqual(['MB-002', 'MB-003']);
    expect((await q.listRuns()).map((r) => r.code)).toEqual(['SR-002']);
  });

  it('lists strains', async () => {
    expect((await q.listStrains()).map((s) => s.name)).toEqual(['Blue Oyster']);
    expect((await q.getStrain(STRAIN)).species).toBe('Pleurotus ostreatus');
  });
});
