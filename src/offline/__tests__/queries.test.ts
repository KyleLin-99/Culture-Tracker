// The local queries must answer exactly like the server functions. The expected
// orders below are the same ones supabase/tests/database/01_culture_codes.test.sql
// checks against item_lineage() and strain_tree().
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { localQueries, type LocalQueries } from '../queries';
import { migrate } from '../schema';
import { pull } from '../sync';
import { ACCOUNT, builder, emptyLab, fakeRemote, standardLab, STRAIN, tick } from '../testing/fakeLab';
import { openTestDb } from '../testing/sqljsDb';

let q: LocalQueries;
let close: () => void;

beforeAll(async () => {
  const db = await openTestDb();
  close = db.close;
  await migrate(db);
  const lab = standardLab();
  lab.sterilization_runs.push({ id: 'run-2', account_id: ACCOUNT, code: 'SR-002', method: 'pressure_cooker', psi: 15, minutes: 90, run_on: '2026-11-19', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
  const recipe = (id: string, version: number, name: string) => ({
    id, account_id: ACCOUNT, family_id: 'fam-mea', version, name, kind: 'agar', volume_ml: 500,
    ingredients: [{ name: 'Malt extract', amount: 10, unit: 'g' }], steps: null, created_at: tick(), updated_at: tick(), deleted_at: null,
  });
  lab.recipes.push(recipe('rc-1', 1, 'MEA'), recipe('rc-2', 2, 'MEA 2%'));
  lab.media_batches.push(
    { id: 'mb-2', account_id: ACCOUNT, code: 'MB-002', kind: 'agar', recipe: 'MEA', sterilization_run_id: 'run-2', recipe_id: 'rc-1', volume_ml: 250, made_on: '2026-11-19', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null },
    { id: 'mb-3', account_id: ACCOUNT, code: 'MB-003', kind: 'lc', recipe: 'Honey', sterilization_run_id: null, recipe_id: null, volume_ml: null, made_on: '2026-11-18', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null },
  );
  lab.items.find((i) => i.code === 'S-2B')!.media_batch_id = 'mb-2';
  lab.events.push(
    { id: 'e1', account_id: ACCOUNT, item_id: 'id-S-2', type: 'transferred', occurred_at: '2026-11-20T10:00:00Z', note: '2 × agar: S-2A … S-2B', contam_type: null, photo_key: null, created_at: tick(), updated_at: tick(), deleted_at: null },
    { id: 'e2', account_id: ACCOUNT, item_id: 'id-S-2', type: 'note', occurred_at: '2026-11-21T10:00:00Z', note: 'fast', contam_type: null, photo_key: null, created_at: tick(), updated_at: tick(), deleted_at: null },
  );
  const check = (id: string, itemId: string, checkedOn: string, createdAt: string, deletedAt: string | null = null) => ({
    id, account_id: ACCOUNT, item_id: itemId, checked_on: checkedOn, percent: 10, radius_mm: null, note: null,
    source: 'manual', created_at: createdAt, updated_at: tick(), deleted_at: deletedAt,
  });
  // Added out of order on purpose; two share a day and differ only by created_at.
  lab.colonization_checks.push(
    check('ck-late', 'id-S-2', '2026-11-22', '2026-11-22T08:00:00Z'),
    check('ck-same-2', 'id-S-2', '2026-11-21', '2026-11-21T18:00:00Z'),
    check('ck-same-1', 'id-S-2', '2026-11-21', '2026-11-21T09:00:00Z'),
    check('ck-removed', 'id-S-2', '2026-11-20', '2026-11-20T09:00:00Z', '2026-11-21T00:00:00Z'),
    check('ck-parent', 'id-S', '2026-11-20', '2026-11-20T10:00:00Z'),
    check('ck-other', 'id-S-3', '2026-11-19', '2026-11-19T10:00:00Z'),
  );
  // Backups: S-2A1(1) retired; settings saved with the slant age changed.
  lab.items.find((i) => i.code === 'S-2A1(1)')!.status = 'used';
  lab.items.find((i) => i.code === 'S-2A1(2)')!.medium = 'slant';
  lab.lab_settings.push({ id: 'ls-1', account_id: ACCOUNT, backup_refresh_days: { slant: 365 }, created_at: tick(), updated_at: tick(), deleted_at: null });
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

  it('shows the exact recipe version each batch was made from', async () => {
    const [mb2, mb3] = await q.listBatches(null);
    expect([mb2.recipes, mb2.volume_ml]).toEqual([{ name: 'MEA', version: 1 }, 250]);
    expect(mb3.recipes).toBeNull();
  });

  it('lists every recipe version with its ingredients', async () => {
    const all = await q.listRecipes();
    expect(all.map((r) => `${r.name} v${r.version}`)).toEqual(['MEA v1', 'MEA 2% v2']);
    expect(all[1].ingredients).toEqual([{ name: 'Malt extract', amount: 10, unit: 'g' }]);
  });

  it('lists strains', async () => {
    expect((await q.listStrains()).map((s) => s.name)).toEqual(['Blue Oyster']);
    expect((await q.getStrain(STRAIN)).species).toBe('Pleurotus ostreatus');
  });
});

describe('itemChecks', () => {
  // Same filter and order as itemChecks() in src/lib/api.ts: deleted_at is null,
  // order by checked_on, then created_at.
  it('leaves out removed checks and orders by checked_on, then created_at', async () => {
    expect((await q.itemChecks(['id-S-2'])).map((c) => c.id)).toEqual(['ck-same-1', 'ck-same-2', 'ck-late']);
  });

  it('merges a culture with its ancestors, and only those asked for', async () => {
    expect((await q.itemChecks(['id-S-2', 'id-S'])).map((c) => c.id)).toEqual(['ck-parent', 'ck-same-1', 'ck-same-2', 'ck-late']);
    expect(await q.itemChecks([])).toEqual([]);
  });
});

describe('backups due', () => {
  it('lists active backups only, with their strain', async () => {
    const rows = await q.activeBackups();
    expect(rows.map((r) => [r.code, r.kind, r.status, r.medium, r.strains?.name])).toEqual([
      ['S-2A1(2)', 'backup', 'active', 'slant', 'Blue Oyster'],
    ]);
  });

  it('reads the lab\'s saved refresh ages from its copy', async () => {
    expect(await q.backupRefreshSettings()).toEqual({ slant: 365 });
  });
});

// refreshInfo() and activeBackups().refreshed_by answer like api.ts does online:
// the newest live refresh by created_at, with its live growth checks counted.
// Its own lab, so these refreshes don't change what the tests above see.
describe('backup refreshes', () => {
  let rq: LocalQueries;
  let closeRefresh: () => void;

  beforeAll(async () => {
    const db = await openTestDb();
    closeRefresh = db.close;
    await migrate(db);
    const lab = standardLab();
    const b = builder(lab);
    const refresh = (createdAt: string, extra: Record<string, unknown> = {}) =>
      Object.assign(b.backup('S-2A1'), { refresh_of: 'id-S-2A1(1)', created_at: createdAt, updated_at: tick() }, extra);
    // Pulled (by updated_at) in a different order than they were made: the first
    // refresh was marked contaminated last, so it's the newest row on the phone.
    refresh('2026-11-15T09:00:00Z'); // S-2A1(3): the newest live refresh
    refresh('2026-11-18T09:00:00Z', { deleted_at: '2026-11-19T00:00:00Z' }); // S-2A1(4): newer, but removed
    refresh('2026-11-10T09:00:00Z', { status: 'contaminated', updated_at: tick() }); // S-2A1(5): the first try
    const check = (id: string, itemId: string, deletedAt: string | null = null) => ({
      id, account_id: ACCOUNT, item_id: itemId, checked_on: '2026-11-20', percent: 40, radius_mm: null, note: null,
      source: 'manual', created_at: tick(), updated_at: tick(), deleted_at: deletedAt,
    });
    lab.colonization_checks.push(
      check('rk-1', 'id-S-2A1(3)'),
      check('rk-2', 'id-S-2A1(3)'),
      check('rk-removed', 'id-S-2A1(3)', '2026-11-21T00:00:00Z'),
      check('rk-old', 'id-S-2A1(5)'),
    );
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
    rq = localQueries(db);
  });
  afterAll(() => closeRefresh());

  it('reports the newest live refresh, counting only its live checks', async () => {
    expect(await rq.refreshInfo('id-S-2A1(1)')).toEqual({
      refreshOf: null,
      refreshedBy: { id: 'id-S-2A1(3)', code: 'S-2A1(3)', status: 'active', checks: 2 },
    });
  });

  it('marks the backup refreshed by that same culture in the active backups', async () => {
    const rows = await rq.activeBackups();
    expect(rows.find((r) => r.code === 'S-2A1(1)')?.refreshed_by).toEqual({ id: 'id-S-2A1(3)', code: 'S-2A1(3)', status: 'active' });
    expect(rows.find((r) => r.code === 'S-2A1(2)')?.refreshed_by).toBeNull();
  });

  it('has nothing to report for a culture that is neither refreshed nor a refresh', async () => {
    expect(await rq.refreshInfo('id-S-2')).toEqual({ refreshOf: null, refreshedBy: null });
  });
});

// statsRows() is the phone's stats_rows() (supabase/migrations/*_stats_rows.sql).
// Its own lab, so these plates don't change what the tests above see.
describe('statsRows', () => {
  let sq: LocalQueries;
  let closeStats: () => void;
  const FROM = '2026-11-01';
  const TO = '2026-11-30';

  beforeAll(async () => {
    const db = await openTestDb();
    closeStats = db.close;
    await migrate(db);
    const lab = emptyLab();
    lab.strains.push({ id: STRAIN, account_id: ACCOUNT, name: 'Blue Oyster', species: null, notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
    lab.sterilization_runs.push({ id: 'run-1', account_id: ACCOUNT, code: 'SR-001', method: 'pressure_cooker', psi: 15, minutes: 90, run_on: '2026-10-30', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
    const recipe = (id: string, version: number, name: string) => ({
      id, account_id: ACCOUNT, family_id: 'fam-pda', version, name, kind: 'agar', volume_ml: 500,
      ingredients: [], steps: null, created_at: tick(), updated_at: tick(), deleted_at: null,
    });
    // The batch was made from v1; the recipe has since been renamed in v2 and v3.
    lab.recipes.push(recipe('pda-1', 1, 'PDA'), recipe('pda-3', 3, 'PDA lean'), recipe('pda-2', 2, 'PDA 2%'));
    lab.media_batches.push({ id: 'mb-1', account_id: ACCOUNT, code: 'MB-001', kind: 'agar', recipe: 'PDA', sterilization_run_id: 'run-1', recipe_id: 'pda-1', volume_ml: 250, made_on: '2026-10-30', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });

    const b = builder(lab);
    b.origin('S', null, { madeOn: '2026-11-10' }); // origins are never counted
    b.transfer('S', { madeOn: '2026-10-31' }); // S-1: the day before the range
    b.transfer('S', { madeOn: FROM, mediaBatchId: 'mb-1' }); // S-2: first day, included
    b.transfer('S', { madeOn: TO }); // S-3: last day, included
    b.transfer('S', { madeOn: '2026-12-01' }); // S-4: the day after
    b.transfer('S-2', { madeOn: '2026-11-05', status: 'contaminated' }); // S-2A
    b.transfer('S-2', { madeOn: '2026-11-05', status: 'discarded' }); // S-2B: contaminated, then discarded
    b.transfer('S-2', { madeOn: '2026-11-05', status: 'discarded' }); // S-2C: clean, discarded
    b.transfer('S-2', { madeOn: '2026-11-05' }); // S-2D: contaminated event removed
    b.transfer('S-2', { madeOn: '2026-11-05', status: 'used' }); // S-2E: contaminated, then used
    b.transfer('S-2', { madeOn: '2026-11-05', status: 'discarded' }); // S-2F: discarded, removed contaminated event
    b.backup('S-2', { madeOn: '2026-11-06' }); // S-2(1)

    const event = (id: string, itemId: string, type: string, deletedAt: string | null = null) => ({
      id, account_id: ACCOUNT, item_id: itemId, type, occurred_at: '2026-11-07T10:00:00Z', note: null, contam_type: null,
      photo_key: null, created_at: tick(), updated_at: tick(), deleted_at: deletedAt,
    });
    lab.events.push(
      event('ev-b', 'id-S-2B', 'contaminated'),
      event('ev-d', 'id-S-2D', 'contaminated', '2026-11-08T00:00:00Z'),
      event('ev-d-note', 'id-S-2D', 'note'),
      event('ev-e', 'id-S-2E', 'contaminated'),
      event('ev-f', 'id-S-2F', 'contaminated', '2026-11-08T00:00:00Z'),
    );
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: '2025-11-23' });
    sq = localQueries(db);
  });
  afterAll(() => closeStats());

  it('counts transfers and backups made in the range, both ends included, and no origins', async () => {
    const rows = await sq.statsRows(FROM, TO);
    expect(rows.map((r) => r.id).sort()).toEqual(
      ['id-S-2', 'id-S-2(1)', 'id-S-2A', 'id-S-2B', 'id-S-2D', 'id-S-2E', 'id-S-3'].sort(),
    );
    expect(rows.find((r) => r.id === 'id-S-2(1)')!.kind).toBe('backup');
    expect(rows.map((r) => r.made_on)).toEqual([...rows.map((r) => r.made_on)].sort());
  });

  it('marks a plate contaminated by its status or a live contaminated event, not a removed one', async () => {
    const rows = await sq.statsRows(FROM, TO);
    const c = Object.fromEntries(rows.map((r) => [r.id, r.contaminated]));
    expect(c).toEqual({
      'id-S-2': false,
      'id-S-2(1)': false,
      'id-S-2A': true, // status contaminated
      'id-S-2B': true, // event, then discarded
      'id-S-2D': false, // event removed
      'id-S-2E': true, // event, then used
      'id-S-3': false,
    });
    expect(rows.every((r) => typeof r.contaminated === 'boolean')).toBe(true);
  });

  it('leaves out clean discarded plates but keeps contaminated ones that were discarded', async () => {
    const ids = (await sq.statsRows(FROM, TO)).map((r) => r.id);
    expect(ids).toContain('id-S-2B');
    expect(ids).not.toContain('id-S-2C');
    expect(ids).not.toContain('id-S-2F'); // its only contaminated event was removed
  });

  it("fills batch and run codes and the recipe family's current name", async () => {
    const rows = await sq.statsRows(FROM, TO);
    expect(rows.find((r) => r.id === 'id-S-2')).toMatchObject({
      strain_id: STRAIN, strain_name: 'Blue Oyster', generation: 1,
      batch_id: 'mb-1', batch_code: 'MB-001', run_id: 'run-1', run_code: 'SR-001',
      recipe_family: 'fam-pda', recipe_name: 'PDA lean',
    });
    expect(rows.find((r) => r.id === 'id-S-3')).toMatchObject({
      batch_id: null, batch_code: null, run_id: null, run_code: null, recipe_family: null, recipe_name: null,
    });
  });
});
