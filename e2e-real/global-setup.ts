// Seeds two labs in the local test Supabase and saves what the tests need.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadTestEnv } from '../integration/env';
import { adminDb, localToday, must, newLab } from '../integration/supabaseTest';

export const SEED_FILE = join(__dirname, '.seed.json');

export default async function globalSetup() {
  const env = loadTestEnv();
  if (!env) throw new Error('Local Supabase not found. Start it with: npx supabase start');
  const admin = await adminDb(env);
  try {
    const lab = await newLab(env, admin, "Kyle's Lab");
    const c = lab.client;
    const today = localToday(); // the app compares against the local date, as in the lab
    const id = async (code: string) =>
      (await admin.query('select id from items where code = $1 and account_id = $2', [code, lab.accountId])).rows[0].id as string;

    const origin = must(
      await c.from('items').insert({ account_id: lab.accountId, strain_id: lab.strainId, kind: 'origin', medium: 'spore_print', origin_prefix: 'S' }).select().single(),
    ) as { id: string };
    must(await c.rpc('create_transfers', { p_parent_id: origin.id, p_count: 3, p_medium: 'agar', p_made_on: today }));
    must(await c.rpc('create_transfers', { p_parent_id: await id('S-2'), p_count: 2, p_medium: 'agar', p_made_on: today }));
    must(await c.rpc('create_transfers', { p_parent_id: await id('S-3'), p_count: 1, p_medium: 'agar', p_made_on: today }));

    // Two runs and batches; 6 plates on each batch from S-1; 5 of the MB-002 plates contaminate.
    const runs = must(await c.from('sterilization_runs').insert([
      { account_id: lab.accountId, method: 'pressure_cooker', psi: 15, minutes: 90 },
      { account_id: lab.accountId, method: 'pressure_cooker', psi: 15, minutes: 45 },
    ]).select()) as { id: string; code: string }[];
    const run = (code: string) => runs.find((r) => r.code === code)!.id;
    const mb1 = must(await c.from('media_batches').insert({ account_id: lab.accountId, kind: 'agar', recipe: 'MEA', sterilization_run_id: run('SR-001') }).select().single()) as { id: string };
    const mb2 = must(await c.from('media_batches').insert({ account_id: lab.accountId, kind: 'agar', recipe: 'MEA', sterilization_run_id: run('SR-002') }).select().single()) as { id: string };
    must(await c.rpc('create_transfers', { p_parent_id: await id('S-1'), p_count: 6, p_medium: 'agar', p_made_on: today, p_media_batch_id: mb1.id }));
    must(await c.rpc('create_transfers', { p_parent_id: await id('S-1'), p_count: 6, p_medium: 'agar', p_made_on: today, p_media_batch_id: mb2.id }));
    for (const code of ['S-1G', 'S-1H', 'S-1I', 'S-1J', 'S-1K']) {
      must(await c.rpc('set_item_status', { p_item_id: await id(code), p_status: 'contaminated', p_contam_type: 'trich' }));
    }

    // A plate to relabel after an (imagined) offline conflict.
    await admin.query(
      'insert into relabels (account_id, entity_id, old_code, new_code) values ($1, $2, $3, $4)',
      [lab.accountId, await id('S-2B'), 'S-2Q', 'S-2B'],
    );

    // A second lab, which must stay invisible.
    const other = await newLab(env, admin, 'Other lab');
    must(await other.client.from('items').insert({ account_id: other.accountId, strain_id: other.strainId, kind: 'origin', medium: 'tissue', origin_prefix: 'ZZ' }));

    writeFileSync(
      SEED_FILE,
      JSON.stringify({
        url: env.url,
        token: lab.token,
        userId: lab.id,
        accountId: lab.accountId,
        ids: { S: origin.id, 'S-1': await id('S-1'), 'S-2': await id('S-2'), 'S-2A': await id('S-2A'), 'S-3': await id('S-3') },
      }),
    );
  } finally {
    await admin.end();
  }
}
