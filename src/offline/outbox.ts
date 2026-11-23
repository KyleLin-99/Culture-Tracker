// The queue of changes made on the phone, sent to Supabase in order.
//
// Decisions (docs/design/offline-mode.md):
//   * no connection -> stop and keep everything queued
//   * the server rejects a change -> undo it on the phone, undo anything that
//     depends on it, and keep it as "failed" with the reason until dismissed

import type { PlannedItem } from './planner';
import type { SqlDb } from './sql';
import { isNetworkError } from './status';
import { upsertRows } from './sync';
import type { RemoteRow } from './tables';

export type LocalEvent = {
  id: string;
  item_id: string;
  type: string;
  note: string | null;
  contam_type: string | null;
  occurred_at: string;
};

export type OutboxOp =
  | { op: 'items'; summary: string; items: PlannedItem[]; event: LocalEvent | null }
  | {
      op: 'status';
      summary: string;
      event_id: string;
      item_id: string;
      status: string;
      note: string | null;
      contam_type: string | null;
      occurred_at: string;
      prev_status: string;
    }
  | { op: 'event'; summary: string; event: LocalEvent }
  | { op: 'strain'; summary: string; strain: { id: string; account_id: string; name: string; species: string | null } }
  | { op: 'resolve_relabel'; summary: string; id: string; resolved_at: string };

/** How queued changes reach the server: Supabase in the app (remoteWrite.ts), a fake in tests. */
export interface WriteRemote {
  applyItems(items: PlannedItem[]): Promise<RemoteRow[]>;
  applyEvent(event: LocalEvent): Promise<RemoteRow>;
  applyStatus(op: Extract<OutboxOp, { op: 'status' }>): Promise<RemoteRow>;
  insertStrain(strain: Extract<OutboxOp, { op: 'strain' }>['strain']): Promise<RemoteRow | null>;
  resolveRelabel(id: string, resolvedAt: string): Promise<RemoteRow | null>;
}

type OutboxRow = { seq: number; op: string; payload: string; status: string; error: string | null; created_at: string };

export type FailedChange = { seq: number; summary: string; error: string; created_at: string };

export async function enqueue(db: SqlDb, op: OutboxOp, now: string): Promise<void> {
  const { op: name, ...payload } = op;
  await db.run('insert into outbox (op, payload, created_at) values (?, ?, ?)', [name, JSON.stringify(payload), now]);
}

function parse(row: OutboxRow): OutboxOp {
  return { op: row.op, ...JSON.parse(row.payload) } as OutboxOp;
}

export async function pendingCount(db: SqlDb): Promise<number> {
  return (await db.first<{ n: number }>("select count(*) as n from outbox where status = 'pending'"))?.n ?? 0;
}

export async function failedChanges(db: SqlDb): Promise<FailedChange[]> {
  const rows = await db.all<OutboxRow>("select * from outbox where status = 'failed' order by seq");
  return rows.map((r) => ({ seq: r.seq, summary: parse(r).summary, error: r.error ?? '', created_at: r.created_at }));
}

export async function dismissFailed(db: SqlDb, seq: number): Promise<void> {
  await db.run("delete from outbox where seq = ? and status = 'failed'", [seq]);
}

async function send(db: SqlDb, remote: WriteRemote, op: OutboxOp): Promise<void> {
  switch (op.op) {
    case 'items': {
      const rows = await remote.applyItems(op.items);
      await upsertRows(db, 'items', rows, true); // final codes from the server
      if (op.event) await upsertRows(db, 'events', [await remote.applyEvent(op.event)], true);
      return;
    }
    case 'status': {
      await upsertRows(db, 'items', [await remote.applyStatus(op)], true);
      await db.run('update events set local_pending = 0 where id = ?', [op.event_id]);
      return;
    }
    case 'event':
      await upsertRows(db, 'events', [await remote.applyEvent(op.event)], true);
      return;
    case 'strain': {
      const row = await remote.insertStrain(op.strain);
      if (row) await upsertRows(db, 'strains', [row], true);
      else await db.run('update strains set local_pending = 0 where id = ?', [op.strain.id]);
      return;
    }
    case 'resolve_relabel': {
      const row = await remote.resolveRelabel(op.id, op.resolved_at);
      if (row) await upsertRows(db, 'relabels', [row], true);
      return;
    }
  }
}

/** Ids of rows this change created on the phone (what later changes may depend on). */
function createdIds(op: OutboxOp): string[] {
  switch (op.op) {
    case 'items':
      return [...op.items.map((i) => i.id), ...(op.event ? [op.event.id] : [])];
    case 'strain':
      return [op.strain.id];
    case 'event':
      return [op.event.id];
    default:
      return [];
  }
}

function dependsOn(op: OutboxOp, ids: Set<string>): boolean {
  switch (op.op) {
    case 'items':
      return op.items.some((i) => (i.parent_id && ids.has(i.parent_id)) || ids.has(i.strain_id));
    case 'status':
      return ids.has(op.item_id);
    case 'event':
      return ids.has(op.event.item_id);
    default:
      return false;
  }
}

/** Puts the phone's copy back as it was before this change. */
async function undo(db: SqlDb, op: OutboxOp): Promise<void> {
  switch (op.op) {
    case 'items': {
      const ids = op.items.map((i) => i.id);
      if (op.event) await db.run('delete from events where id = ? and local_pending = 1', [op.event.id]);
      // Children before parents, so nothing points at a deleted row.
      for (const id of [...ids].reverse()) {
        await db.run('delete from events where item_id = ? and local_pending = 1', [id]);
        await db.run('delete from items where id = ? and local_pending = 1', [id]);
      }
      return;
    }
    case 'status':
      await db.run('update items set status = ?, local_pending = 0 where id = ?', [op.prev_status, op.item_id]);
      await db.run('delete from events where id = ? and local_pending = 1', [op.event_id]);
      return;
    case 'event':
      await db.run('delete from events where id = ? and local_pending = 1', [op.event.id]);
      return;
    case 'strain':
      await db.run('delete from strains where id = ? and local_pending = 1', [op.strain.id]);
      return;
    case 'resolve_relabel':
      await db.run('update relabels set resolved_at = null, local_pending = 0 where id = ?', [op.id]);
      return;
  }
}

/** Undoes a change and anything built on it; returns how many changes failed. */
async function fail(db: SqlDb, row: OutboxRow, reason: string): Promise<number> {
  const op = parse(row);
  await db.transaction(async () => {
    await undo(db, op);
    await db.run("update outbox set status = 'failed', error = ? where seq = ?", [reason, row.seq]);
  });

  // Anything queued later that builds on what was just undone fails with it.
  let failed = 1;
  const removed = new Set(createdIds(op));
  if (!removed.size) return failed;
  const later = await db.all<OutboxRow>("select * from outbox where status = 'pending' and seq > ? order by seq", [row.seq]);
  for (const next of later) {
    if (dependsOn(parse(next), removed)) {
      failed += await fail(db, next, `Depends on a change that couldn't be saved (${op.summary})`);
    }
  }
  return failed;
}

export type FlushResult = { sent: number; failed: number; offline: boolean };

/** Sends queued changes in order until done, or until the connection drops. */
export async function flush(db: SqlDb, remote: WriteRemote): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, offline: false };
  const queued = await db.all<{ seq: number }>("select seq from outbox where status = 'pending' order by seq");
  for (const { seq } of queued) {
    const row = await db.first<OutboxRow>("select * from outbox where seq = ? and status = 'pending'", [seq]);
    if (!row) continue; // failed along with something it depended on
    try {
      await send(db, remote, parse(row));
      await db.run('delete from outbox where seq = ?', [seq]);
      result.sent += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        await db.run('update outbox set attempts = attempts + 1 where seq = ?', [seq]);
        result.offline = true;
        return result;
      }
      const reason = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      result.failed += await fail(db, row, reason);
    }
  }
  return result;
}
