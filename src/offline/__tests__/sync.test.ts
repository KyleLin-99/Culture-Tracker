import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { localQueries } from '../queries';
import { getMeta, migrate, SCHEMA_VERSION, setMeta } from '../schema';
import type { SqlDb } from '../sql';
import { OVERLAP_MS, pull } from '../sync';
import { ACCOUNT, builder, emptyLab, fakeRemote, standardLab, STRAIN, tick } from '../testing/fakeLab';
import { openTestDb } from '../testing/sqljsDb';

/**
 * Writes rows the way an older version of the app would have: only the columns
 * that phone's schema has (newer columns didn't exist yet).
 */
async function insertAsOldPhone(db: SqlDb, table: string, rows: Record<string, unknown>[]) {
  const cols = (await db.all<{ name: string }>(`pragma table_info(${table})`)).map((c) => c.name).filter((c) => c !== 'local_pending');
  for (const row of rows) {
    const present = cols.filter((c) => c in row);
    await db.run(
      `insert into ${table} (${present.join(', ')}) values (${present.map(() => '?').join(', ')})`,
      present.map((c) => {
        const v = row[c];
        return v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : (v as string | number);
      }),
    );
  }
}

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

  it('upgrades a phone already in use: keeps its copy and brings recipes down', async () => {
    const old = await openTestDb();
    // A phone on the version before recipes, with a synced copy.
    await migrate(old, 2);
    const lab = standardLab();
    await insertAsOldPhone(old, 'items', lab.items.slice(0, 3));
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');

    lab.recipes.push({ id: 'rc-1', account_id: ACCOUNT, family_id: 'f', version: 1, name: 'MEA', kind: 'agar', volume_ml: 500,
      ingredients: [{ name: 'Agar', amount: 10, unit: 'g' }], steps: null, created_at: tick(), updated_at: tick(), deleted_at: null });
    await migrate(old);
    await pull(old, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    expect((await old.first<{ n: number }>('select count(*) as n from items'))!.n).toBe(lab.items.length);
    expect((await localQueries(old).listRecipes()).map((r) => r.name)).toEqual(['MEA']);
    old.close();
  });

  it('upgrades a phone on version 3: keeps its copy and pending changes, then pulls checks', async () => {
    const old = await openTestDb();
    // A phone on the version before colonization checks, with a synced copy and a queued change.
    await migrate(old, 3);
    const lab = standardLab();
    await insertAsOldPhone(old, 'items', lab.items.slice(0, 3));
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');
    await old.run("insert into outbox (op, payload, created_at) values ('status', '{}', '2026-11-23T12:00:00Z')");

    // Logged long ago on another device: the first pull of a new table takes every row.
    lab.colonization_checks.push({
      id: 'ck-1', account_id: ACCOUNT, item_id: 'id-S', checked_on: '2026-11-21', percent: 30, radius_mm: 12,
      note: null, source: 'manual', created_at: '2024-01-05T00:00:00Z', updated_at: '2024-01-05T00:00:00Z', deleted_at: null,
    });
    await migrate(old);
    expect((await old.first<{ user_version: number }>('pragma user_version'))!.user_version).toBe(SCHEMA_VERSION);
    expect((await old.first<{ n: number }>('select count(*) as n from outbox'))!.n).toBe(1);

    await pull(old, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await old.first<{ n: number }>('select count(*) as n from items'))!.n).toBe(lab.items.length);
    expect((await localQueries(old).itemChecks(['id-S'])).map((c) => [c.id, c.percent, c.radius_mm])).toEqual([['ck-1', 30, 12]]);
    old.close();
  });

  it('upgrades a phone from the version before lab settings: keeps its copy, then pulls the settings', async () => {
    const old = await openTestDb();
    await migrate(old, 4); // was SCHEMA_VERSION - 1, which stopped meaning "before lab settings" at version 6
    const lab = standardLab();
    await insertAsOldPhone(old, 'items', lab.items.slice(0, 3));
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');
    await old.run("insert into outbox (op, payload, created_at) values ('status', '{}', '2026-11-23T12:00:00Z')");
    expect(await localQueries(old).recentItems(100)).toHaveLength(3);

    // Saved long ago on another device: the first pull of a new table takes every row.
    lab.lab_settings.push({ id: 'ls-1', account_id: ACCOUNT, backup_refresh_days: { lc: 90 },
      created_at: '2024-01-05T00:00:00Z', updated_at: '2024-01-05T00:00:00Z', deleted_at: null });
    await migrate(old);
    expect((await old.first<{ user_version: number }>('pragma user_version'))!.user_version).toBe(SCHEMA_VERSION);
    expect((await old.first<{ n: number }>('select count(*) as n from outbox'))!.n).toBe(1);
    expect(await localQueries(old).backupRefreshSettings()).toEqual({});

    await pull(old, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await old.first<{ n: number }>('select count(*) as n from items'))!.n).toBe(lab.items.length);
    expect(await localQueries(old).backupRefreshSettings()).toEqual({ lc: 90 });
    old.close();
  });

  it('upgrades a phone on version 5: keeps its copy and pending changes, and later refreshes keep their link', async () => {
    const old = await openTestDb();
    await migrate(old, 5);
    const lab = standardLab();
    await insertAsOldPhone(old, 'items', lab.items.slice(0, 3));
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');
    await old.run("insert into outbox (op, payload, created_at) values ('status', '{}', '2026-11-23T12:00:00Z')");

    await migrate(old);
    expect((await old.first<{ user_version: number }>('pragma user_version'))!.user_version).toBe(SCHEMA_VERSION);
    expect((await old.first<{ n: number }>('select count(*) as n from outbox'))!.n).toBe(1);
    expect((await old.all<{ refresh_of: string | null }>('select refresh_of from items')).map((r) => r.refresh_of)).toEqual([null, null, null]);

    Object.assign(builder(lab).backup('S-2A1'), { refresh_of: 'id-S-2A1(1)', updated_at: tick() }); // S-2A1(3)
    await pull(old, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await localQueries(old).refreshInfo('id-S-2A1(1)')).refreshedBy).toMatchObject({ code: 'S-2A1(3)' });
    expect((await localQueries(old).activeBackups()).find((b) => b.code === 'S-2A1(1)')?.refreshed_by).toMatchObject({ code: 'S-2A1(3)' });
    old.close();
  });

  // The server's refresh_of (and the web's Refresh button) can go live before a
  // phone updates the app. Such a phone pulls the web's refreshes without the
  // column it doesn't have yet; once it upgrades, it must pull them again or
  // those backups stay "due" on the phone for good.
  it('restores refresh links an older phone pulled before it knew about them', async () => {
    const old = await openTestDb();
    await migrate(old, 5);
    const lab = standardLab();
    Object.assign(builder(lab).backup('S-2A1'), { refresh_of: 'id-S-2A1(1)', updated_at: tick() }); // made on the web
    await insertAsOldPhone(old, 'items', lab.items); // the old app's pull: no refresh_of column
    // ...and kept syncing for a while after, so the refresh is older than the pull overlap.
    const newest = lab.items.map((i) => i.updated_at as string).sort().at(-1)!;
    await setMeta(old, 'pulled_until_items', new Date(Date.parse(newest) + OVERLAP_MS + 60_000).toISOString());
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');

    await migrate(old);
    await pull(old, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await old.first<{ refresh_of: string | null }>("select refresh_of from items where id = 'id-S-2A1(3)'"))?.refresh_of).toBe(
      'id-S-2A1(1)',
    );
    expect((await localQueries(old).activeBackups()).find((b) => b.code === 'S-2A1(1)')?.refreshed_by).toMatchObject({ code: 'S-2A1(3)' });
    old.close();
  });
});

// Bug: someone in two labs saw both labs' strains after switching labs. Row-level
// security lets them read every lab they belong to, and the phone's pull never
// named the lab, so one local copy held both labs.
const OTHER = 'acct-2';

/** Rows of a second lab the same person belongs to, in every table the phone keeps. */
function addOtherLab(lab: ReturnType<typeof emptyLab>) {
  const base = { account_id: OTHER, created_at: tick(), updated_at: tick(), deleted_at: null };
  lab.lab_settings.push({ ...base, id: 'o-ls', backup_refresh_days: { slant: 7 } });
  lab.strains.push({ ...base, id: 'o-strain', name: 'Other Lab Reishi', species: null, notes: null });
  lab.sterilization_runs.push({ ...base, id: 'o-run', code: 'SR-001', method: 'autoclave', psi: null, minutes: null, run_on: '2026-11-19', notes: null });
  lab.recipes.push({ ...base, id: 'o-rc', family_id: 'o-fam', version: 1, name: 'Other PDA', kind: 'agar', volume_ml: 500, ingredients: [], steps: null });
  lab.media_batches.push({ ...base, id: 'o-mb', code: 'MB-001', kind: 'agar', recipe: 'PDA', sterilization_run_id: 'o-run', recipe_id: 'o-rc', volume_ml: null, made_on: '2026-11-19', notes: null });
  lab.items.push({
    ...base, id: 'o-item', strain_id: 'o-strain', parent_id: null, kind: 'origin', medium: 'agar', origin_prefix: 'S',
    origin_number: null, position: null, backup_number: null, code: 'S', generation: 0, status: 'active', location: null,
    media_batch_id: 'o-mb', made_on: '2026-11-20', initials: 'OT', notes: null, aliases: [], refresh_of: null,
  });
  lab.events.push({ ...base, id: 'o-ev', item_id: 'o-item', type: 'note', occurred_at: '2026-11-20T10:00:00Z', note: 'other', contam_type: null, photo_key: null });
  lab.colonization_checks.push({ ...base, id: 'o-ck', item_id: 'o-item', checked_on: '2026-11-21', percent: 50, radius_mm: null, note: null, source: 'manual' });
  lab.relabels.push({ ...base, id: 'o-rl', entity: 'item', entity_id: 'o-item', old_code: 'S', new_code: 'S2', resolved_at: null });
  lab.technique_changes.push({ ...base, id: 'o-tc', changed_on: '2026-11-01', title: 'Other lab flow hood', note: null });
  return lab;
}

const ALL_TABLES = ['lab_settings', 'strains', 'sterilization_runs', 'recipes', 'media_batches', 'items', 'events', 'colonization_checks', 'relabels'];

async function accountsIn(d: SqlDb, table: string) {
  return (await d.all<{ account_id: string }>(`select distinct account_id from ${table} order by account_id`)).map((r) => r.account_id);
}

describe('someone in two labs', () => {
  it('pulls only the lab being synced, though the server would serve both', async () => {
    const lab = addOtherLab(standardLab());
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    expect(await count('items')).toBe(lab.items.filter((i) => i.account_id === ACCOUNT).length);
    for (const t of ALL_TABLES) expect([t, await accountsIn(db, t)]).toEqual([t, (await count(t)) ? [ACCOUNT] : []]);
    const q = localQueries(db);
    expect((await q.listStrains()).map((s) => s.name)).toEqual(['Blue Oyster']);
    expect((await q.lookupCode('S')).every((r) => r.strain_name === 'Blue Oyster')).toBe(true);
    expect(await q.backupRefreshSettings()).toEqual({});
  });

  it('switching to the other lab shows only that lab', async () => {
    const lab = addOtherLab(standardLab());
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    await pull(db, fakeRemote(lab).remote, { accountId: OTHER, historyFrom: HISTORY_FROM });

    for (const t of ALL_TABLES) expect([t, await accountsIn(db, t)]).toEqual([t, [OTHER]]);
    expect((await localQueries(db).listStrains()).map((s) => s.name)).toEqual(['Other Lab Reishi']);
  });

  it('schema step 7 removes the other lab an older phone pulled, keeping this lab and pending changes', async () => {
    const old = await openTestDb();
    await migrate(old, 6);
    // The old app's pull: every lab the person belongs to, in one copy.
    const lab = addOtherLab(standardLab());
    lab.lab_settings.push({ id: 'ls-1', account_id: ACCOUNT, backup_refresh_days: { lc: 90 }, created_at: tick(), updated_at: tick(), deleted_at: null });
    for (const t of ALL_TABLES) await insertAsOldPhone(old, t, lab[t as keyof typeof lab]);
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');
    await old.run("insert into outbox (op, payload, created_at) values ('status', '{}', '2026-11-23T12:00:00Z')");
    expect(await accountsIn(old, 'strains')).toEqual([ACCOUNT, OTHER]);

    await migrate(old);
    expect((await old.first<{ user_version: number }>('pragma user_version'))!.user_version).toBe(SCHEMA_VERSION);
    for (const t of ALL_TABLES) {
      const own = lab[t as keyof typeof lab].filter((r) => r.account_id === ACCOUNT).length;
      expect([t, await accountsIn(old, t), (await old.first<{ n: number }>(`select count(*) as n from ${t}`))!.n]).toEqual([
        t, own ? [ACCOUNT] : [], own,
      ]);
    }
    expect((await old.first<{ n: number }>('select count(*) as n from outbox'))!.n).toBe(1);
    expect(await getMeta(old, 'account_id')).toBe(ACCOUNT);
    expect((await localQueries(old).listStrains()).map((s) => s.name)).toEqual(['Blue Oyster']);
    expect(await localQueries(old).backupRefreshSettings()).toEqual({ lc: 90 });
    old.close();
  });

  it('schema step 7 leaves a copy alone when it does not know its lab yet', async () => {
    const old = await openTestDb();
    await migrate(old, 6);
    await insertAsOldPhone(old, 'strains', addOtherLab(standardLab()).strains);
    await migrate(old);
    expect(await accountsIn(old, 'strains')).toEqual([ACCOUNT, OTHER]);
    old.close();
  });
});

describe('lab settings', () => {
  const settings = (days: Record<string, number>) => ({
    id: 'ls-1', account_id: ACCOUNT, backup_refresh_days: days, created_at: tick(), updated_at: tick(), deleted_at: null,
  });

  it('picks up a later change to the refresh ages', async () => {
    const lab = standardLab();
    lab.lab_settings.push(settings({ slant: 365 }));
    const { remote } = fakeRemote(lab);
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    Object.assign(lab.lab_settings[0], { backup_refresh_days: { slant: 200, agar: 30 }, updated_at: tick() });
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });

    expect(await count('lab_settings')).toBe(1);
    expect(await localQueries(db).backupRefreshSettings()).toEqual({ slant: 200, agar: 30 });
  });

  it('are wiped when a different lab signs in, so it never sees the old lab\'s ages', async () => {
    const lab = standardLab();
    lab.lab_settings.push(settings({ slant: 365 }));
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect(await count('lab_settings')).toBe(1);

    await pull(db, fakeRemote(emptyLab()).remote, { accountId: 'acct-2', historyFrom: HISTORY_FROM });
    expect(await count('lab_settings')).toBe(0);
    expect(await localQueries(db).backupRefreshSettings()).toEqual({});
  });
});

describe('technique changes', () => {
  const change = (id: string, changedOn: string, title: string, at = tick()) => ({
    id, account_id: ACCOUNT, changed_on: changedOn, title, note: null, created_at: at, updated_at: at, deleted_at: null,
  });

  it('schema step 8 upgrades a phone on version 7: keeps its copy and pending changes, then pulls every change', async () => {
    const old = await openTestDb();
    await migrate(old, 7);
    const lab = standardLab();
    await insertAsOldPhone(old, 'items', lab.items.slice(0, 3));
    await setMeta(old, 'account_id', ACCOUNT);
    await setMeta(old, 'first_pull_done', '1');
    await setMeta(old, 'pulled_until_items', '2026-11-23T00:00:00Z');
    await old.run("insert into outbox (op, payload, created_at) values ('status', '{}', '2026-11-23T12:00:00Z')");
    expect(await old.first("select name from sqlite_master where name = 'technique_changes'")).toBeFalsy();

    // Added on the web long before this phone upgraded: the first pull of a new table takes every row.
    lab.technique_changes.push(change('tc-1', '2024-01-05', 'Started using a flow hood', '2024-01-05T00:00:00Z'));
    await migrate(old);
    expect((await old.first<{ user_version: number }>('pragma user_version'))!.user_version).toBe(SCHEMA_VERSION);
    expect((await old.first<{ n: number }>('select count(*) as n from outbox'))!.n).toBe(1);
    expect((await old.first<{ n: number }>('select count(*) as n from items'))!.n).toBe(3);
    expect(await localQueries(old).listTechniqueChanges()).toEqual([]);

    await pull(old, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await localQueries(old).listTechniqueChanges()).map((c) => [c.id, c.changed_on, c.title])).toEqual([
      ['tc-1', '2024-01-05', 'Started using a flow hood'],
    ]);
    old.close();
  });

  it('picks up new and removed changes on later pulls', async () => {
    const lab = standardLab();
    lab.technique_changes.push(change('tc-1', '2026-10-01', 'Flow hood'));
    const { remote } = fakeRemote(lab);
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await localQueries(db).listTechniqueChanges()).map((c) => c.id)).toEqual(['tc-1']);

    lab.technique_changes.push(change('tc-2', '2026-09-01', 'MEA 2%'));
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await localQueries(db).listTechniqueChanges()).map((c) => c.id)).toEqual(['tc-2', 'tc-1']);

    Object.assign(lab.technique_changes[0], { deleted_at: tick(), updated_at: tick() });
    await pull(db, remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect((await localQueries(db).listTechniqueChanges()).map((c) => c.id)).toEqual(['tc-2']);
  });

  it('pulls only the lab being synced, and a lab switch clears them', async () => {
    const lab = addOtherLab(standardLab());
    lab.technique_changes.push(change('tc-1', '2026-10-01', 'Flow hood'));
    await pull(db, fakeRemote(lab).remote, { accountId: ACCOUNT, historyFrom: HISTORY_FROM });
    expect(await accountsIn(db, 'technique_changes')).toEqual([ACCOUNT]);
    expect((await localQueries(db).listTechniqueChanges()).map((c) => c.title)).toEqual(['Flow hood']);

    await pull(db, fakeRemote(lab).remote, { accountId: OTHER, historyFrom: HISTORY_FROM });
    expect(await accountsIn(db, 'technique_changes')).toEqual([OTHER]);
    expect((await localQueries(db).listTechniqueChanges()).map((c) => c.title)).toEqual(['Other lab flow hood']);
  });
});
