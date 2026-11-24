// The phone's sync and offline queue, run against a real Supabase: the same
// API calls, server functions and row-level security the app meets in the lab.
// A phone here is a SQLite database (sql.js) plus the app's real offline code.
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'pg';

import * as api from '@/lib/api';
import { failedChanges, flush } from '@/offline/outbox';
import { localQueries } from '@/offline/queries';
import { createRemote } from '@/offline/remote';
import { createWriteRemote } from '@/offline/remoteWrite';
import type { SqlDb } from '@/offline/sql';
import { pull } from '@/offline/sync';
import { localWriter } from '@/offline/writer';

import { loadTestEnv, type TestEnv } from './env';
import { adminDb, localToday, must, newLab, newPhone, newUser } from './helpers';

// The web's reads in src/lib/api.ts, run against the real API: its Supabase client
// is swapped for a test user's, and there is no local copy (as on the web), so
// api.getBatch() etc. take their server path and can be compared with the phone's.
let mockServer: SupabaseClient | null = null;
jest.mock('@/lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, key) => (mockServer as unknown as Record<string | symbol, unknown>)[key] }),
}));
jest.mock('@/offline/engine', () => ({
  localReader: async () => null,
  localWriter: async () => null,
  afterWrite: async () => undefined,
  syncNow: async () => undefined,
  listFailedChanges: async () => [],
  dismissFailedChange: async () => undefined,
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));

const env = loadTestEnv();
if (!env && process.env.CI) throw new Error('CI: local Supabase not found (supabase status)');
const suite = env ? describe : describe.skip;

const TODAY = localToday();
const YEAR_AGO = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

let admin: Client;
let lab: Awaited<ReturnType<typeof newLab>>;
const phones: (SqlDb & { close(): void })[] = [];

/** A phone signed in to `lab`, with a first sync done. */
async function phone(who = lab) {
  const db = await newPhone();
  phones.push(db);
  const remote = createRemote(who.client);
  const write = createWriteRemote(who.client);
  let n = 0;
  const writer = localWriter({ db, newId: () => crypto.randomUUID(), now: () => new Date(Date.now() + (n += 1)).toISOString(), initials: 'KL' });
  const sync = async () => {
    const sent = await flush(db, write);
    await pull(db, remote, { accountId: who.accountId, historyFrom: YEAR_AGO });
    return sent;
  };
  await sync();
  return { db, writer, sync, q: localQueries(db) };
}

const serverId = async (code: string) =>
  (await admin.query('select id from items where code = $1 and account_id = $2', [code, lab.accountId])).rows[0]?.id as string;

suite('offline sync against real Supabase', () => {
  beforeAll(async () => {
    admin = await adminDb(env as TestEnv);
    lab = await newLab(env as TestEnv, admin);
    const c = lab.client;
    // S with S-1, S-2, S-3; S-2 with S-2A, S-2B; S-2A with S-2A1 and two backups.
    const origin = must(await c.from('items').insert({ account_id: lab.accountId, strain_id: lab.strainId, kind: 'origin', medium: 'spore_print', origin_prefix: 'S' }).select().single()) as { id: string };
    await c.rpc('create_transfers', { p_parent_id: origin.id, p_count: 3, p_medium: 'agar', p_made_on: TODAY });
    await c.rpc('create_transfers', { p_parent_id: await serverId('S-2'), p_count: 2, p_medium: 'agar', p_made_on: TODAY });
    await c.rpc('create_transfers', { p_parent_id: await serverId('S-2A'), p_count: 1, p_medium: 'lc', p_made_on: TODAY });
    await c.rpc('create_backups', { p_parent_id: await serverId('S-2A1'), p_count: 2, p_medium: 'slant', p_made_on: TODAY });
  });

  afterAll(async () => {
    phones.forEach((p) => p.close());
    await admin?.end();
  });

  it('copies the lab to a phone, and the phone answers lineage exactly like the server', async () => {
    const { q } = await phone();
    for (const code of ['S', 'S-2', 'S-2A1']) {
      const id = await serverId(code);
      const server = must(await lab.client.rpc('item_lineage', { p_item_id: id, p_direction: 'both' })) as { code: string; depth: number }[];
      const local = await q.itemLineage(id, 'both');
      expect(local.map((r) => [r.code, r.depth])).toEqual(server.map((r) => [r.code, r.depth]));
    }
    const serverTree = must(await lab.client.rpc('strain_tree', { p_strain_id: lab.strainId })) as { code: string }[];
    expect((await q.strainTree(lab.strainId)).map((r) => r.code)).toEqual(serverTree.map((r) => r.code));
  });

  it('keeps old retired cultures off the phone, except ancestors of ones it keeps', async () => {
    // W (2 years old, used) -> W-1 (old, used) -> W-1A (active): W and W-1 come down as ancestors.
    // X (2 years old, used) is nobody's ancestor and stays off.
    const old = '2024-01-15';
    const c = lab.client;
    for (const prefix of ['W', 'X']) {
      must(await c.from('items').insert({ account_id: lab.accountId, strain_id: lab.strainId, kind: 'origin', medium: 'tissue', origin_prefix: prefix, made_on: old, status: 'used' }));
    }
    await c.rpc('create_transfers', { p_parent_id: await serverId('W'), p_count: 1, p_medium: 'agar', p_made_on: old });
    await c.rpc('set_item_status', { p_item_id: await serverId('W-1'), p_status: 'used' });
    await c.rpc('create_transfers', { p_parent_id: await serverId('W-1'), p_count: 1, p_medium: 'agar', p_made_on: '2024-02-01' });

    const { q } = await phone();
    const codes = (await q.lookupCode('W')).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['W', 'W-1', 'W-1A']));
    expect(await q.lookupCode('X')).toEqual([]);
  });

  it('saves offline, then sends in order with the planned codes', async () => {
    const p = await phone();
    const s3 = await serverId('S-3');
    const { ids } = await p.writer.createTransfers({ parentId: s3, count: 2, medium: 'agar', madeOn: TODAY });
    const child = await p.writer.createTransfers({ parentId: ids[0], count: 1, medium: 'lc', madeOn: TODAY });
    await p.writer.setItemStatus(ids[1], 'contaminated', undefined, 'trich');
    await p.writer.addNote(lab.accountId, ids[0], 'fast');

    expect(await p.sync()).toEqual({ sent: 4, failed: 0, offline: false });
    const rows = (await admin.query('select code, status from items where id = any($1) order by code', [[...ids, ...child.ids]])).rows;
    expect(rows).toEqual([
      { code: 'S-3A', status: 'active' },
      { code: 'S-3A1', status: 'active' },
      { code: 'S-3B', status: 'contaminated' },
    ]);
    const events = (await admin.query("select type, note from events where item_id = any($1) or item_id = $2 order by occurred_at", [ids, s3])).rows;
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['transferred', 'contaminated', 'note']));

    // Sending again changes nothing on the server.
    const before = (await admin.query('select count(*)::int as n from items where account_id = $1', [lab.accountId])).rows[0].n;
    await flush(p.db, createWriteRemote(lab.client));
    expect((await admin.query('select count(*)::int as n from items where account_id = $1', [lab.accountId])).rows[0].n).toBe(before);
  });

  it('two phones offline pick the same code: the first keeps it, the second relabels', async () => {
    const a = await phone();
    const b = await phone();
    const s1 = await serverId('S-1');
    const fromA = await a.writer.createTransfers({ parentId: s1, count: 1, medium: 'agar', madeOn: TODAY });
    const fromB = await b.writer.createTransfers({ parentId: s1, count: 1, medium: 'agar', madeOn: TODAY });
    const childB = await b.writer.createTransfers({ parentId: fromB.ids[0], count: 1, medium: 'agar', madeOn: TODAY });
    expect((await a.writer.readItems(fromA.ids))[0].code).toBe('S-1A');
    expect((await b.writer.readItems(fromB.ids))[0].code).toBe('S-1A');

    await a.sync();
    await b.sync();

    expect((await b.writer.readItems([...fromB.ids, ...childB.ids])).map((i) => i.code)).toEqual(['S-1B', 'S-1B1']);
    const relabels = await b.q.openRelabels();
    expect(relabels.map((r) => `${r.old_code}>${r.new_code}`)).toEqual(['S-1A>S-1B', 'S-1A1>S-1B1']);

    // Marking one relabeled reaches the server and the other phone.
    await b.writer.resolveRelabel(relabels[0].id);
    await b.sync();
    await a.sync();
    expect((await a.q.openRelabels()).map((r) => r.old_code)).toEqual(['S-1A1']);
  });

  it('a change the server refuses is undone on the phone with the reason', async () => {
    const p = await phone();
    const target = await serverId('S-2B');
    await p.writer.setItemStatus(target, 'used');
    // Meanwhile the culture was removed (soft-deleted) on the server.
    await admin.query('update items set deleted_at = now() where id = $1', [target]);

    const result = await p.sync();
    expect(result.failed).toBe(1);
    expect((await failedChanges(p.db))[0].error).toMatch(/Item not found/);
    expect((await admin.query('select status from items where id = $1', [target])).rows[0].status).toBe('active');
  });

  it('a new strain made offline syncs once, even if sent twice', async () => {
    const p = await phone();
    const strain = await p.writer.createStrain(lab.accountId, 'Lion’s Mane', 'Hericium erinaceus');
    await p.sync();
    await flush(p.db, createWriteRemote(lab.client)); // nothing queued; harmless
    const rows = (await admin.query('select name from strains where id = $1', [strain.id])).rows;
    expect(rows).toEqual([{ name: 'Lion’s Mane' }]);
  });

  it('notes edited and removed on a phone reach the server, and other history stays fixed', async () => {
    const p = await phone();
    const s1 = await serverId('S-1');
    await p.writer.addNote(lab.accountId, s1, 'Slow growth');
    await p.sync();
    const note = (await p.q.itemEvents(s1)).find((e) => e.type === 'note')!;

    await p.writer.changeNote(note.id, 'Fast, rhizomorphic');
    await p.sync();
    expect((await admin.query('select note from events where id = $1', [note.id])).rows[0].note).toBe('Fast, rhizomorphic');

    await p.writer.changeNote(note.id, null);
    await p.sync();
    expect((await admin.query('select deleted_at from events where id = $1', [note.id])).rows[0].deleted_at).not.toBeNull();
    expect((await p.q.itemEvents(s1)).some((e) => e.id === note.id)).toBe(false);

    // The server refuses edits to automatic history, even straight through the API.
    const transfer = (await admin.query("select id from events where item_id = $1 and type = 'transferred'", [await serverId('S-2')])).rows[0].id;
    const { error } = await lab.client.rpc('edit_note', { p_id: transfer, p_note: 'changed' });
    expect(error?.message).toBe('Only notes can be edited or removed');
  });

  it('recipes saved online reach the phone, and batches show the version they used', async () => {
    const c = lab.client;
    const v1 = must(await c.rpc('save_recipe', {
      p_account_id: lab.accountId, p_family_id: null, p_name: 'MEA 2%', p_kind: 'agar', p_volume_ml: 500,
      p_ingredients: [{ name: 'Malt extract', amount: 10, unit: 'g' }],
    })) as { id: string; family_id: string };
    must(await c.rpc('save_recipe', {
      p_account_id: lab.accountId, p_family_id: v1.family_id, p_name: 'MEA 2%', p_kind: 'agar', p_volume_ml: 1000,
      p_ingredients: [{ name: 'Malt extract', amount: 20, unit: 'g' }],
    }));
    must(await c.from('media_batches').insert({ account_id: lab.accountId, kind: 'agar', recipe_id: v1.id, volume_ml: 250 }));

    const p = await phone();
    const versions = (await p.q.listRecipes()).filter((r) => r.family_id === v1.family_id);
    expect(versions.map((r) => [r.version, r.volume_ml, r.ingredients[0].amount])).toEqual([[1, 500, 10], [2, 1000, 20]]);
    const batch = (await p.q.listBatches('agar')).find((b) => b.recipe_id === v1.id)!;
    expect([batch.recipes, batch.volume_ml]).toEqual([{ name: 'MEA 2%', version: 1, family_id: v1.family_id }, 250]);
  });

  it('growth checks logged offline reach the server once, and can be removed', async () => {
    const p = await phone();
    const s1 = await serverId('S-1');
    const madeOn = (await admin.query('select made_on::text as d from items where id = $1', [s1])).rows[0].d as string;
    const check = await p.writer.logCheck({ itemId: s1, checkedOn: madeOn, percent: 15, radiusMm: 6, note: 'even' });
    await p.sync();
    await p.sync(); // a second send is harmless
    const rows = (await admin.query('select percent::float, radius_mm::float, note from colonization_checks where id = $1', [check.id])).rows;
    expect(rows).toEqual([{ percent: 15, radius_mm: 6, note: 'even' }]);

    await p.writer.removeCheck(check.id);
    await p.sync();
    expect((await admin.query('select deleted_at from colonization_checks where id = $1', [check.id])).rows[0].deleted_at).not.toBeNull();
    expect(await p.q.itemChecks([s1])).toEqual([]);
  });

  it('backup refresh ages saved online reach the phone', async () => {
    must(await lab.client.rpc('set_backup_refresh', { p_account_id: lab.accountId, p_days: { slant: 365, agar: 45 } }));
    const p = await phone();
    expect(await p.q.backupRefreshSettings()).toEqual({ slant: 365, agar: 45 });
    // Every active backup on the phone is one the server lists too.
    const server = (await admin.query("select code from items where account_id = $1 and kind = 'backup' and status = 'active' and deleted_at is null order by made_on, code", [lab.accountId])).rows.map((r) => r.code);
    expect((await p.q.activeBackups()).map((b) => b.code)).toEqual(server);
  });

  it('stats rows on the phone match stats_rows() on the server', async () => {
    // A contaminated plate, a contaminated-then-retired one, and a clean discarded one (not counted).
    const kids = (await admin.query("select id from items where account_id = $1 and kind = 'transfer' and status = 'active' order by code limit 3", [lab.accountId])).rows.map((r) => r.id);
    must(await lab.client.rpc('set_item_status', { p_item_id: kids[0], p_status: 'contaminated' }));
    must(await lab.client.rpc('set_item_status', { p_item_id: kids[1], p_status: 'contaminated' }));
    must(await lab.client.rpc('set_item_status', { p_item_id: kids[1], p_status: 'discarded' }));
    must(await lab.client.rpc('set_item_status', { p_item_id: kids[2], p_status: 'discarded' }));

    const from = '2000-01-01';
    const server = (must(await lab.client.rpc('stats_rows', { p_from: from, p_to: TODAY })) as Record<string, unknown>[])
      .map((r) => ({ ...r, made_on: String(r.made_on) }));
    const p = await phone();
    const local = await p.q.statsRows(from, TODAY);
    const pick = (r: Record<string, unknown>) =>
      [r.id, r.strain_name, r.kind, r.generation, r.made_on, r.status, r.contaminated, r.batch_code, r.run_code, r.recipe_name];
    expect(server.length).toBeGreaterThan(0);
    expect(local.map(pick)).toEqual(server.map(pick));
    expect(local.find((r) => r.id === kids[1])?.contaminated).toBe(true);
    expect(local.some((r) => r.id === kids[2])).toBe(false);
  });

  it('a backup refreshed offline reaches the server linked to the old backup', async () => {
    // A parent that's still active (earlier tests retire or contaminate some cultures).
    const s1 = (await admin.query("select id from items where account_id = $1 and kind = 'transfer' and status = 'active' and deleted_at is null order by code limit 1", [lab.accountId])).rows[0].id as string;
    must(await lab.client.rpc('create_backups', { p_parent_id: s1, p_count: 1, p_medium: 'slant', p_made_on: TODAY }));
    const p = await phone();
    const old = (await p.q.activeBackups()).find((b) => b.parent_id === s1)!;
    const { ids } = await p.writer.refreshBackup({ backupId: old.id, madeOn: TODAY });
    await p.sync();
    const row = (await admin.query('select code, kind, parent_id, refresh_of from items where id = $1', [ids[0]])).rows[0];
    expect(row).toMatchObject({ kind: 'backup', parent_id: s1, refresh_of: old.id });
    expect((await p.q.activeBackups()).find((b) => b.id === old.id)?.refreshed_by).toMatchObject({ id: ids[0], code: row.code });
  });

  it('a viewer reads the whole lab, and changes from their phone are refused', async () => {
    const viewer = await newUser(env as TestEnv, admin);
    await admin.query("insert into members (account_id, user_id, role, initials) values ($1, $2, 'viewer', 'VI')", [lab.accountId, viewer.id]);
    const p = await phone({ ...lab, ...viewer });
    const s1 = await serverId('S-1');
    expect((await p.q.lookupCode('S-1')).map((r) => r.code)).toContain('S-1');

    await p.writer.addNote(lab.accountId, s1, 'viewer note');
    await p.sync();
    expect((await admin.query("select count(*)::int as n from events where note = 'viewer note'")).rows[0].n).toBe(0);
    const failed = await failedChanges(p.db);
    expect(failed.map((f) => f.summary)).toEqual(['Note on S-1']);
    expect(failed[0].error).toMatch(/row-level security/);
  });

  it('an owner invites a tech, who joins with the code and syncs the lab on their phone', async () => {
    const [invite] = must(await lab.client.rpc('invite_member', { p_account_id: lab.accountId, p_role: 'tech' })) as { code: string }[];
    expect(invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const tech = await newUser(env as TestEnv, admin);
    const joined = must(await tech.client.rpc('accept_invite', { p_code: invite.code.toLowerCase(), p_initials: 'te' }));
    expect(joined).toBe(lab.accountId);

    const p = await phone({ ...lab, ...tech });
    expect((await p.q.lookupCode('S-1')).map((r) => r.code)).toContain('S-1');
    // Techs record work: a note from their phone reaches the server.
    await p.writer.addNote(lab.accountId, await serverId('S-1'), 'from the tech');
    await p.sync();
    expect((await admin.query("select count(*)::int as n from events where note = 'from the tech'")).rows[0].n).toBe(1);

    // The code worked once.
    const again = await (await newUser(env as TestEnv, admin)).client.rpc('accept_invite', { p_code: invite.code, p_initials: 'XX' });
    expect(again.error?.message).toMatch(/isn't valid/);
  });

  it('a shared lineage link works signed out, and shows only the tree', async () => {
    const [link] = must(await lab.client.rpc('create_share_link', { p_strain_id: lab.strainId })) as { token: string }[];
    const visitor = createClient(env!.url, env!.anonKey, { auth: { persistSession: false } });
    const shown = must(await visitor.rpc('shared_lineage', { p_token: link.token })) as { strain: { name: string }; tree: Record<string, unknown>[] };
    expect(shown.strain.name).toBe('Blue Oyster');
    expect(shown.tree.map((r) => r.code)).toContain('S-1');
    expect(Object.keys(shown.tree[0]).sort()).toEqual(['code', 'depth', 'generation', 'kind', 'made_on', 'medium', 'parent_code', 'status']);

    // Signed out, nothing else is readable.
    expect((await visitor.from('items').select('id')).data ?? []).toEqual([]);
    expect((await visitor.from('share_links').select('id')).error).toBeTruthy();
    expect((await visitor.rpc('lookup_code', { p_query: 'S' })).error).toBeTruthy();
    expect((await visitor.rpc('shared_lineage', { p_token: 'not-a-token' })).error?.message).toMatch(/expired or been turned off/);
  });

  it('another lab sees none of this, and its changes into this lab are refused', async () => {
    const other = await newLab(env as TestEnv, admin, 'Other lab');
    const p = await phone(other);
    expect(await p.q.lookupCode('S')).toEqual([]);
    expect(await p.q.listStrains()).toHaveLength(1); // only its own

    const write = createWriteRemote(other.client);
    await expect(
      write.applyItems([
        {
          id: crypto.randomUUID(), account_id: other.accountId, strain_id: other.strainId, parent_id: await serverId('S-1'),
          kind: 'transfer', medium: 'agar', origin_prefix: null, origin_number: null, position: 9, backup_number: null,
          made_on: TODAY, media_batch_id: null, location: null, notes: null, generation: 2, expected_code: 'S-1I',
        },
      ]),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not found|violates/i) });
    await expect(
      write.applyCheck({ id: crypto.randomUUID(), item_id: await serverId('S-1'), checked_on: TODAY, percent: 5, radius_mm: null, note: null }),
    ).rejects.toMatchObject({ message: 'Culture not found' });
    expect(await p.q.itemChecks([await serverId('S-1')])).toEqual([]);
  });

  // The batch and run pages read these on phones from the local copy and on the
  // web from the server (src/lib/api.ts); both must answer the same.
  it("the phone's batch and run page reads answer like the server's", async () => {
    mockServer = lab.client;
    const acct = lab.accountId;
    const yesterday = (() => {
      const d = new Date(Date.now() - 864e5);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();
    const run1 = await api.createRun({ accountId: acct, method: 'autoclave', psi: 15, minutes: 45, runOn: TODAY, notes: 'full load' });
    const run2 = await api.createRun({ accountId: acct, method: 'pressure_cooker', runOn: TODAY });
    const recipe = must(await lab.client.rpc('save_recipe', {
      p_account_id: acct, p_family_id: null, p_name: 'PDA', p_kind: 'agar', p_volume_ml: 500,
      p_ingredients: [{ name: 'Potato', amount: 100, unit: 'g' }],
    })) as { id: string; family_id: string };
    const mb1 = await api.createBatch({ accountId: acct, kind: 'agar', runId: run1.id, recipeId: recipe.id, volumeMl: 250, madeOn: TODAY });
    const mb2 = await api.createBatch({ accountId: acct, kind: 'lc', recipe: 'Honey', runId: run1.id, madeOn: TODAY });
    const gone = await api.createBatch({ accountId: acct, kind: 'agar', runId: run1.id, madeOn: TODAY });
    await admin.query('update media_batches set deleted_at = now() where id = $1', [gone.id]);
    const mb3 = await api.createBatch({ accountId: acct, kind: 'agar', runId: run2.id, madeOn: TODAY });
    const loose = await api.createBatch({ accountId: acct, kind: 'agar', madeOn: TODAY });

    must(await lab.client.from('items').insert({ account_id: acct, strain_id: lab.strainId, kind: 'origin', medium: 'tissue', origin_prefix: 'C' }));
    const c = await serverId('C');
    const transfers = (parent: string, n: number, madeOn: string, batch: string) =>
      lab.client.rpc('create_transfers', { p_parent_id: parent, p_count: n, p_medium: 'agar', p_made_on: madeOn, p_media_batch_id: batch });
    must(await transfers(c, 2, yesterday, mb1.id)); // C-1, C-2
    must(await transfers(c, 1, TODAY, mb2.id)); // C-3
    must(await transfers(c, 1, TODAY, mb3.id)); // C-4: the other run
    must(await transfers(await serverId('C-1'), 2, TODAY, mb1.id)); // C-1A, C-1B
    await admin.query('update items set deleted_at = now() where id = $1', [await serverId('C-1B')]);

    const { q } = await phone();

    const runFields = (r: Awaited<ReturnType<typeof api.getRun>>) => [r.id, r.code, r.method, r.psi, r.minutes, String(r.run_on), r.notes];
    for (const run of [run1, run2]) {
      expect(runFields(await q.getRun(run.id))).toEqual(runFields(await api.getRun(run.id)));
    }
    expect((await api.getRun(run1.id)).code).toMatch(/^SR-\d{3}$/);

    const batchFields = (b: Awaited<ReturnType<typeof api.getBatch>>) => [
      b.id, b.code, b.kind, b.recipe, b.sterilization_run_id, b.recipe_id, b.volume_ml === null ? null : Number(b.volume_ml),
      String(b.made_on), b.sterilization_runs ?? null, b.recipes ?? null,
    ];
    for (const b of [mb1, mb2, mb3, loose]) {
      expect(batchFields(await q.getBatch(b.id))).toEqual(batchFields(await api.getBatch(b.id)));
    }
    expect((await q.getBatch(mb1.id)).recipes).toEqual({ name: 'PDA', version: 1, family_id: recipe.family_id });
    expect((await q.getBatch(loose.id)).sterilization_runs).toBeNull();

    for (const run of [run1, run2]) {
      const server = await api.batchesInRun(run.id);
      expect((await q.batchesInRun(run.id)).map(batchFields)).toEqual(server.map(batchFields));
    }
    expect((await api.batchesInRun(run1.id)).map((b) => b.id)).toEqual([mb1.id, mb2.id]); // by code, removed batch left out

    const itemFields = (i: Awaited<ReturnType<typeof api.itemsOnBatches>>[number]) => [
      i.id, i.code, String(i.made_on), i.status, i.medium, i.strains, i.media_batches,
    ];
    for (const ids of [[mb1.id], [mb1.id, mb2.id], [mb1.id, mb2.id, mb3.id], [loose.id], []]) {
      expect((await q.itemsOnBatches(ids)).map(itemFields)).toEqual((await api.itemsOnBatches(ids)).map(itemFields));
    }
    // Newest first, then by code; the removed C-1B is left out.
    expect((await api.itemsOnBatches([mb1.id, mb2.id])).map((i) => i.code)).toEqual(['C-1A', 'C-3', 'C-1', 'C-2']);
  });

  // Stats reads technique changes on phones from the local copy and on the web
  // from the server (src/lib/api.ts listTechniqueChanges); both must answer the same.
  it("the phone's technique changes answer like the server's, and a viewer can't add one", async () => {
    mockServer = lab.client;
    api.setCurrentLab(lab.accountId);
    const acct = lab.accountId;
    await api.addTechniqueChange({ accountId: acct, changedOn: '2026-10-01', title: '  Started using a flow hood  ', note: 'Laminar flow' });
    await api.addTechniqueChange({ accountId: acct, changedOn: '2026-09-01', title: 'MEA 2%', note: '   ' });
    await api.addTechniqueChange({ accountId: acct, changedOn: '2026-10-01', title: 'Same day, added later' });
    await api.addTechniqueChange({ accountId: acct, changedOn: '2026-08-01', title: 'Typo' });
    const typo = (await admin.query("select id from technique_changes where account_id = $1 and title = 'Typo'", [acct])).rows[0].id as string;
    await api.removeTechniqueChange(typo);
    expect((await admin.query('select deleted_at from technique_changes where id = $1', [typo])).rows[0].deleted_at).not.toBeNull();

    // Another lab's change must not show up in either.
    const other = await newLab(env as TestEnv, admin, 'Other lab');
    must(await other.client.from('technique_changes').insert({ account_id: other.accountId, changed_on: '2026-09-15', title: 'Other lab change' }));

    const server = await api.listTechniqueChanges();
    expect(server.map((c) => [String(c.changed_on), c.title, c.note])).toEqual([
      ['2026-09-01', 'MEA 2%', null],
      ['2026-10-01', 'Started using a flow hood', 'Laminar flow'],
      ['2026-10-01', 'Same day, added later', null],
    ]);
    const p = await phone();
    const fields = (c: Awaited<ReturnType<typeof api.listTechniqueChanges>>[number]) =>
      [c.id, c.account_id, String(c.changed_on), c.title, c.note, Date.parse(c.created_at)];
    expect((await p.q.listTechniqueChanges()).map(fields)).toEqual(server.map(fields));

    // A removal on the web reaches the phone on its next sync.
    await api.removeTechniqueChange(server[0].id);
    await p.sync();
    expect((await p.q.listTechniqueChanges()).map((c) => c.title)).toEqual(['Started using a flow hood', 'Same day, added later']);

    // A viewer reads them but can't add or remove one.
    const viewer = await newUser(env as TestEnv, admin);
    await admin.query("insert into members (account_id, user_id, role, initials) values ($1, $2, 'viewer', 'VW')", [acct, viewer.id]);
    mockServer = viewer.client;
    expect((await api.listTechniqueChanges()).map((c) => c.title)).toEqual(['Started using a flow hood', 'Same day, added later']);
    await expect(api.addTechniqueChange({ accountId: acct, changedOn: '2026-11-01', title: 'Viewer change' })).rejects.toMatchObject({
      message: expect.stringMatching(/row-level security/),
    });
    await api.removeTechniqueChange(server[1].id); // RLS hides the row: nothing changes
    const live = (await admin.query('select title from technique_changes where account_id = $1 and deleted_at is null order by title', [acct])).rows;
    expect(live.map((r) => r.title)).toEqual(['Same day, added later', 'Started using a flow hood']);

    mockServer = lab.client;
    api.setCurrentLab(null);
  });

  // Bug: someone in two labs saw both labs on their phone (and in lists) after
  // switching. RLS allows every lab you belong to; the pull must name the lab.
  // Kept last: it gives this file's user a second lab.
  it('someone in two labs gets only the lab being synced on their phone', async () => {
    const labB = must(await lab.client.rpc('create_account', { p_name: 'Second lab', p_initials: 'KL' })) as string;
    const strainB = crypto.randomUUID();
    must(await lab.client.from('strains').insert({ id: strainB, account_id: labB, name: 'Second Lab Reishi' }));
    const originB = must(await lab.client.from('items').insert({ account_id: labB, strain_id: strainB, kind: 'origin', medium: 'spore_print', origin_prefix: 'S' }).select().single()) as { id: string };
    must(await lab.client.rpc('create_transfers', { p_parent_id: originB.id, p_count: 2, p_medium: 'agar', p_made_on: TODAY }));
    // RLS alone would hand both labs to this user.
    expect((must(await lab.client.from('strains').select('account_id')) as { account_id: string }[]).map((r) => r.account_id)).toEqual(
      expect.arrayContaining([lab.accountId, labB]),
    );

    const a = await phone();
    for (const t of ['strains', 'items', 'events']) {
      const accounts = (await a.db.all<{ account_id: string }>(`select distinct account_id from ${t}`)).map((r) => r.account_id);
      expect([t, accounts]).toEqual([t, [lab.accountId]]);
    }
    expect((await a.q.listStrains()).map((s) => s.name)).not.toContain('Second Lab Reishi');
    expect((await a.q.lookupCode('S')).map((r) => r.strain_name)).not.toContain('Second Lab Reishi');

    const b = await phone({ ...lab, accountId: labB, strainId: strainB });
    expect((await b.q.listStrains()).map((s) => s.name)).toEqual(['Second Lab Reishi']);
    expect((await b.q.lookupCode('S')).map((r) => r.code).sort()).toEqual(['S', 'S-1', 'S-2']);

    // The server functions the web uses answer per lab too.
    const lookup = (acct: string | null) => lab.client.rpc('lookup_code', acct ? { p_query: 'S', p_account_id: acct } : { p_query: 'S' });
    expect((must(await lookup(labB)) as { strain_name: string }[]).every((r) => r.strain_name === 'Second Lab Reishi')).toBe(true);
    expect((must(await lookup(lab.accountId)) as { strain_name: string }[]).every((r) => r.strain_name === 'Blue Oyster')).toBe(true);
    expect(new Set((must(await lookup(null)) as { strain_name: string }[]).map((r) => r.strain_name))).toEqual(
      new Set(['Blue Oyster', 'Second Lab Reishi']),
    );
  });
});
