// Works out ids and culture codes for changes made on the phone, from the local
// copy, by the same rules as the database trigger (supabase/migrations/*_culture_codes.sql).
// The server has the final say: if another device got a position first, the
// server renumbers and records a relabel (apply_items).

import { MAX_CODE_LENGTH, transferCode } from '@/domain/cultureCode';
import type { ItemKind, Medium } from '@/domain/types';

import type { SqlDb } from './sql';

/** One item as sent to apply_items(). */
export type PlannedItem = {
  id: string;
  account_id: string;
  strain_id: string;
  parent_id: string | null;
  kind: ItemKind;
  medium: Medium;
  origin_prefix: string | null;
  origin_number: number | null;
  position: number | null;
  backup_number: number | null;
  made_on: string;
  media_batch_id: string | null;
  location: string | null;
  notes: string | null;
  generation: number;
  expected_code: string;
  /** Set when this culture refreshes a backup (see refresh_backup()). */
  refresh_of?: string | null;
};

type ParentRow = { id: string; account_id: string; strain_id: string; kind: ItemKind; code: string; generation: number };

async function parentOf(db: SqlDb, id: string): Promise<ParentRow> {
  const p = await db.first<ParentRow>(
    'select id, account_id, strain_id, kind, code, generation from items where id = ? and deleted_at is null',
    [id],
  );
  if (!p) throw new Error('Item not found');
  return p;
}

function checkLength(code: string) {
  if (code.length > MAX_CODE_LENGTH) {
    // Same wording as the database, so the screen shows one message either way.
    throw new Error(`Culture code ${code} would be ${code.length} characters; the limit is ${MAX_CODE_LENGTH}`);
  }
}

const base = (p: Partial<PlannedItem>): Omit<PlannedItem, 'id' | 'expected_code'> => ({
  account_id: '',
  strain_id: '',
  parent_id: null,
  kind: 'transfer',
  medium: 'agar',
  origin_prefix: null,
  origin_number: null,
  position: null,
  backup_number: null,
  made_on: '',
  media_batch_id: null,
  location: null,
  notes: null,
  generation: 0,
  refresh_of: null,
  ...p,
});

export async function planTransfers(
  db: SqlDb,
  newId: () => string,
  args: { parentId: string; count: number; medium: Medium; madeOn: string; mediaBatchId?: string | null; location?: string | null },
): Promise<PlannedItem[]> {
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100) throw new Error('Count must be between 1 and 100');
  const parent = await parentOf(db, args.parentId);
  const row = await db.first<{ n: number | null }>(
    "select max(position) as n from items where parent_id = ? and kind = 'transfer'",
    [parent.id],
  );
  const start = (row?.n ?? 0) + 1;
  return Array.from({ length: args.count }, (_, i) => {
    const position = start + i;
    const code = transferCode(parent.code, parent.kind, position);
    checkLength(code);
    return {
      ...base({
        account_id: parent.account_id,
        strain_id: parent.strain_id,
        parent_id: parent.id,
        kind: 'transfer',
        medium: args.medium,
        position,
        made_on: args.madeOn,
        media_batch_id: args.mediaBatchId ?? null,
        location: args.location?.trim() || null,
        generation: parent.generation + 1,
      }),
      id: newId(),
      expected_code: code,
    };
  });
}

export async function planBackups(
  db: SqlDb,
  newId: () => string,
  args: { parentId: string; count: number; medium: Medium; madeOn: string },
): Promise<PlannedItem[]> {
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100) throw new Error('Count must be between 1 and 100');
  const parent = await parentOf(db, args.parentId);
  const row = await db.first<{ n: number | null }>(
    "select max(backup_number) as n from items where parent_id = ? and kind = 'backup'",
    [parent.id],
  );
  const start = (row?.n ?? 0) + 1;
  return Array.from({ length: args.count }, (_, i) => {
    const n = start + i;
    const code = `${parent.code}(${n})`;
    checkLength(code);
    return {
      ...base({
        account_id: parent.account_id,
        strain_id: parent.strain_id,
        parent_id: parent.id,
        kind: 'backup',
        medium: args.medium,
        backup_number: n,
        made_on: args.madeOn,
        generation: parent.generation,
      }),
      id: newId(),
      expected_code: code,
    };
  });
}

export async function planOrigin(
  db: SqlDb,
  newId: () => string,
  args: { accountId: string; strainId: string; prefix: string; medium: Medium; madeOn: string; notes?: string },
): Promise<PlannedItem> {
  const prefix = args.prefix.trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(prefix)) throw new Error('Origin prefix must be 1 to 6 letters');
  // First origin with this prefix in the strain has no number; later ones get 2, 3, ...
  const row = await db.first<{ n: number | null }>(
    "select max(coalesce(origin_number, 1)) as n from items where strain_id = ? and kind = 'origin' and origin_prefix = ?",
    [args.strainId, prefix],
  );
  const number = row?.n == null ? null : row.n + 1;
  const code = `${prefix}${number ?? ''}`;
  checkLength(code);
  return {
    ...base({
      account_id: args.accountId,
      strain_id: args.strainId,
      kind: 'origin',
      medium: args.medium,
      origin_prefix: prefix,
      origin_number: number,
      made_on: args.madeOn,
      notes: args.notes?.trim() || null,
    }),
    id: newId(),
    expected_code: code,
  };
}
