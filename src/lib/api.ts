// Every database call the screens make, in one place. Each throws on error.
// On phones, once the local copy is synced (src/offline), reads come from it and
// culture changes are made on the phone and queued for the server, so both work
// with no signal. The web, and lab setup (account, batches, runs), talk to
// Supabase directly.

import * as Crypto from 'expo-crypto';

import { type BackupMedium, refreshDays } from '@/domain/backups';
import { todayLocal } from '@/domain/cultureCode';
import { currentRecipes } from '@/domain/recipes';
import type { StatsRow } from '@/domain/stats';
import type {
  ColonizationCheck,
  Ingredient,
  Invite,
  Item,
  ItemEvent,
  ItemStatus,
  ItemWithRefs,
  LookupRow,
  MediaBatch,
  MediaKind,
  Medium,
  Member,
  Recipe,
  Role,
  SterilizationMethod,
  SterilizationRun,
  Strain,
  TechniqueChange,
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
import type { BackupWithRefresh, RefreshInfo, Relabel } from '@/offline/queries';

import { supabase } from './supabase';

// --- Current lab ------------------------------------------------------------
// Someone can belong to several labs, and row-level security lets them read all
// of them. Lists ask for the lab they're working in, set by the app layout.

let currentLab: string | null = null;

/** The lab whose lists to show (the app layout sets it from the lab switcher). */
export function setCurrentLab(accountId: string | null): void {
  currentLab = accountId;
}

function lab(): string {
  if (!currentLab) throw new Error('No lab selected');
  return currentLab;
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

// --- Sign-up status and waitlist (callable signed out) ----------------------

export type SignupStatus = { open: boolean; min_app_version: string; message: string };

export async function signupStatus(): Promise<SignupStatus> {
  return unwrap<SignupStatus>(await supabase.rpc('signup_status'));
}

export async function joinWaitlist(email: string): Promise<void> {
  unwrap(await supabase.rpc('join_waitlist', { p_email: email }));
}

// --- Back office (platform admins only; online only, nothing is kept on the phone) ---

export type Tier = 'standard' | 'paid1' | 'paid2' | 'special';
export type AdminOverview = {
  users: number;
  max_users: number;
  signups_open: boolean;
  min_app_version: string;
  message: string;
  labs: number;
  waitlist_pending: number;
  by_tier: Partial<Record<Tier, number>>;
};
export type AdminUser = {
  user_id: string;
  email: string;
  tier: Tier;
  early_access: boolean;
  is_admin: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  labs_owned: number;
  labs_joined: number;
};
export type WaitlistEntry = { id: string; email: string; created_at: string; approved_at: string | null };
export type AuditEntry = { id: number; created_at: string; admin_email: string | null; action: string; target_email: string | null; detail: Record<string, unknown> };
export type FeatureFlag = { key: string; enabled: boolean; early_access_only: boolean; description: string };

export async function amIAdmin(): Promise<boolean> {
  return unwrap<boolean>(await supabase.rpc('am_i_admin'));
}
export async function adminOverview(): Promise<AdminOverview> {
  return unwrap<AdminOverview>(await supabase.rpc('admin_overview'));
}
export async function adminListUsers(search = ''): Promise<AdminUser[]> {
  return unwrap<AdminUser[]>(await supabase.rpc('admin_list_users', { p_search: search }));
}
export async function adminSetTier(userId: string, tier: Tier): Promise<void> {
  unwrap(await supabase.rpc('admin_set_tier', { p_user_id: userId, p_tier: tier }));
}
export async function adminSetEarlyAccess(userId: string, on: boolean): Promise<void> {
  unwrap(await supabase.rpc('admin_set_early_access', { p_user_id: userId, p_on: on }));
}
export async function adminListWaitlist(): Promise<WaitlistEntry[]> {
  return unwrap<WaitlistEntry[]>(await supabase.rpc('admin_list_waitlist'));
}
export async function adminApproveWaitlist(id: string): Promise<void> {
  unwrap(await supabase.rpc('admin_approve_waitlist', { p_id: id }));
}
export async function adminSetSetting(key: 'max_users' | 'signups_open' | 'min_app_version' | 'maintenance_message', value: number | boolean | string): Promise<void> {
  unwrap(await supabase.rpc('admin_set_setting', { p_key: key, p_value: value }));
}
export async function adminAuditLog(limit = 100): Promise<AuditEntry[]> {
  return unwrap<AuditEntry[]>(await supabase.rpc('admin_audit_log', { p_limit: limit }));
}
export async function listFlags(): Promise<FeatureFlag[]> {
  return unwrap<FeatureFlag[]>(await supabase.from('feature_flags').select('*').order('key'));
}
export async function adminSetFlag(key: string, enabled: boolean, earlyAccessOnly: boolean): Promise<void> {
  unwrap(await supabase.rpc('admin_set_flag', { p_key: key, p_enabled: enabled, p_early_access_only: earlyAccessOnly }));
}

// --- Feedback ---------------------------------------------------------------

export type FeedbackKind = 'bug' | 'idea' | 'question';
export type FeedbackRow = {
  id: string;
  created_at: string;
  email: string | null;
  kind: FeedbackKind;
  message: string;
  diagnostics: Record<string, string>;
  status: 'new' | 'done';
  emailed: boolean;
};

/**
 * Saves the message (so it is never lost, and shows in the back-office inbox),
 * then asks the email function to forward it. The email is best effort.
 */
export async function sendFeedback(kind: FeedbackKind, message: string, diagnostics: Record<string, string>): Promise<void> {
  const id = unwrap<string>(await supabase.rpc('send_feedback', { p_kind: kind, p_message: message, p_diagnostics: diagnostics }));
  try {
    await supabase.functions.invoke('send-feedback', { body: { id } });
  } catch {
    // saved either way; the inbox has it
  }
}
export async function adminListFeedback(status: 'new' | 'done' | null = null): Promise<FeedbackRow[]> {
  return unwrap<FeedbackRow[]>(await supabase.rpc('admin_list_feedback', { p_status: status }));
}
export async function adminSetFeedbackStatus(id: string, status: 'new' | 'done'): Promise<void> {
  unwrap(await supabase.rpc('admin_set_feedback_status', { p_id: id, p_status: status }));
}

// --- Your account: export and deletion -----------------------------------------

export async function exportLab(accountId: string): Promise<Record<string, unknown>> {
  return unwrap<Record<string, unknown>>(await supabase.rpc('export_lab', { p_account_id: accountId }));
}
/** When the account will be deleted, if a deletion has been asked for. */
export async function myDeletionRequest(): Promise<{ purge_after: string } | null> {
  const rows = unwrap<{ purge_after: string }[]>(await supabase.from('deletion_requests').select('purge_after').limit(1));
  return rows[0] ?? null;
}
export async function requestAccountDeletion(): Promise<string> {
  return unwrap<string>(await supabase.rpc('request_account_deletion'));
}
export async function cancelAccountDeletion(): Promise<void> {
  unwrap(await supabase.rpc('cancel_account_deletion'));
}

// --- Accounts -------------------------------------------------------------

export async function createAccount(name: string, initials: string): Promise<string> {
  const out = unwrap<string>(await supabase.rpc('create_account', { p_name: name, p_initials: initials }));
  await afterWrite();
  return out;
}

// --- People and labs (owners invite; anyone can join with a code) ----------------

export async function listMembers(accountId: string): Promise<Member[]> {
  return unwrap(
    await supabase.from('members').select('account_id, user_id, role, initials, created_at').eq('account_id', accountId).order('created_at'),
  );
}

/** Invites still waiting to be used (owners only). */
export async function listInvites(accountId: string): Promise<Invite[]> {
  return unwrap(
    await supabase
      .from('invites')
      .select('id, role, created_at, expires_at')
      .eq('account_id', accountId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  );
}

/** Makes a one-time code (ABCD-EFGH) that joins the lab with this role. Shown once. */
export async function inviteMember(accountId: string, role: Role): Promise<{ code: string; expires_at: string }> {
  const rows = unwrap<{ code: string; expires_at: string }[]>(await supabase.rpc('invite_member', { p_account_id: accountId, p_role: role }));
  return rows[0];
}

export async function revokeInvite(id: string): Promise<void> {
  unwrap(await supabase.from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', id));
}

/** Joins the lab the code belongs to; returns its id. */
export async function acceptInvite(code: string, initials: string): Promise<string> {
  return unwrap<string>(await supabase.rpc('accept_invite', { p_code: code, p_initials: initials }));
}

export async function setMemberRole(accountId: string, userId: string, role: Role): Promise<void> {
  unwrap(await supabase.rpc('set_member_role', { p_account_id: accountId, p_user_id: userId, p_role: role }));
}

/** Removes someone (owners), or leaves the lab (yourself). */
export async function removeMember(accountId: string, userId: string): Promise<void> {
  unwrap(await supabase.rpc('remove_member', { p_account_id: accountId, p_user_id: userId }));
}

// --- Shared lineage links -------------------------------------------------------

export type ShareLink = { id: string; created_at: string; expires_at: string; revoked_at: string | null };

/** A read-only link to a strain's tree, for 30 days. Returns the token once. */
export async function createShareLink(strainId: string, days = 30): Promise<{ id: string; token: string; expires_at: string }> {
  const rows = unwrap<{ id: string; token: string; expires_at: string }[]>(
    await supabase.rpc('create_share_link', { p_strain_id: strainId, p_days: days }),
  );
  return rows[0];
}

/** The strain's links that still work. */
export async function listShareLinks(strainId: string): Promise<ShareLink[]> {
  return unwrap(
    await supabase
      .from('share_links')
      .select('id, created_at, expires_at, revoked_at')
      .eq('strain_id', strainId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  );
}

export async function revokeShareLink(id: string): Promise<void> {
  unwrap(await supabase.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id));
}

export type SharedLineage = {
  strain: { name: string; species: string | null };
  expires_at: string;
  tree: { code: string; parent_code: string | null; kind: string; medium: Medium; status: ItemStatus; generation: number; made_on: string; depth: number }[];
};

/** What a shared link shows; works signed out. */
export async function sharedLineage(token: string): Promise<SharedLineage> {
  return unwrap<SharedLineage>(await supabase.rpc('shared_lineage', { p_token: token }));
}

// --- Strains --------------------------------------------------------------

export async function listStrains(): Promise<Strain[]> {
  const local = await localReader();
  if (local) return local.listStrains();
  return unwrap(
    await supabase.from('strains').select('*').eq('account_id', lab()).is('deleted_at', null).order('name'),
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
      .eq('account_id', lab())
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
  // In chunks, so a long list (stats over many cultures) stays within URL limits.
  const out: ColonizationCheck[] = [];
  for (let i = 0; i < itemIds.length; i += 100) {
    out.push(
      ...unwrap<ColonizationCheck[]>(
        await supabase
          .from('colonization_checks')
          .select('id, item_id, checked_on, percent, radius_mm, note, source, created_at')
          .in('item_id', itemIds.slice(i, i + 100))
          .is('deleted_at', null)
          .order('checked_on')
          .order('created_at'),
      ),
    );
  }
  return out.sort((a, b) => a.checked_on.localeCompare(b.checked_on) || a.created_at.localeCompare(b.created_at));
}

// --- Stats ----------------------------------------------------------------------

/** Every transfer and backup made between two dates, for the Stats screen (stats_rows()). */
export async function statsRows(from: string, to: string): Promise<StatsRow[]> {
  const local = await localReader();
  if (local) return local.statsRows(from, to);
  return unwrap(await supabase.rpc('stats_rows', { p_from: from, p_to: to, p_account_id: lab() }));
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
export async function activeBackups(): Promise<BackupWithRefresh[]> {
  const local = await localReader();
  if (local) return local.activeBackups();
  const backups = unwrap<ItemWithRefs[]>(
    await supabase
      .from('items')
      .select('*, strains(name), media_batches(code, sterilization_runs(code))')
      .eq('account_id', lab())
      .is('deleted_at', null)
      .eq('kind', 'backup')
      .eq('status', 'active')
      .order('made_on')
      .order('code'),
  );
  const refreshes: { id: string; code: string; status: string; refresh_of: string }[] = [];
  for (let i = 0; i < backups.length; i += 100) {
    refreshes.push(
      ...unwrap<typeof refreshes>(
        await supabase
          .from('items')
          .select('id, code, status, refresh_of')
          .in('refresh_of', backups.slice(i, i + 100).map((b) => b.id))
          .is('deleted_at', null)
          .order('created_at'),
      ),
    );
  }
  const latest = new Map(refreshes.map((r) => [r.refresh_of, { id: r.id, code: r.code, status: r.status }]));
  return backups.map((b) => ({ ...b, refreshed_by: latest.get(b.id) ?? null }));
}

/** What this culture refreshes, and what refreshed it. */
export async function refreshInfo(itemId: string): Promise<RefreshInfo> {
  const local = await localReader();
  if (local) return local.refreshInfo(itemId);
  const item = unwrap<{ refresh_of: string | null }>(await supabase.from('items').select('refresh_of').eq('id', itemId).single());
  const of = item.refresh_of
    ? unwrap<{ id: string; code: string }>(await supabase.from('items').select('id, code').eq('id', item.refresh_of).single())
    : null;
  const by = unwrap<{ id: string; code: string; status: string }[]>(
    await supabase
      .from('items')
      .select('id, code, status')
      .eq('refresh_of', itemId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
  )[0];
  const checks = by ? (await itemChecks([by.id])).length : 0;
  return { refreshOf: of, refreshedBy: by ? { ...by, checks } : null };
}

/** Refreshes a backup (see refreshPlan()); returns the new culture. */
export async function refreshBackup(backupId: string, madeOn = todayLocal()): Promise<Item> {
  const w = await localWriter();
  if (w) {
    const { ids } = await w.refreshBackup({ backupId, madeOn });
    await syncNow();
    return (await w.readItems(ids))[0];
  }
  const out = unwrap<Item>(await supabase.rpc('refresh_backup', { p_backup_id: backupId, p_made_on: madeOn }));
  await afterWrite();
  return out;
}

/** Days between refreshes for each backup medium, with defaults for any not set. */
export async function backupRefreshDays(): Promise<Record<BackupMedium, number>> {
  const local = await localReader();
  if (local) return refreshDays(await local.backupRefreshSettings());
  const rows = unwrap<{ backup_refresh_days: Record<string, unknown> }[]>(
    await supabase.from('lab_settings').select('backup_refresh_days').eq('account_id', lab()).is('deleted_at', null).limit(1),
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
  return unwrap(await supabase.rpc('lookup_code', { p_query: query, p_account_id: lab() }));
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

const BATCH_SELECT = '*, sterilization_runs(code), recipes(name, version, family_id)';

export async function listRuns(limit = 30): Promise<SterilizationRun[]> {
  const local = await localReader();
  if (local) return local.listRuns(limit);
  return unwrap(
    await supabase
      .from('sterilization_runs')
      .select('*')
      .eq('account_id', lab())
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
    .eq('account_id', lab())
    .is('deleted_at', null)
    .order('made_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q);
}

export async function getRun(id: string): Promise<SterilizationRun> {
  const local = await localReader();
  if (local) return local.getRun(id);
  return unwrap(await supabase.from('sterilization_runs').select('*').eq('id', id).single());
}

export async function getBatch(id: string): Promise<MediaBatch> {
  const local = await localReader();
  if (local) return local.getBatch(id);
  return unwrap(await supabase.from('media_batches').select(BATCH_SELECT).eq('id', id).single());
}

/** Batches sterilized in a run, by code. */
export async function batchesInRun(runId: string): Promise<MediaBatch[]> {
  const local = await localReader();
  if (local) return local.batchesInRun(runId);
  return unwrap(
    await supabase.from('media_batches').select(BATCH_SELECT).eq('sterilization_run_id', runId).is('deleted_at', null).order('code'),
  );
}

/** Cultures made on these batches, newest first. */
export async function itemsOnBatches(batchIds: string[]): Promise<ItemWithRefs[]> {
  if (!batchIds.length) return [];
  const local = await localReader();
  if (local) return local.itemsOnBatches(batchIds);
  const out: ItemWithRefs[] = [];
  for (let i = 0; i < batchIds.length; i += 100) {
    out.push(
      ...unwrap<ItemWithRefs[]>(
        await supabase
          .from('items')
          .select('*, strains(name), media_batches(code, sterilization_runs(code))')
          .in('media_batch_id', batchIds.slice(i, i + 100))
          .is('deleted_at', null),
      ),
    );
  }
  return out.sort((a, b) => (a.made_on !== b.made_on ? (a.made_on < b.made_on ? 1 : -1) : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
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
  return unwrap(await supabase.from('recipes').select('*').eq('account_id', lab()).order('name').order('version'));
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

// --- Technique changes ---------------------------------------------------------
// Saved online (like batches); phones keep a read-only copy for the Stats trend.

/** Technique changes in this lab, oldest first. */
export async function listTechniqueChanges(): Promise<TechniqueChange[]> {
  const local = await localReader();
  if (local) return local.listTechniqueChanges();
  return unwrap(
    await supabase
      .from('technique_changes')
      .select('id, account_id, changed_on, title, note, created_at')
      .eq('account_id', lab())
      .is('deleted_at', null)
      .order('changed_on')
      .order('created_at'),
  );
}

export async function addTechniqueChange(args: {
  accountId: string;
  changedOn: string;
  title: string;
  note?: string;
}): Promise<void> {
  unwrap(
    await supabase.from('technique_changes').insert({
      account_id: args.accountId,
      changed_on: args.changedOn,
      title: args.title.trim(),
      note: args.note?.trim() || null,
    }),
  );
  await afterWrite();
}

/** Removes a technique change (kept in the database with deleted_at set). */
export async function removeTechniqueChange(id: string): Promise<void> {
  unwrap(await supabase.from('technique_changes').update({ deleted_at: new Date().toISOString() }).eq('id', id));
  await afterWrite();
}

// --- Contamination trace ---------------------------------------------------

export async function contaminationTrace(fromDate: string, toDate: string = todayLocal()): Promise<TraceRow[]> {
  return unwrap(await supabase.rpc('contamination_trace', { p_from: fromDate, p_to: toDate, p_account_id: lab() }));
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
      .eq('account_id', lab())
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
