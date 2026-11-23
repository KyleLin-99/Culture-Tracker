// The app's read queries, answered from the phone's local copy. Each returns
// the same shape as its counterpart in src/lib/api.ts, and the ordering rules
// match the SQL functions in supabase/migrations (tested side by side).

import { normalizeCode } from '@/domain/cultureCode';
import type {
  Item,
  ItemEvent,
  ItemWithRefs,
  LookupRow,
  MediaBatch,
  MediaKind,
  SterilizationRun,
  Strain,
  TreeRow,
} from '@/domain/types';

import type { SqlDb } from './sql';

type ItemRow = Omit<Item, 'aliases'> & {
  aliases?: string;
  media_batch_id: string | null;
  strain_name: string | null;
  batch_code: string | null;
  run_code: string | null;
};

function toItem(r: ItemRow): ItemWithRefs {
  const { strain_name, batch_code, run_code, aliases: _aliases, ...item } = r;
  return {
    ...item,
    strains: strain_name === null ? null : { name: strain_name },
    media_batches: batch_code === null ? null : { code: batch_code, sterilization_runs: run_code === null ? null : { code: run_code } },
  };
}

const ITEM_SELECT = `
  select i.*, s.name as strain_name, m.code as batch_code, r.code as run_code
  from items i
  left join strains s on s.id = i.strain_id
  left join media_batches m on m.id = i.media_batch_id
  left join sterilization_runs r on r.id = m.sterilization_run_id`;

/** Position among siblings: transfers by number, then backups; zero-padded so text order = number order. */
const SIBLING_KEY = `case when c.kind = 'backup'
  then '1' || printf('%06d', c.backup_number)
  else '0' || printf('%06d', coalesce(c.position, 0)) end`;

const TREE_COLUMNS = 'i.id, i.parent_id, i.code, i.kind, i.medium, i.status, i.generation, i.made_on, i.initials';

export function localQueries(db: SqlDb) {
  return {
    async recentItems(limit = 15): Promise<ItemWithRefs[]> {
      const rows = await db.all<ItemRow>(`${ITEM_SELECT} where i.deleted_at is null order by i.created_at desc limit ?`, [limit]);
      return rows.map(toItem);
    },

    async getItem(id: string): Promise<ItemWithRefs> {
      const row = await db.first<ItemRow>(`${ITEM_SELECT} where i.id = ?`, [id]);
      if (!row) throw new Error('Culture not found on this phone. Connect to the internet to load it.');
      return toItem(row);
    },

    async lookupCode(query: string): Promise<LookupRow[]> {
      const q = normalizeCode(query);
      if (!q) return [];
      const like = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await db.all<Omit<LookupRow, 'exact'> & { exact: number }>(
        `select i.id, i.code, i.strain_id, s.name as strain_name, i.kind, i.medium, i.status, i.made_on, i.initials,
                (i.code = ? or exists (select 1 from json_each(i.aliases) where value = ?)) as exact
         from items i join strains s on s.id = i.strain_id
         where i.deleted_at is null
           and (i.code = ? or exists (select 1 from json_each(i.aliases) where value = ?) or i.code like ? escape '\\')
         order by exact desc, s.name, length(i.code), i.code
         limit 25`,
        [q, q, q, q, like],
      );
      return rows.map((r) => ({ ...r, exact: r.exact === 1 }));
    },

    /** Ancestors (oldest first), the item, then descendants in tree order. Same rules as item_lineage(). */
    async itemLineage(itemId: string, direction: 'up' | 'down' | 'both' = 'both'): Promise<TreeRow[]> {
      return db.all<TreeRow>(
        `with recursive
         up (id, parent_id, depth) as (
           select id, parent_id, 0 from items where id = ?
           union all
           select p.id, p.parent_id, up.depth - 1 from items p join up on p.id = up.parent_id where up.depth > -200
         ),
         down (id, depth, sort_path) as (
           select id, 0, '' from items where id = ?
           union all
           select c.id, down.depth + 1, down.sort_path || '/' || ${SIBLING_KEY}
           from items c join down on c.parent_id = down.id
           where c.deleted_at is null and down.depth < 200
         ),
         picked (id, depth, sort_path) as (
           select id, depth, '' from up where ? in ('up', 'both') and depth < 0
           union all
           select id, depth, sort_path from down where ? in ('down', 'both') or (? = 'up' and depth = 0)
         )
         select ${TREE_COLUMNS}, picked.depth
         from picked join items i on i.id = picked.id
         order by picked.depth >= 0, case when picked.depth < 0 then picked.depth else 0 end, picked.sort_path`,
        [itemId, itemId, direction, direction, direction],
      );
    },

    /** A strain's whole tree in display order. Same rules as strain_tree(). */
    async strainTree(strainId: string): Promise<TreeRow[]> {
      return db.all<TreeRow>(
        `with recursive tree (id, depth, sort_path) as (
           select id, 0, origin_prefix || printf('%06d', coalesce(origin_number, 1))
           from items where strain_id = ? and kind = 'origin' and deleted_at is null
           union all
           select c.id, tree.depth + 1, tree.sort_path || '/' || ${SIBLING_KEY}
           from items c join tree on c.parent_id = tree.id
           where c.deleted_at is null and tree.depth < 100
         )
         select ${TREE_COLUMNS}, tree.depth
         from tree join items i on i.id = tree.id
         order by tree.sort_path`,
        [strainId],
      );
    },

    async listStrains(): Promise<Strain[]> {
      return db.all<Strain>('select * from strains where deleted_at is null order by name collate nocase');
    },

    async getStrain(id: string): Promise<Strain> {
      const row = await db.first<Strain>('select * from strains where id = ?', [id]);
      if (!row) throw new Error('Strain not found on this phone. Connect to the internet to load it.');
      return row;
    },

    async itemEvents(itemId: string): Promise<ItemEvent[]> {
      return db.all<ItemEvent>(
        `select id, type, occurred_at, note, contam_type from events
         where item_id = ? and deleted_at is null order by occurred_at desc`,
        [itemId],
      );
    },

    async listRuns(limit = 30): Promise<SterilizationRun[]> {
      return db.all<SterilizationRun>(
        'select * from sterilization_runs where deleted_at is null order by run_on desc, created_at desc limit ?',
        [limit],
      );
    },

    async listBatches(kind?: MediaKind | null, limit = 30): Promise<MediaBatch[]> {
      const rows = await db.all<MediaBatch & { run_code: string | null }>(
        `select m.*, r.code as run_code from media_batches m
         left join sterilization_runs r on r.id = m.sterilization_run_id
         where m.deleted_at is null and (? is null or m.kind = ?)
         order by m.made_on desc, m.created_at desc limit ?`,
        [kind ?? null, kind ?? null, limit],
      );
      return rows.map(({ run_code, ...b }) => ({ ...b, sterilization_runs: run_code === null ? null : { code: run_code } }));
    },
  };
}

export type LocalQueries = ReturnType<typeof localQueries>;
