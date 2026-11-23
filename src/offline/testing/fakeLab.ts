// A small lab built with the real culture-code rules, plus a fake Supabase that
// serves it the way the RemoteSource contract says. Used by the offline tests.

import { positionLetters } from '@/domain/cultureCode';

import type { RemoteSource } from '../sync';
import type { RemoteRow, TableName } from '../tables';

export const ACCOUNT = 'acct-1';
export const STRAIN = 'strain-1';

let clock = Date.parse('2026-11-01T12:00:00Z');
/** A strictly increasing server timestamp, like updated_at. */
export function tick(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

export type FakeLab = Record<TableName, RemoteRow[]>;

export function emptyLab(): FakeLab {
  return { strains: [], sterilization_runs: [], media_batches: [], items: [], events: [] };
}

type ItemOpts = { status?: string; madeOn?: string; mediaBatchId?: string | null; strainId?: string };

/** Adds items to a lab, computing codes the way the database trigger does. */
export function builder(lab: FakeLab) {
  const byCode = new Map<string, RemoteRow>();
  const add = (row: Partial<RemoteRow> & { code: string; kind: string }, opts: ItemOpts = {}) => {
    const now = tick();
    const full: RemoteRow = {
      id: `id-${row.code}`,
      account_id: ACCOUNT,
      strain_id: opts.strainId ?? STRAIN,
      parent_id: null,
      medium: 'agar',
      origin_prefix: null,
      origin_number: null,
      position: null,
      backup_number: null,
      generation: 0,
      status: opts.status ?? 'active',
      location: null,
      media_batch_id: opts.mediaBatchId ?? null,
      made_on: opts.madeOn ?? '2026-11-20',
      initials: 'KL',
      notes: null,
      aliases: [],
      created_at: now,
      updated_at: now,
      deleted_at: null,
      ...row,
    };
    lab.items.push(full);
    byCode.set(full.code as string, full);
    return full;
  };

  const children = (parent: RemoteRow, kind: string) =>
    lab.items.filter((i) => i.parent_id === parent.id && i.kind === kind).length;

  return {
    origin(prefix: string, number: number | null = null, opts: ItemOpts = {}) {
      return add({ code: `${prefix}${number ?? ''}`, kind: 'origin', origin_prefix: prefix, origin_number: number, medium: 'spore_print' }, opts);
    },
    transfer(parentCode: string, opts: ItemOpts = {}) {
      const parent = byCode.get(parentCode)!;
      const position = children(parent, 'transfer') + 1;
      const pcode = parent.code as string;
      const code =
        parent.kind === 'transfer'
          ? /[0-9]$/.test(pcode) ? pcode + positionLetters(position) : pcode + position
          : `${pcode}-${position}`;
      return add({ code, kind: 'transfer', parent_id: parent.id, position, generation: (parent.generation as number) + 1 }, opts);
    },
    backup(parentCode: string, opts: ItemOpts = {}) {
      const parent = byCode.get(parentCode)!;
      const n = children(parent, 'backup') + 1;
      return add({ code: `${parent.code}(${n})`, kind: 'backup', parent_id: parent.id, backup_number: n, generation: parent.generation }, opts);
    },
    get: (code: string) => byCode.get(code)!,
  };
}

/** The lineage the database tests build (supabase/tests/database/01_culture_codes.test.sql). */
export function standardLab(): FakeLab {
  const lab = emptyLab();
  lab.strains.push({ id: STRAIN, account_id: ACCOUNT, name: 'Blue Oyster', species: 'Pleurotus ostreatus', notes: null, created_at: tick(), updated_at: tick(), deleted_at: null });
  const b = builder(lab);
  b.origin('S');
  b.origin('S', 2);
  ['S', 'S', 'S'].forEach((p) => b.transfer(p)); // S-1, S-2, S-3
  b.transfer('S-2'); // S-2A
  b.transfer('S-2'); // S-2B
  b.transfer('S-2A'); // S-2A1
  b.transfer('S-2A1'); // S-2A1A
  b.transfer('S-2A1'); // S-2A1B
  b.transfer('S-2'); // S-2C
  b.backup('S-2A1'); // S-2A1(1)
  b.backup('S-2A1'); // S-2A1(2)
  b.transfer('S-2A1(2)'); // S-2A1(2)-1
  b.transfer('S-2A1(2)'); // S-2A1(2)-2
  b.transfer('S-2A1(2)-1'); // S-2A1(2)-1A
  for (let i = 0; i < 10; i += 1) b.transfer('S2'); // S2-1 .. S2-10
  return lab;
}

/** Serves a FakeLab like Supabase would, and records every request. */
export function fakeRemote(lab: FakeLab) {
  const calls: { table: TableName; since: string | null; historyFrom: string | null; offset: number }[] = [];
  const remote: RemoteSource = {
    async changed(table, { since, historyFrom, offset, limit }) {
      calls.push({ table, since, historyFrom, offset });
      return lab[table]
        .filter((r) => !since || r.updated_at > since)
        .filter((r) => {
          if (!historyFrom) return true;
          if (table === 'items') return r.status === 'active' || (r.made_on as string) >= historyFrom;
          if (table === 'events') return (r.occurred_at as string) >= historyFrom;
          return true;
        })
        .sort((a, b) => (a.updated_at === b.updated_at ? a.id.localeCompare(b.id) : a.updated_at < b.updated_at ? -1 : 1))
        .slice(offset, offset + limit)
        .map((r) => ({ ...r }));
    },
    async byIds(table, ids) {
      return lab[table].filter((r) => ids.includes(r.id)).map((r) => ({ ...r }));
    },
  };
  return { remote, calls };
}
