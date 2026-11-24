import type { SupabaseClient } from '@supabase/supabase-js';

import type { RemoteSource } from './sync';
import { TABLES, type RemoteRow, type TableName } from './tables';

// Pulls from Supabase, one lab at a time: row-level security allows every lab
// you belong to, so each query names the lab being synced. Takes the client so integration tests can sign in
// as different test users.
export const createRemote = (supabase: SupabaseClient): RemoteSource => ({
  async changed(table, { accountId, since, historyFrom, offset, limit }) {
    let q = supabase
      .from(table)
      .select(TABLES[table].join(','))
      .eq('account_id', accountId)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    if (since) q = q.gt('updated_at', since);
    if (historyFrom && table === 'items') q = q.or(`status.eq.active,made_on.gte.${historyFrom}`);
    if (historyFrom && table === 'events') q = q.gte('occurred_at', historyFrom);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as RemoteRow[];
  },

  async byIds(table: TableName, ids: string[]) {
    const out: RemoteRow[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from(table).select(TABLES[table].join(',')).in('id', ids.slice(i, i + 100));
      if (error) throw error;
      out.push(...((data ?? []) as unknown as RemoteRow[]));
    }
    return out;
  },
});
