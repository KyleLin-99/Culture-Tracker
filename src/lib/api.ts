// Every database call the screens make, in one place. Each throws on error.
// Milestone 2 reroutes writes through the offline outbox; screens won't change.

import { todayLocal } from '@/domain/cultureCode';
import type { Item, ItemEvent, ItemStatus, LookupRow, Medium, Strain, TreeRow } from '@/domain/types';

import { supabase } from './supabase';

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

// --- Accounts -------------------------------------------------------------

export async function createAccount(name: string, initials: string): Promise<string> {
  return unwrap(await supabase.rpc('create_account', { p_name: name, p_initials: initials }));
}

// --- Strains --------------------------------------------------------------

export async function listStrains(): Promise<Strain[]> {
  return unwrap(
    await supabase.from('strains').select('*').is('deleted_at', null).order('name'),
  );
}

export async function getStrain(id: string): Promise<Strain> {
  return unwrap(await supabase.from('strains').select('*').eq('id', id).single());
}

export async function createStrain(accountId: string, name: string, species: string): Promise<Strain> {
  return unwrap(
    await supabase
      .from('strains')
      .insert({ account_id: accountId, name: name.trim(), species: species.trim() || null })
      .select()
      .single(),
  );
}

// --- Items ----------------------------------------------------------------

export async function getItem(id: string): Promise<Item & { strains: { name: string } | null }> {
  return unwrap(await supabase.from('items').select('*, strains(name)').eq('id', id).single());
}

export async function recentItems(limit = 15): Promise<(Item & { strains: { name: string } | null })[]> {
  return unwrap(
    await supabase
      .from('items')
      .select('*, strains(name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function createOrigin(args: {
  accountId: string;
  strainId: string;
  prefix: string;
  medium: Medium;
  madeOn?: string;
  notes?: string;
}): Promise<Item> {
  return unwrap(
    await supabase
      .from('items')
      .insert({
        account_id: args.accountId,
        strain_id: args.strainId,
        kind: 'origin',
        medium: args.medium,
        origin_prefix: args.prefix.trim().toUpperCase(),
        made_on: args.madeOn ?? todayLocal(),
        notes: args.notes?.trim() || null,
      })
      .select()
      .single(),
  );
}

export async function createTransfers(args: {
  parentId: string;
  count: number;
  medium: Medium;
  madeOn?: string;
  location?: string;
}): Promise<Item[]> {
  return unwrap(
    await supabase.rpc('create_transfers', {
      p_parent_id: args.parentId,
      p_count: args.count,
      p_medium: args.medium,
      p_made_on: args.madeOn ?? todayLocal(),
      p_location: args.location?.trim() || null,
    }),
  );
}

export async function createBackups(args: {
  parentId: string;
  count: number;
  medium: Medium;
  madeOn?: string;
}): Promise<Item[]> {
  return unwrap(
    await supabase.rpc('create_backups', {
      p_parent_id: args.parentId,
      p_count: args.count,
      p_medium: args.medium,
      p_made_on: args.madeOn ?? todayLocal(),
    }),
  );
}

export async function setItemStatus(
  itemId: string,
  status: ItemStatus,
  note?: string,
  contamType?: string,
): Promise<Item> {
  return unwrap(
    await supabase.rpc('set_item_status', {
      p_item_id: itemId,
      p_status: status,
      p_note: note?.trim() || null,
      p_contam_type: contamType?.trim() || null,
    }),
  );
}

export async function addNote(accountId: string, itemId: string, note: string): Promise<void> {
  unwrap(
    await supabase.from('events').insert({ account_id: accountId, item_id: itemId, type: 'note', note: note.trim() }),
  );
}

export async function itemEvents(itemId: string): Promise<ItemEvent[]> {
  return unwrap(
    await supabase
      .from('events')
      .select('id, type, occurred_at, note, contam_type')
      .eq('item_id', itemId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false }),
  );
}

// --- Lookup and lineage ---------------------------------------------------

export async function lookupCode(query: string): Promise<LookupRow[]> {
  return unwrap(await supabase.rpc('lookup_code', { p_query: query }));
}

export async function itemLineage(itemId: string, direction: 'up' | 'down' | 'both' = 'both'): Promise<TreeRow[]> {
  return unwrap(await supabase.rpc('item_lineage', { p_item_id: itemId, p_direction: direction }));
}

export async function strainTree(strainId: string): Promise<TreeRow[]> {
  return unwrap(await supabase.rpc('strain_tree', { p_strain_id: strainId }));
}
