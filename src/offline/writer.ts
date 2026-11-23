// Changes made on the phone: applied to the local copy straight away (so the
// screen shows them, signal or not) and queued for the server.

import type { Item, Medium } from '@/domain/types';

import { enqueue, type LocalEvent } from './outbox';
import { planBackups, planOrigin, planTransfers, type PlannedItem } from './planner';
import type { SqlDb } from './sql';

const ITEM_COLS = [
  'id', 'account_id', 'strain_id', 'parent_id', 'kind', 'medium', 'origin_prefix', 'origin_number', 'position',
  'backup_number', 'code', 'generation', 'status', 'location', 'media_batch_id', 'made_on', 'initials', 'notes',
  'aliases', 'created_at', 'updated_at', 'local_pending',
] as const;

export type WriterDeps = {
  db: SqlDb;
  newId: () => string;
  /** ISO time now. */
  now: () => string;
  /** The signed-in member's initials, for labels made on this phone. */
  initials: string;
};

async function insertPlanned(deps: WriterDeps, items: PlannedItem[]): Promise<void> {
  const at = deps.now();
  for (const p of items) {
    const row: Record<(typeof ITEM_COLS)[number], string | number | null> = {
      id: p.id, account_id: p.account_id, strain_id: p.strain_id, parent_id: p.parent_id, kind: p.kind,
      medium: p.medium, origin_prefix: p.origin_prefix, origin_number: p.origin_number, position: p.position,
      backup_number: p.backup_number, code: p.expected_code, generation: p.generation, status: 'active',
      location: p.location, media_batch_id: p.media_batch_id, made_on: p.made_on, initials: deps.initials,
      notes: p.notes, aliases: '[]', created_at: at, updated_at: at, local_pending: 1,
    };
    await deps.db.run(
      `insert into items (${ITEM_COLS.join(', ')}) values (${ITEM_COLS.map(() => '?').join(', ')})`,
      ITEM_COLS.map((c) => row[c]),
    );
  }
}

async function insertEvent(deps: WriterDeps, accountId: string, e: LocalEvent): Promise<void> {
  await deps.db.run(
    `insert into events (id, account_id, item_id, type, occurred_at, note, contam_type, created_at, updated_at, local_pending)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [e.id, accountId, e.item_id, e.type, e.occurred_at, e.note, e.contam_type, e.occurred_at, e.occurred_at],
  );
}

async function readItems(db: SqlDb, ids: string[]): Promise<Item[]> {
  const rows = await db.all<Item & { position: number | null; backup_number: number | null }>(
    `select * from items where id in (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** "S-2A … S-2C", or the one code. */
const span = (items: PlannedItem[]) =>
  items.length === 1 ? items[0].expected_code : `${items[0].expected_code} … ${items.at(-1)!.expected_code}`;

export function localWriter(deps: WriterDeps) {
  const { db } = deps;

  async function itemsWithEvent(items: PlannedItem[], eventType: 'transferred' | 'backed_up' | null, note: string, summary: string) {
    const at = deps.now();
    const event: LocalEvent | null =
      eventType && items[0].parent_id
        ? { id: deps.newId(), item_id: items[0].parent_id, type: eventType, note, contam_type: null, occurred_at: at }
        : null;
    await db.transaction(async () => {
      await insertPlanned(deps, items);
      if (event) await insertEvent(deps, items[0].account_id, event);
      await enqueue(db, { op: 'items', summary, items, event }, at);
    });
    return { ids: items.map((i) => i.id) };
  }

  return {
    /** Returns the new ids; read them back after a sync attempt for their final codes. */
    async createTransfers(args: { parentId: string; count: number; medium: Medium; madeOn: string; mediaBatchId?: string | null; location?: string | null }) {
      const items = await planTransfers(db, deps.newId, args);
      const parent = await db.first<{ code: string }>('select code from items where id = ?', [args.parentId]);
      // Same wording as create_transfers() on the server.
      const note = `${args.count} × ${args.medium}: ${span(items)}`;
      return itemsWithEvent(items, 'transferred', note, `${args.count} transfer${args.count === 1 ? '' : 's'} from ${parent?.code}: ${span(items)}`);
    },

    async createBackups(args: { parentId: string; count: number; medium: Medium; madeOn: string }) {
      const items = await planBackups(db, deps.newId, args);
      const parent = await db.first<{ code: string }>('select code from items where id = ?', [args.parentId]);
      const note = `${args.count} × ${args.medium} backup: ${span(items)}`;
      return itemsWithEvent(items, 'backed_up', note, `${args.count} backup${args.count === 1 ? '' : 's'} of ${parent?.code}: ${span(items)}`);
    },

    async createOrigin(args: { accountId: string; strainId: string; prefix: string; medium: Medium; madeOn: string; notes?: string }) {
      const item = await planOrigin(db, deps.newId, args);
      return itemsWithEvent([item], null, '', `New origin ${item.expected_code}`);
    },

    async setItemStatus(itemId: string, status: string, note?: string, contamType?: string): Promise<void> {
      const item = await db.first<{ account_id: string; status: string; code: string }>(
        'select account_id, status, code from items where id = ?',
        [itemId],
      );
      if (!item) throw new Error('Item not found');
      const at = deps.now();
      const eventId = deps.newId();
      const text = note?.trim() || `Status: ${status}`;
      await db.transaction(async () => {
        await db.run('update items set status = ?, local_pending = 1 where id = ?', [status, itemId]);
        await insertEvent(deps, item.account_id, {
          id: eventId, item_id: itemId, type: status === 'contaminated' ? 'contaminated' : 'status_changed',
          note: text, contam_type: contamType?.trim() || null, occurred_at: at,
        });
        await enqueue(
          db,
          {
            op: 'status', summary: `${item.code} marked ${status}`, event_id: eventId, item_id: itemId, status,
            note: text, contam_type: contamType?.trim() || null, occurred_at: at, prev_status: item.status,
          },
          at,
        );
      });
    },

    async addNote(accountId: string, itemId: string, note: string): Promise<void> {
      const item = await db.first<{ code: string }>('select code from items where id = ?', [itemId]);
      const at = deps.now();
      const event: LocalEvent = { id: deps.newId(), item_id: itemId, type: 'note', note: note.trim(), contam_type: null, occurred_at: at };
      await db.transaction(async () => {
        await insertEvent(deps, accountId, event);
        await enqueue(db, { op: 'event', summary: `Note on ${item?.code ?? 'a culture'}`, event }, at);
      });
    },

    async createStrain(accountId: string, name: string, species: string) {
      const clean = name.trim();
      const clash = await db.first<{ id: string }>(
        'select id from strains where lower(name) = lower(?) and deleted_at is null',
        [clean],
      );
      // Same constraint name the server reports, so the screen's message matches.
      if (clash) throw new Error('duplicate key value violates unique constraint "strains_name_uq"');
      const at = deps.now();
      const strain = { id: deps.newId(), account_id: accountId, name: clean, species: species.trim() || null };
      await db.transaction(async () => {
        await db.run(
          `insert into strains (id, account_id, name, species, created_at, updated_at, local_pending) values (?, ?, ?, ?, ?, ?, 1)`,
          [strain.id, strain.account_id, strain.name, strain.species, at, at],
        );
        await enqueue(db, { op: 'strain', summary: `New strain ${clean}`, strain }, at);
      });
      return strain;
    },

    async resolveRelabel(id: string): Promise<void> {
      const at = deps.now();
      const r = await db.first<{ old_code: string; new_code: string }>('select old_code, new_code from relabels where id = ?', [id]);
      await db.transaction(async () => {
        await db.run('update relabels set resolved_at = ?, local_pending = 1 where id = ?', [at, id]);
        await enqueue(db, { op: 'resolve_relabel', summary: `Relabel ${r?.old_code} → ${r?.new_code}`, id, resolved_at: at }, at);
      });
    },

    readItems: (ids: string[]) => readItems(db, ids),
  };
}

export type LocalWriter = ReturnType<typeof localWriter>;
