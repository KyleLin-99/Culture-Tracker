// The built server as Claude runs it (a process over stdio), against a real local
// Supabase, signed in as a test grower. Skips when no local Supabase is running.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { loadTestEnv } from '../../integration/env';
import { adminDb, must, newLab } from '../../integration/supabaseTest';

const env = loadTestEnv();
const server = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function connect(token: string) {
  const client = new Client({ name: 'int-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: { SUPABASE_URL: env!.url, SUPABASE_ANON_KEY: env!.anonKey, CULTURE_TRACKER_ACCESS_TOKEN: token, PATH: process.env.PATH ?? '' },
    }),
  );
  return client;
}
const textOf = (r: { content: unknown }) => (r.content as { text: string }[]).map((c) => c.text).join('\n');

describe('MCP server against a local Supabase', { skip: !env && 'no local Supabase (npx supabase start)' }, () => {
  let admin: Awaited<ReturnType<typeof adminDb>>;
  let lab: Awaited<ReturnType<typeof newLab>>;
  let client: Client;

  before(async () => {
    admin = await adminDb(env!);
    lab = await newLab(env!, admin, 'MCP lab');
    const db = lab.client;
    must(await db.from('items').insert({ account_id: lab.accountId, strain_id: lab.strainId, kind: 'origin', medium: 'spore_print', origin_prefix: 'S' }));
    const origin = must(await db.from('items').select('id').eq('code', 'S').single()) as { id: string };
    must(await db.rpc('create_transfers', { p_parent_id: origin.id, p_count: 2, p_medium: 'agar' }));
    client = await connect(lab.token);
  });
  after(async () => {
    await client?.close();
    await admin?.end();
  });

  it('answers lineage questions from the grower\'s lab', async () => {
    const r = await client.callTool({ name: 'culture_lineage', arguments: { code: 's-2' } });
    assert.equal(r.isError, undefined);
    assert.match(textOf(r), /^S-2 \(Blue Oyster\):\nS · spore_print · active · .*\n {2}S-2 · agar · active · .* ←$/);
  });

  it('draws the strain tree and finds cultures', async () => {
    assert.match(textOf(await client.callTool({ name: 'strain_tree', arguments: { strain: 'Blue Oyster' } })), /S-1 · agar[\s\S]*S-2 · agar/);
    assert.match(textOf(await client.callTool({ name: 'find_culture', arguments: { code: 'S-' } })), /S-1 \(Blue Oyster\)/);
  });

  it('runs stats, trace and backups due without errors', async () => {
    for (const name of ['lab_stats', 'contamination_trace', 'backups_due']) {
      const r = await client.callTool({ name, arguments: {} });
      assert.equal(r.isError, undefined, `${name}: ${textOf(r)}`);
    }
    assert.match(textOf(await client.callTool({ name: 'lab_stats', arguments: {} })), /0 of 2 plates contaminated/);
  });

  it('shows another grower nothing from this lab', async () => {
    const other = await newLab(env!, admin, 'Other lab');
    const theirs = await connect(other.token);
    const r = await theirs.callTool({ name: 'culture_lineage', arguments: { code: 'S-2' } });
    await theirs.close();
    assert.deepEqual([r.isError, textOf(r)], [true, 'No culture with code S-2.']);
  });
});
