// Every database call the screens make, in one place. Each throws on error.
// On phones, once the local copy is synced (src/offline), reads come from it and
// culture changes are made on the phone and queued for the server, so both work
// with no signal. The web, and lab setup (account, batches, runs), talk to
// Supabase directly.

import * as Crypto from 'expo-crypto';

import { type BackupMedium, refreshDays } from '@/domain/backups';
import { todayLocal } from '@/domain/cultureCode';
import { currentRecipes } from '@/domain/recipes';
import type {
  ColonizationCheck,
  Ingredient,
  Item,
  ItemEvent,
  ItemWithRefs,
  ItemStatus,
  LookupRow,
  MediaBatch,
  MediaKind,
  Medium,
  Recipe,
  Strain,
  SterilizationMethod,
  SterilizationRun,
  TraceRow,
  TreeRow,
} from '@/domain/types';

import {
  afterWrite,
  dismissFailedChange as dismissFailed,
  listFailedChanges as failedOnPhone,
  localReader,
  localWriter,
  syncNow,
} from '@/offline/engine';
import type { FailedChange } from '@/offline/outbox';
import type { Relabel } from '@/offline/queries';

import { supabase } from './supabase';

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

// --- Accounts -------------------------------------------------------------

export async function createAccount(name: string, initials: string): Promise<string> {
  const out = unwrap<string>(await supabase.rpc('create_account', { p_name: name, p_initials: initials }));
  await afterWrite();
  return out;
}

// --- Strains --------------------------------------------------------------

export async function listStrains(): Promise<Strain[]> {
  const local = await localReader();
  if (local) return local.listStrains();
  return unwrap(
    await supabase.from('strains').select('*').is('deleted_at', null).order('name'),
  );
}

export async function getStrain(id: string): Promise<Strain> {
  const local = await localReader();
  if (local) return local.getStrain(id);
  return unwrap(await supabase.from('strains').select('*').eq('id', id).single());
}

export async function createStrain(accountId: string, name: string, species: string): Promise<Strain> {
  const w = await localWriter();
  if (w) {
    const strain = await w.createStrain(accountId, name, species);
    await syncNow();
    return (await localReader())!.getStrain(strain.id);
  }
  const out = unwrap<Strain>(
    await supabase
      .from('strains')
      .insert({ account_id: accountId, name: name.trim(), species: species.trim() || null })
      .select()
      .single(),
  );
  await afterWrite();
  return out;
}

// --- Items ----------------------------------------------------------------

export async function getItem(id: string): Promise<ItemWithRefs> {
  const local = await localReader();
  if (local) return local.getItem(id);
  return unwrap(
    await supabase
      .from('items')
      .select('*, strains(name), media_batches(code, sterilization_runs(code))')
      .eq('id', id)
      .single(),
  );
}

export async function recentItems(limit = 15): Promise<(Item & { strains: { name: string } | null })[]> {
  const local = await localReader();
  if (local) return local.recentItems(limit);
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
  const w = await localWriter();
  if (w) {
    const { ids } = await w.createOrigin({ ...args, madeOn: args.madeOn ?? todayLocal() });
    await syncNow(); // online: the server's final code; offline: the phone's
    return (await w.readItems(ids))[0];
  }
  const out = unwrap<Item>(
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
  await afterWrite();
  return out;
}

export async function createTransfers(args: {
  parentId: string;
  count: number;
  medium: Medium;
  madeOn?: string;
  location?: string;
  mediaBatchId?: string | null;
}): Promise<Item[]> {
  const w = await localWriter();
  if (w) {
    const { ids } = await w.createTransfers({ ...args, madeOn: args.madeOn ?? todayLocal() });
    await syncNow();
    return w.readItems(ids);
  }
  const out = unwrap<Item[]>(
    await supabase.rpc('create_transfers', {
      p_parent_id: args.parentId,
      p_count: args.count,
      p_medium: args.medium,
      p_made_on: args.madeOn ?? todayLocal(),
      p_media_batch_id: args.mediaBatchId ?? null,
      p_location: args.location?.trim() || null,
    }),
  );
  await afterWrite();
  return out;
}

export async function createBackups(args: {
  parentId: string;
  count: number;
  medium: Medium;
  madeOn?: string;
}): Promise<Item[]> {
  const w = await localWriter();
  if (w) {
    const { ids } = await w.createBackups({ ...args, madeOn: args.madeOn ?? todayLocal() });
    await syncNow();
    return w.readItems(ids);
  }
  const out = unwrap<Item[]>(
    await supabase.rpc('create_backups', {
      p_parent_id: args.parentId,
      p_count: args.count,
      p_medium: args.medium,
      p_made_on: args.madeOn ?? todayLocal(),
    }),
  );
  await afterWrite();
  return out;
}

export async function setItemStatus(
  itemId: string,
  status: ItemStatus,
  note?: string,
  contamType?: string,
): Promise<Item> {
  const w = await localWriter();
  if (w) {
    await w.setItemStatus(itemId, status, note, contamType);
    await syncNow();
    return (await w.readItems([itemId]))[0];
  }
  const out = unwrap<Item>(
    await supabase.rpc('set_item_status', {
      p_item_id: itemId,
      p_status: status,
      p_note: note?.trim() || null,
      p_contam_type: contamType?.trim() || null,
    }),
  );
  await afterWrite();
  return out;
}

export async function addNote(accountId: string, itemId: string, note: string): Promise<void> {
  const w = await localWriter();
  if (w) {
    await w.addNote(accountId, itemId, note);
    await syncNow();
    return;
  }
  unwrap(
    await supabase.from('events').insert({ account_id: accountId, item_id: itemId, type: 'note', note: note.trim() }),
  );
  await afterWrite();
}

/** Edits a note's text, or removes the note when `text` is null. Only notes can change. */
export async function changeNote(eventId: string, text: string | null): Promise<void> {
  const w = await localWriter();
  if (w) {
    await w.changeNote(eventId, text);
    await syncNow();
    return;
  }
  unwrap(
    await supabase.rpc('edit_note', { p_id: eventId, p_note: text?.trim() ?? null, p_delete: text === null }),
  );
  await afterWrite();
}

// --- Colonization checks -----------------------------------------------------

/** Checks on these cultures (one culture, or a culture and its ancestors), oldest first. */
export async function itemChecks(itemIds: string[]): Promise<ColonizationCheck[]> {
  if (!itemIds.length) return [];
  const local = await localReader();
  if (local) return local.itemChecks(itemIds);
  return unwrap(
    await supabase
      .from('colonization_checks')
      .select('id, item_id, checked_on, percent, radius_mm, note, source, created_at')
      .in('item_id', itemIds)
      .is('deleted_at', null)
      .order('checked_on')
      .order('created_at'),
  );
}

/** Logs how far a culture has grown: percent of the plate and/or radius in mm. */
export async function logCheck(args: {
  itemId: string;
  checkedOn?: string;
  percent: number | null;
  radiusMm: number | null;
  note?: string;
}): Promise<void> {
  const checkedOn = args.checkedOn ?? todayLocal();
  const w = await localWriter();
  if (w) {
    await w.logCheck({ ...args, checkedOn });
    await syncNow();
    return;
  }
  unwrap(
    await supabase.rpc('apply_check', {
      p_id: Crypto.randomUUID(),
      p_item_id: args.itemId,
      p_checked_on: checkedOn,
      p_percent: args.percent,
      p_radius_mm: args.radiusMm,
      p_note: args.note?.trim() || null,
    }),
  );
  await afterWrite();
}

export async function removeCheck(id: string): Promise<void> {
  const w = await localWriter();
  if (w) {
    await w.removeCheck(id);
    await syncNow();
    return;
  }
  unwrap(await supabase.rpc('remove_check', { p_id: id }));
  await afterWrite();
}

// --- Backups due ---------------------------------------------------------------

/** Active backups, oldest first, with their strain. */
export async function activeBackups(): Promise<ItemWithRefs[]> {
  const local = await localReader();
  if (local) return local.activeBackups();
  return unwrap(
    await supabase
      .from('items')
      .select('*, strains(name), media_batches(code, sterilization_runs(code))')
      .is('deleted_at', null)
      .eq('kind', 'backup')
      .eq('status', 'active')
      .order('made_on')
      .order('code'),
  );
}

/** Days between refreshes for each backup medium, with defaults for any not set. */
export async function backupRefreshDays(): Promise<Record<BackupMedium, number>> {
  const local = await localReader();
  if (local) return refreshDays(await local.backupRefreshSettings());
  const rows = unwrap<{ backup_refresh_days: Record<string, unknown> }[]>(
    await supabase.from('lab_settings').select('backup_refresh_days').is('deleted_at', null).limit(1),
  );
  return refreshDays(rows[0]?.backup_refresh_days);
}

/** Saves refresh ages (online, like other lab setup). */
export async function saveBackupRefreshDays(accountId: string, days: Partial<Record<BackupMedium, number>>): Promise<void> {
  unwrap(await supabase.rpc('set_backup_refresh', { p_account_id: accountId, p_days: days }));
  await afterWrite();
}

export async function itemEvents(itemId: string): Promise<ItemEvent[]> {
  const local = await localReader();
  if (local) return local.itemEvents(itemId);
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
  const local = await localReader();
  if (local) return local.lookupCode(query);
  return unwrap(await supabase.rpc('lookup_code', { p_query: query }));
}

export async function itemLineage(itemId: string, direction: 'up' | 'down' | 'both' = 'both'): Promise<TreeRow[]> {
  const local = await localReader();
  if (local) return local.itemLineage(itemId, direction);
  return unwrap(await supabase.rpc('item_lineage', { p_item_id: itemId, p_direction: direction }));
}

export async function strainTree(strainId: string): Promise<TreeRow[]> {
  const local = await localReader();
  if (local) return local.strainTree(strainId);
  return unwrap(await supabase.rpc('strain_tree', { p_strain_id: strainId }));
}

// --- Sterilization runs and media batches --------------------------------

const BATCH_SELECT = '*, sterilization_runs(code), recipes(name, version)';

export async function listRuns(limit = 30): Promise<SterilizationRun[]> {
  const local = await localReader();
  if (local) return local.listRuns(limit);
  return unwrap(
    await supabase
      .from('sterilization_runs')
      .select('*')
      .is('deleted_at', null)
      .order('run_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function createRun(args: {
  accountId: string;
  method: SterilizationMethod;
  psi?: number | null;
  minutes?: number | null;
  runOn?: string;
  notes?: string;
}): Promise<SterilizationRun> {
  const out = unwrap<SterilizationRun>(
    await supabase
      .from('sterilization_runs')
      .insert({
        account_id: args.accountId,
        method: args.method,
        psi: args.psi ?? null,
        minutes: args.minutes ?? null,
        run_on: args.runOn ?? todayLocal(),
        notes: args.notes?.trim() || null,
      })
      .select()
      .single(),
  );
  await afterWrite();
  return out;
}

export async function listBatches(kind?: MediaKind | null, limit = 30): Promise<MediaBatch[]> {
  const local = await localReader();
  if (local) return local.listBatches(kind, limit);
  let q = supabase
    .from('media_batches')
    .select(BATCH_SELECT)
    .is('deleted_at', null)
    .order('made_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q);
}

export async function createBatch(args: {
  accountId: string;
  kind: MediaKind;
  recipe?: string;
  runId?: string | null;
  recipeId?: string | null;
  volumeMl?: number | null;
  madeOn?: string;
}): Promise<MediaBatch> {
  const out = unwrap<MediaBatch>(
    await supabase
      .from('media_batches')
      .insert({
        account_id: args.accountId,
        kind: args.kind,
        recipe: args.recipe?.trim() || null,
        sterilization_run_id: args.runId ?? null,
        recipe_id: args.recipeId ?? null,
        volume_ml: args.volumeMl ?? null,
        made_on: args.madeOn ?? todayLocal(),
      })
      .select(BATCH_SELECT)
      .single(),
  );
  await afterWrite();
  return out;
}

// --- Recipes ------------------------------------------------------------------
// Saved online (like batches); phones keep a read-only copy for pickers and labels.

async function allRecipes(): Promise<Recipe[]> {
  const local = await localReader();
  if (local) return local.listRecipes();
  return unwrap(await supabase.from('recipes').select('*').order('name').order('version'));
}

/** The newest version of each recipe in use, by name; optionally only one kind. */
export async function listRecipes(kind?: MediaKind | null): Promise<Recipe[]> {
  return currentRecipes(await allRecipes()).filter((r) => !kind || r.kind === kind);
}

/** Every version of one recipe, newest first. */
export async function recipeVersions(familyId: string): Promise<Recipe[]> {
  const local = await localReader();
  const rows = local
    ? (await local.listRecipes()).filter((r) => r.family_id === familyId)
    : unwrap<Recipe[]>(await supabase.from('recipes').select('*').eq('family_id', familyId));
  return [...rows].sort((a, b) => b.version - a.version);
}

/** Saves a new recipe (no familyId) or the next version of one. */
export async function saveRecipe(args: {
  accountId: string;
  familyId?: string | null;
  name: string;
  kind: MediaKind;
  volumeMl: number;
  ingredients: Ingredient[];
  steps?: string;
}): Promise<Recipe> {
  const out = unwrap<Recipe>(
    await supabase.rpc('save_recipe', {
      p_account_id: args.accountId,
      p_family_id: args.familyId ?? null,
      p_name: args.name,
      p_kind: args.kind,
      p_volume_ml: args.volumeMl,
      p_ingredients: args.ingredients,
      p_steps: args.steps?.trim() || null,
    }),
  );
  await afterWrite();
  return out;
}

/** Hides a recipe (every version) from pickers; batches keep pointing at it. */
export async function archiveRecipe(familyId: string): Promise<void> {
  unwrap(await supabase.rpc('archive_recipe', { p_family_id: familyId }));
  await afterWrite();
}

// --- Contamination trace ---------------------------------------------------

export async function contaminationTrace(fromDate: string, toDate: string = todayLocal()): Promise<TraceRow[]> {
  return unwrap(await supabase.rpc('contamination_trace', { p_from: fromDate, p_to: toDate }));
}

// --- Offline: relabels and refused changes ----------------------------------

export type { FailedChange, Relabel };

/** Plates the server renumbered after a code conflict, to relabel. */
export async function listRelabels(): Promise<Relabel[]> {
  const local = await localReader();
  if (local) return local.openRelabels();
  return unwrap(
    await supabase
      .from('relabels')
      .select('id, entity_id, old_code, new_code, created_at')
      .is('resolved_at', null)
      .is('deleted_at', null)
      .order('created_at'),
  );
}

export async function resolveRelabel(id: string): Promise<void> {
  const w = await localWriter();
  if (w) {
    await w.resolveRelabel(id);
    await syncNow();
    return;
  }
  unwrap(await supabase.from('relabels').update({ resolved_at: new Date().toISOString() }).eq('id', id));
}

/** Changes made on this phone that the server refused. Always empty on web. */
export function listFailedChanges(): Promise<FailedChange[]> {
  return failedOnPhone();
}

export function dismissFailedChange(seq: number): Promise<void> {
  return dismissFailed(seq);
}
