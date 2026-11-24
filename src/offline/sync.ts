import { clearAll, getMeta, setMeta } from './schema';
import type { SqlDb, SqlParam } from './sql';
import { PENDING_TABLES, PULL_ORDER, type RemoteRow, TABLES, type TableName } from './tables';

/** Where pulled rows come from: Supabase in the app (remote.ts), a fake in tests. */
export interface RemoteSource {
  /**
   * Rows changed after `since` (every row when null), ordered by updated_at then id.
   * `historyFrom` (first pull only) limits items to active ones plus those made on or
   * after that date, and events to those on or after it.
   */
  changed(
    table: TableName,
    opts: { accountId: string; since: string | null; historyFrom: string | null; offset: number; limit: number },
  ): Promise<RemoteRow[]>;
  /** Specific rows, e.g. the older ancestors of an active culture. */
  byIds(table: TableName, ids: string[]): Promise<RemoteRow[]>;
}

export type PullResult = { rows: number; ancestors: number };

/**
 * Re-pull changes this far back each time. A row written in a transaction that
 * started before the last pull but committed after it carries an older
 * updated_at; the overlap catches it. Upserts make re-pulling harmless.
 */
export const OVERLAP_MS = 5 * 60 * 1000;
const PAGE_SIZE = 500;

function toSql(v: unknown): SqlParam {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return JSON.stringify(v); // arrays (aliases) and anything structured
}

function upsertSql(t: TableName, force: boolean): string {
  const cols = TABLES[t];
  const pending = PENDING_TABLES.includes(t);
  const set = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  if (pending) set.push('local_pending = 0');
  // A pull never overwrites a change still waiting to be sent from this phone.
  const guard = pending && !force ? ` where ${t}.local_pending = 0` : '';
  return `insert into ${t} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')}) on conflict (id) do update set ${set.join(', ')}${guard}`;
}

/**
 * Writes server rows into the local copy, replacing older versions. `force`
 * (used when the server confirms this phone's own change) also replaces rows
 * that are waiting to be sent.
 */
export async function upsertRows(db: SqlDb, table: TableName, rows: RemoteRow[], force = false): Promise<void> {
  if (!rows.length) return;
  const sql = upsertSql(table, force);
  await db.transaction(async () => {
    for (const row of rows) {
      await db.run(sql, TABLES[table].map((c) => toSql(row[c])));
    }
  });
}

function since(pulledUntil: string | null): string | null {
  if (!pulledUntil) return null;
  return new Date(new Date(pulledUntil).getTime() - OVERLAP_MS).toISOString();
}

/**
 * Brings the local copy up to date: every changed row per table, then any
 * ancestors of local cultures that the history window left out, so lineage is
 * always complete offline. Switching labs clears the copy first.
 */
export async function pull(
  db: SqlDb,
  remote: RemoteSource,
  opts: { accountId: string; historyFrom: string; now?: () => Date },
): Promise<PullResult> {
  const owner = await getMeta(db, 'account_id');
  if (owner && owner !== opts.accountId) await clearAll(db);
  await setMeta(db, 'account_id', opts.accountId);

  // The history window applies to the very first pull only; after that every change comes down.
  const firstPull = (await getMeta(db, 'first_pull_done')) === null;

  let total = 0;
  for (const table of PULL_ORDER) {
    const key = `pulled_until_${table}`;
    const pulledUntil = await getMeta(db, key);
    const windowed = firstPull && (table === 'items' || table === 'events');
    let newest = pulledUntil;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const rows = await remote.changed(table, {
        accountId: opts.accountId,
        since: since(pulledUntil),
        historyFrom: windowed ? opts.historyFrom : null,
        offset,
        limit: PAGE_SIZE,
      });
      await upsertRows(db, table, rows);
      total += rows.length;
      for (const r of rows) if (!newest || r.updated_at > newest) newest = r.updated_at;
      if (rows.length < PAGE_SIZE) break;
    }
    if (newest) await setMeta(db, key, newest);
  }

  let ancestors = 0;
  for (let round = 0; round < 100; round += 1) {
    const missing = await db.all<{ id: string }>(
      `select distinct parent_id as id from items
       where parent_id is not null and parent_id not in (select id from items)`,
    );
    if (!missing.length) break;
    const rows = await remote.byIds('items', missing.map((m) => m.id));
    if (!rows.length) break;
    await upsertRows(db, 'items', rows);
    ancestors += rows.length;
  }

  await setMeta(db, 'first_pull_done', '1');
  await setMeta(db, 'last_synced_at', (opts.now?.() ?? new Date()).toISOString());
  return { rows: total, ancestors };
}
