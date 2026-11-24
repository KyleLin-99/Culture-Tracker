import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';

import { daysAgoLocal } from '@/domain/cultureCode';
import { supabase } from '@/lib/supabase';

import { openLocalDb } from './openDb';
import { dismissFailed, failedChanges, flush, pendingCount, type FailedChange } from './outbox';
import { localQueries, type LocalQueries } from './queries';
import { createRemote } from './remote';
import { createWriteRemote } from './remoteWrite';
import { clearAll, getMeta, migrate } from './schema';
import type { SqlDb } from './sql';
import { isNetworkError, setSyncStatus } from './status';
import { pull } from './sync';
import { localWriter as makeWriter, type LocalWriter } from './writer';

// Keeps the phone's copy of the lab in step with Supabase, and decides whether
// reads can come from it. Decisions: docs/design/offline-mode.md.

/** First pull keeps a year of history (plus every active culture and its ancestry). */
export const HISTORY_DAYS = 365;
const SYNC_EVERY_MS = 2 * 60 * 1000;
const supabaseRemote = createRemote(supabase);
const supabaseWrite = createWriteRemote(supabase);

let dbPromise: Promise<SqlDb | null> | null = null;
let accountId: string | null = null;
let initials = '';
let canWrite = true;
/** The local copy holds a complete first pull for the signed-in lab. */
let ready = false;
let syncing: Promise<void> | null = null;

function localDb(): Promise<SqlDb | null> {
  dbPromise ??= openLocalDb()
    .then(async (db) => {
      if (db) await migrate(db);
      return db;
    })
    .catch((e) => {
      console.warn('Offline copy unavailable', e);
      return null;
    });
  return dbPromise;
}

async function refreshCounts(db: SqlDb): Promise<void> {
  setSyncStatus({ pending: await pendingCount(db), failed: (await failedChanges(db)).length });
}

async function syncOnce(): Promise<void> {
  const db = await localDb();
  const acct = accountId;
  if (!db || !acct) return;
  setSyncStatus({ state: 'syncing', message: null });
  try {
    // Send this phone's changes first, so a pull never brings back older versions of them.
    if (ready) {
      const sent = await flush(db, supabaseWrite);
      await refreshCounts(db);
      if (sent.offline) {
        setSyncStatus({ state: 'offline' });
        return;
      }
    }
    await pull(db, supabaseRemote, { accountId: acct, historyFrom: daysAgoLocal(HISTORY_DAYS) });
    if (acct === accountId) ready = true;
    await refreshCounts(db);
    setSyncStatus({ state: 'synced', lastSyncedAt: new Date().toISOString(), message: null });
  } catch (e) {
    setSyncStatus(
      isNetworkError(e)
        ? { state: 'offline', message: null }
        : { state: 'error', message: e instanceof Error ? e.message : String(e) },
    );
  }
}

/**
 * Sends queued changes, then pulls. If a sync is already running, waits for it
 * and runs again, so a change queued just now is always included. Never throws.
 */
export async function syncNow(): Promise<void> {
  while (syncing) await syncing;
  syncing = syncOnce();
  try {
    await syncing;
  } finally {
    syncing = null;
  }
}

/**
 * Starts syncing for a signed-in lab: now, when the app comes to the
 * foreground, when the connection returns, and every 2 minutes.
 * Returns a function that stops it. Does nothing on web.
 */
export async function startSync(lab: string, memberInitials: string, memberCanWrite = true): Promise<() => void> {
  accountId = lab;
  initials = memberInitials;
  canWrite = memberCanWrite;
  const db = await localDb();
  if (!db) return () => {};

  ready = (await getMeta(db, 'account_id')) === lab && (await getMeta(db, 'first_pull_done')) !== null;
  setSyncStatus({ state: ready ? 'synced' : 'syncing', lastSyncedAt: ready ? await getMeta(db, 'last_synced_at') : null });
  await refreshCounts(db);
  void syncNow();

  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncNow();
  });
  let wasOnline = true;
  const net = NetInfo.addEventListener((s) => {
    const online = s.isConnected !== false && s.isInternetReachable !== false;
    if (online && !wasOnline) void syncNow();
    if (!online) setSyncStatus({ state: 'offline' });
    wasOnline = online;
  });
  const timer = setInterval(() => void syncNow(), SYNC_EVERY_MS);

  return () => {
    app.remove();
    net();
    clearInterval(timer);
    if (accountId === lab) accountId = null;
    ready = false;
    setSyncStatus({ state: 'off' });
  };
}

/** Reads from the phone's copy once it's complete; null means ask the server. */
export async function localReader(): Promise<LocalQueries | null> {
  if (!ready) return null;
  const db = await localDb();
  return db ? localQueries(db) : null;
}

/** After a write succeeds on the server, bring the copy up to date before screens re-read it. */
export async function afterWrite(): Promise<void> {
  if (ready) await syncNow();
}

/**
 * Makes changes on the phone (queued for the server) once the local copy is
 * complete; null means write to the server directly (web, or first sync not done).
 */
export async function localWriter(): Promise<LocalWriter | null> {
  if (!ready) return null;
  const db = await localDb();
  if (!db) return null;
  return makeWriter({ db, newId: () => Crypto.randomUUID(), now: () => new Date().toISOString(), initials, canWrite });
}

/** Changes the server refused, for the home screen. Empty on web. */
export async function listFailedChanges(): Promise<FailedChange[]> {
  const db = ready ? await localDb() : null;
  return db ? failedChanges(db) : [];
}

export async function dismissFailedChange(seq: number): Promise<void> {
  const db = await localDb();
  if (!db) return;
  await dismissFailed(db, seq);
  await refreshCounts(db);
}

/**
 * Changes made on this phone that haven't reached the server yet. Switching labs
 * clears the phone's copy (queue included), so it waits until this is 0.
 */
export async function unsentChangeCount(): Promise<number> {
  const db = await localDb();
  return db ? pendingCount(db) : 0;
}

/** Signing out removes the lab from the phone. */
export async function clearLocalCopy(): Promise<void> {
  const db = await localDb();
  ready = false;
  if (db) await clearAll(db);
}
