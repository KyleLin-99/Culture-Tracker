import type { SupabaseClient } from '@supabase/supabase-js';

import type { WriteRemote } from './outbox';
import type { RemoteRow } from './tables';

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

// Sends queued phone changes through the idempotent server functions in
// supabase/migrations/*_offline_writes.sql.
export const createWriteRemote = (supabase: SupabaseClient): WriteRemote => ({
  async applyItems(items) {
    // generation and origin_number are worked out by the server; don't send them.
    const payload = items.map(({ generation: _g, origin_number: _o, ...rest }) => rest);
    return unwrap(await supabase.rpc('apply_items', { p_items: payload })) as RemoteRow[];
  },

  async applyEvent(e) {
    return unwrap(
      await supabase.rpc('apply_event', {
        p_id: e.id,
        p_item_id: e.item_id,
        p_type: e.type,
        p_note: e.note,
        p_contam_type: e.contam_type,
        p_occurred_at: e.occurred_at,
      }),
    ) as RemoteRow;
  },

  async applyStatus(op) {
    return unwrap(
      await supabase.rpc('apply_status', {
        p_event_id: op.event_id,
        p_item_id: op.item_id,
        p_status: op.status,
        p_note: op.note,
        p_contam_type: op.contam_type,
        p_occurred_at: op.occurred_at,
      }),
    ) as RemoteRow;
  },

  async insertStrain(s) {
    const rows = unwrap(
      await supabase.from('strains').upsert(s, { onConflict: 'id', ignoreDuplicates: true }).select(),
    ) as RemoteRow[];
    return rows[0] ?? null;
  },

  async editNote(op) {
    return unwrap(
      await supabase.rpc('edit_note', { p_id: op.event_id, p_note: op.note, p_delete: op.remove }),
    ) as RemoteRow;
  },

  async applyCheck(c) {
    return unwrap(
      await supabase.rpc('apply_check', {
        p_id: c.id,
        p_item_id: c.item_id,
        p_checked_on: c.checked_on,
        p_percent: c.percent,
        p_radius_mm: c.radius_mm,
        p_note: c.note,
      }),
    ) as RemoteRow;
  },

  async removeCheck(id) {
    return unwrap(await supabase.rpc('remove_check', { p_id: id })) as RemoteRow;
  },

  async resolveRelabel(id, resolvedAt) {
    return unwrap(
      await supabase.from('relabels').update({ resolved_at: resolvedAt }).eq('id', id).select().maybeSingle(),
    ) as RemoteRow | null;
  },
});
