// What the tools read from a lab. Everything goes through Supabase as the
// signed-in grower, so row-level security limits answers to their own lab.
// Tests use a fake with the same shape.

import type { SupabaseClient } from '@supabase/supabase-js';

export type LookupRow = {
  id: string;
  code: string;
  strain_id: string;
  strain_name: string;
  medium: string;
  status: string;
  made_on: string;
  initials: string;
  exact: boolean;
};

export type TreeRow = {
  id: string;
  parent_id: string | null;
  code: string;
  kind: string;
  medium: string;
  status: string;
  generation: number;
  made_on: string;
  depth: number;
};

export type TraceRow = {
  factor: string;
  label: string;
  contaminated_with: number;
  clean_with: number;
  contaminated_total: number;
  clean_total: number;
  rate_with: number;
  rate_without: number | null;
  relative_risk: number;
  p_value: number;
};

export type BackupRow = { id: string; code: string; medium: string; made_on: string; strains: { name: string } | null };

export type CheckRow = { item_id: string; checked_on: string; percent: number | null; radius_mm: number | null };

export interface Lab {
  lookupCode(query: string): Promise<LookupRow[]>;
  itemLineage(itemId: string, direction: 'up' | 'down' | 'both'): Promise<TreeRow[]>;
  strains(): Promise<{ id: string; name: string; species: string | null }[]>;
  strainTree(strainId: string): Promise<TreeRow[]>;
  trace(from: string, to: string, strainId: string | null): Promise<TraceRow[]>;
  statsRows(from: string, to: string): Promise<import('../../src/domain/stats').StatsRow[]>;
  checks(itemIds: string[]): Promise<CheckRow[]>;
  activeBackups(): Promise<BackupRow[]>;
  backupRefreshSettings(): Promise<Record<string, unknown> | null>;
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export function supabaseLab(db: SupabaseClient): Lab {
  return {
    async lookupCode(query) {
      return unwrap(await db.rpc('lookup_code', { p_query: query }));
    },
    async itemLineage(itemId, direction) {
      return unwrap(await db.rpc('item_lineage', { p_item_id: itemId, p_direction: direction }));
    },
    async strains() {
      return unwrap(await db.from('strains').select('id, name, species').is('deleted_at', null).order('name'));
    },
    async strainTree(strainId) {
      return unwrap(await db.rpc('strain_tree', { p_strain_id: strainId }));
    },
    async trace(from, to, strainId) {
      return unwrap(await db.rpc('contamination_trace', { p_from: from, p_to: to, p_strain_id: strainId }));
    },
    async statsRows(from, to) {
      return unwrap(await db.rpc('stats_rows', { p_from: from, p_to: to }));
    },
    async checks(itemIds) {
      const out: CheckRow[] = [];
      for (let i = 0; i < itemIds.length; i += 100) {
        out.push(
          ...unwrap<CheckRow[]>(
            await db
              .from('colonization_checks')
              .select('item_id, checked_on, percent, radius_mm')
              .in('item_id', itemIds.slice(i, i + 100))
              .is('deleted_at', null),
          ),
        );
      }
      return out;
    },
    async activeBackups() {
      // strains(name) is a to-one join; supabase-js types it as a list without generated types.
      return unwrap<BackupRow[]>(
        await db
          .from('items')
          .select('id, code, medium, made_on, strains(name)')
          .is('deleted_at', null)
          .eq('kind', 'backup')
          .eq('status', 'active')
          .order('made_on')
          .returns<BackupRow[]>(),
      );
    },
    async backupRefreshSettings() {
      const rows = unwrap<{ backup_refresh_days: Record<string, unknown> }[]>(
        await db.from('lab_settings').select('backup_refresh_days').is('deleted_at', null).limit(1),
      );
      return rows[0]?.backup_refresh_days ?? null;
    },
  };
}
