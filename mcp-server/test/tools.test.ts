// Drives the server through a real MCP client (in-memory transport) against a fake lab.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';

import type { Lab, LookupRow, TreeRow } from '../src/lab';
import { createLabServer, localDate, renderTree } from '../src/tools';

const TODAY = '2026-11-24';
const look = (o: Partial<LookupRow>): LookupRow => ({
  id: 'x', code: 'X', strain_id: 'bo', strain_name: 'Blue Oyster', medium: 'agar', status: 'active',
  made_on: '2026-11-01', initials: 'KL', exact: true, ...o,
});
const tree = (id: string, code: string, depth: number, parent: string | null = null): TreeRow => ({
  id, parent_id: parent, code, kind: 'transfer', medium: 'agar', status: 'active', generation: depth + 1, made_on: '2026-11-01', depth,
});

let calls: { fn: string; args: unknown[] }[];
let lab: Lab;

function fakeLab(over: Partial<Lab> = {}): Lab {
  const record = <T>(fn: string, value: T) => async (...args: unknown[]) => {
    calls.push({ fn, args });
    return value;
  };
  return {
    lookupCode: record('lookupCode', [look({ id: 's2a', code: 'S-2A' }), look({ id: 's2a1', code: 'S-2A1', exact: false })]),
    itemLineage: record('itemLineage', [tree('s', 'S', -2), tree('s2', 'S-2', -1, 's'), tree('s2a', 'S-2A', 0, 's2'), tree('s2a1', 'S-2A1', 1, 's2a')]),
    strains: record('strains', [{ id: 'bo', name: 'Blue Oyster', species: null }]),
    strainTree: record('strainTree', [tree('s', 'S', 0), tree('s2', 'S-2', 1, 's')]),
    trace: record('trace', [
      { factor: 'sterilization_run', label: 'SR-007', contaminated_with: 4, clean_with: 1, contaminated_total: 5, clean_total: 12, rate_with: 0.8, rate_without: 0.08, relative_risk: 10, p_value: 0.004 },
      { factor: 'parent', label: 'S-2', contaminated_with: 2, clean_with: 5, contaminated_total: 5, clean_total: 12, rate_with: 0.29, rate_without: 0.3, relative_risk: 0.95, p_value: 0.62 },
    ]),
    statsRows: record('statsRows', [
      { id: 'p1', strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1, made_on: '2026-11-01', status: 'active', contaminated: true, batch_id: 'b', batch_code: 'MB-001', run_id: 'r', run_code: 'SR-001', recipe_family: 'f', recipe_name: 'MEA 2%' },
      { id: 'p2', strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1, made_on: '2026-11-01', status: 'active', contaminated: false, batch_id: null, batch_code: null, run_id: null, run_code: null, recipe_family: null, recipe_name: null },
    ]),
    checks: record('checks', [{ item_id: 'p2', checked_on: '2026-11-05', percent: null, radius_mm: 12 }]),
    activeBackups: record('activeBackups', [
      { id: 'b1', code: 'S-2(1)', medium: 'slant', made_on: '2026-05-01', strains: { name: 'Blue Oyster' } },
      { id: 'b2', code: 'S-2(2)', medium: 'agar', made_on: '2026-11-20', strains: { name: 'Blue Oyster' } },
    ]),
    backupRefreshSettings: record('backupRefreshSettings', null),
    ...over,
  };
}

async function connect(l: Lab) {
  const server = createLabServer(l, () => TODAY);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
  return client;
}

const call = async (l: Lab, name: string, args: Record<string, unknown> = {}) => {
  const client = await connect(l);
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return { text: (r.content as { text: string }[]).map((c) => c.text).join('\n'), isError: !!r.isError, data: r.structuredContent as Record<string, unknown> | undefined };
};

beforeEach(() => {
  calls = [];
  lab = fakeLab();
});

describe('tool list', () => {
  it('offers six tools, all marked read-only', async () => {
    const client = await connect(lab);
    const { tools } = await client.listTools();
    await client.close();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['backups_due', 'contamination_trace', 'culture_lineage', 'find_culture', 'lab_stats', 'strain_tree']);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });
});

describe('find_culture', () => {
  it('normalizes the code and lists matches', async () => {
    const r = await call(lab, 'find_culture', { code: ' s-2a ' });
    assert.deepEqual(calls[0], { fn: 'lookupCode', args: ['S-2A'] });
    assert.match(r.text, /^S-2A \(Blue Oyster\) · agar · active · made 2026-11-01 by KL$/m);
    assert.match(r.text, /^S-2A1 .*\[starts with\]$/m);
  });
});

describe('culture_lineage', () => {
  it('draws the tree from the oldest ancestor and marks the culture', async () => {
    const r = await call(lab, 'culture_lineage', { code: 'S-2A' });
    assert.deepEqual(calls[1], { fn: 'itemLineage', args: ['s2a', 'both'] });
    assert.equal(r.text, 'S-2A (Blue Oyster):\nS · agar · active · 2026-11-01\n  S-2 · agar · active · 2026-11-01\n    S-2A · agar · active · 2026-11-01 ←\n      S-2A1 · agar · active · 2026-11-01');
  });

  it('asks which strain when a code is in two', async () => {
    const two = fakeLab({ lookupCode: async () => [look({ id: 'a', code: 'S', strain_name: 'Blue Oyster' }), look({ id: 'b', code: 'S', strain_name: 'King' })] });
    const r = await call(two, 'culture_lineage', { code: 'S' });
    assert.equal(r.isError, true);
    assert.equal(r.text, 'S is in more than one strain (Blue Oyster, King). Say which strain.');
    const ok = await call(two, 'culture_lineage', { code: 'S', strain: 'king' });
    assert.equal(ok.isError, false);
  });

  it('says when there is no such culture', async () => {
    const r = await call(fakeLab({ lookupCode: async () => [] }), 'culture_lineage', { code: 'Z-9' });
    assert.deepEqual([r.isError, r.text], [true, 'No culture with code Z-9.']);
  });
});

describe('strain_tree', () => {
  it('finds the strain by name, any case', async () => {
    const r = await call(lab, 'strain_tree', { strain: 'blue oyster' });
    assert.equal(r.text, 'Blue Oyster:\nS · agar · active · 2026-11-01\n  S-2 · agar · active · 2026-11-01');
  });

  it('lists the strains when the name is unknown', async () => {
    const r = await call(lab, 'strain_tree', { strain: 'Lions Mane' });
    assert.deepEqual([r.isError, r.text], [true, 'No strain called Lions Mane. Strains: Blue Oyster.']);
  });
});

describe('contamination_trace', () => {
  it('asks for the right window and explains the strongest causes', async () => {
    const r = await call(lab, 'contamination_trace', { days: 30 });
    assert.deepEqual(calls[0], { fn: 'trace', args: ['2026-10-25', TODAY, null] });
    assert.match(r.text, /sterilization_run SR-007: 4 of 5 contaminated plates vs 1 of 12 clean; relative risk 10, p = 0\.004 \(unlikely to be chance\)/);
    assert.doesNotMatch(r.text.split('\n')[2], /unlikely/);
  });

  it('limits to a strain', async () => {
    await call(lab, 'contamination_trace', { strain: 'Blue Oyster' });
    assert.deepEqual(calls.at(-1), { fn: 'trace', args: ['2026-09-25', TODAY, 'bo'] });
  });
});

describe('lab_stats', () => {
  it('summarises contamination by the chosen group and growth by strain', async () => {
    const r = await call(lab, 'lab_stats', { days: 30, group_by: 'recipe' });
    assert.equal(
      r.text,
      'Last 30 days: 1 of 2 plates contaminated (50%).\nBy recipe:\n  MEA 2%: 1 of 1 (100%)\n  Not recorded: 0 of 1 (0%)\nGrowth by strain:\n  Blue Oyster: 3 mm/day (1 culture)',
    );
    assert.deepEqual(calls.find((c) => c.fn === 'checks')?.args, [['p1', 'p2']]);
  });

  it('rejects an unknown grouping', async () => {
    const r = await call(lab, 'lab_stats', { group_by: 'moon phase' });
    assert.equal(r.isError, true);
  });
});

describe('backups_due', () => {
  it("uses the lab's refresh ages (defaults when unset)", async () => {
    const r = await call(lab, 'backups_due');
    assert.equal(r.text, 'S-2(1) (Blue Oyster): 27 days overdue, slant made 2026-05-01');
  });

  it('says when nothing is due', async () => {
    const r = await call(fakeLab({ backupRefreshSettings: async () => ({ slant: 365 }) }), 'backups_due');
    assert.equal(r.text, 'No backups due in the next 14 days.');
  });
});

describe('helpers', () => {
  it('counts days back in local time', () => {
    assert.equal(localDate(30, new Date('2026-11-24T12:00:00')), '2026-10-25');
    assert.equal(localDate(0, new Date('2026-03-01T12:00:00')), '2026-03-01');
  });

  it('indents a tree that starts at depth 0', () => {
    assert.equal(renderTree([tree('a', 'A', 0), tree('b', 'A-1', 1)]), 'A · agar · active · 2026-11-01\n  A-1 · agar · active · 2026-11-01');
  });
});
