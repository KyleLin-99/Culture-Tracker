// A fake of the server side of offline writing, following the same rules as
// apply_items / apply_status / apply_event (supabase/migrations/*_offline_writes.sql),
// so outbox tests can cover conflicts, rejections and dropped connections.

import { MAX_CODE_LENGTH, transferCode } from '@/domain/cultureCode';
import type { ItemKind } from '@/domain/types';

import type { LocalEvent, WriteRemote } from '../outbox';
import type { RemoteRow } from '../tables';

import { type FakeLab, tick } from './fakeLab';

export function fakeServer(lab: FakeLab) {
  const state = { online: true, calls: 0 };
  const offline = () => {
    if (!state.online) throw new TypeError('Network request failed');
    state.calls += 1;
  };
  const items = () => lab.items;

  function insertItem(p: Record<string, unknown>, preferred: boolean): RemoteRow {
    const parent = p.parent_id ? items().find((i) => i.id === p.parent_id) : null;
    if (p.parent_id && !parent) throw new Error('Parent item not found');
    let code: string;
    const row: RemoteRow = { ...(p as RemoteRow) };
    if (p.kind === 'origin') {
      const same = items().filter((i) => i.strain_id === p.strain_id && i.kind === 'origin' && i.origin_prefix === p.origin_prefix);
      const n = same.length ? Math.max(...same.map((i) => (i.origin_number as number | null) ?? 1)) + 1 : null;
      row.origin_number = n;
      code = `${p.origin_prefix}${n ?? ''}`;
      row.generation = 0;
    } else if (p.kind === 'backup') {
      const sibs = items().filter((i) => i.parent_id === parent!.id && i.kind === 'backup');
      let n = p.backup_number as number;
      if (!preferred || sibs.some((s) => s.backup_number === n)) n = Math.max(0, ...sibs.map((s) => s.backup_number as number)) + 1;
      row.backup_number = n;
      code = `${parent!.code}(${n})`;
      row.generation = parent!.generation;
    } else {
      const sibs = items().filter((i) => i.parent_id === parent!.id && i.kind === 'transfer');
      let n = p.position as number;
      if (!preferred || sibs.some((s) => s.position === n)) n = Math.max(0, ...sibs.map((s) => s.position as number)) + 1;
      row.position = n;
      code = transferCode(parent!.code as string, parent!.kind as ItemKind, n);
      row.generation = (parent!.generation as number) + 1;
    }
    if (code.length > MAX_CODE_LENGTH) {
      throw new Error(`Culture code ${code} would be ${code.length} characters; the limit is ${MAX_CODE_LENGTH}`);
    }
    const at = tick();
    Object.assign(row, {
      code, status: 'active', initials: 'KL', aliases: [], created_at: at, updated_at: at, deleted_at: null,
      strain_id: parent ? parent.strain_id : p.strain_id,
    });
    delete row.expected_code;
    items().push(row);
    return row;
  }

  const remote: WriteRemote = {
    async applyItems(planned) {
      offline();
      const out: RemoteRow[] = [];
      for (const p of planned) {
        const existing = items().find((i) => i.id === p.id);
        if (existing) {
          out.push({ ...existing });
          continue;
        }
        const row = insertItem(p as unknown as Record<string, unknown>, true);
        if (row.code !== p.expected_code) {
          const at = tick();
          lab.relabels.push({
            id: `relabel-${row.id}`, account_id: row.account_id, entity: 'item', entity_id: row.id,
            old_code: p.expected_code, new_code: row.code, resolved_at: null, created_at: at, updated_at: at, deleted_at: null,
          });
        }
        out.push({ ...row });
      }
      return out;
    },
    async applyEvent(e: LocalEvent) {
      offline();
      const existing = lab.events.find((x) => x.id === e.id);
      if (existing) return { ...existing };
      const item = items().find((i) => i.id === e.item_id);
      if (!item) throw new Error('Item not found');
      const at = tick();
      const row: RemoteRow = { ...e, account_id: item.account_id, photo_key: null, created_at: at, updated_at: at, deleted_at: null };
      lab.events.push(row);
      return { ...row };
    },
    async applyStatus(op) {
      offline();
      const item = items().find((i) => i.id === op.item_id && !i.deleted_at);
      if (lab.events.some((x) => x.id === op.event_id)) return { ...item! };
      if (!item) throw new Error('Item not found');
      Object.assign(item, { status: op.status, updated_at: tick() });
      lab.events.push({
        id: op.event_id, account_id: item.account_id, item_id: item.id,
        type: op.status === 'contaminated' ? 'contaminated' : 'status_changed', note: op.note,
        contam_type: op.contam_type, occurred_at: op.occurred_at, photo_key: null,
        created_at: item.updated_at, updated_at: item.updated_at, deleted_at: null,
      });
      return { ...item };
    },
    async insertStrain(s) {
      offline();
      if (lab.strains.some((x) => x.id === s.id)) return null;
      const at = tick();
      const row: RemoteRow = { ...s, notes: null, created_at: at, updated_at: at, deleted_at: null };
      lab.strains.push(row);
      return { ...row };
    },
    async editNote(op) {
      // Same rules as edit_note() in supabase/migrations/*_note_edits.sql.
      offline();
      const e = lab.events.find((x) => x.id === op.event_id);
      if (!e) throw new Error('Note not found');
      if (e.type !== 'note') throw new Error('Only notes can be edited or removed');
      if (op.remove) {
        if (!e.deleted_at) Object.assign(e, { deleted_at: tick(), updated_at: tick() });
        return { ...e };
      }
      if (!op.note?.trim()) throw new Error("A note can't be empty");
      if (e.deleted_at) throw new Error('This note was removed');
      Object.assign(e, { note: op.note.trim(), updated_at: tick() });
      return { ...e };
    },
    async applyCheck(c) {
      // Same rules as apply_check() in supabase/migrations/*_colonization_checks.sql.
      offline();
      const existing = lab.colonization_checks.find((x) => x.id === c.id);
      if (existing) return { ...existing };
      const item = items().find((i) => i.id === c.item_id && !i.deleted_at);
      if (!item) throw new Error('Culture not found');
      if (c.percent === null && c.radius_mm === null) throw new Error('A check needs a percent colonized or a radius');
      if (c.checked_on < (item.made_on as string)) throw new Error("A check can't be dated before the culture was made");
      const at = tick();
      const row: RemoteRow = { ...c, account_id: item.account_id, source: 'manual', created_at: at, updated_at: at, deleted_at: null };
      lab.colonization_checks.push(row);
      return { ...row };
    },
    async removeCheck(id) {
      offline();
      const c = lab.colonization_checks.find((x) => x.id === id);
      if (!c) throw new Error('Check not found');
      if (!c.deleted_at) Object.assign(c, { deleted_at: tick(), updated_at: tick() });
      return { ...c };
    },
    async resolveRelabel(id, at) {
      offline();
      const r = lab.relabels.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, { resolved_at: at, updated_at: tick() });
      return { ...r };
    },
  };

  return { remote, state };
}
