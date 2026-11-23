import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { daysAgoLocal } from '@/domain/cultureCode';

import { openLocalDb } from './openDb';
import { localQueries, type LocalQueries } from './queries';
import { supabaseRemote } from './remote';
import { clearAll, getMeta, migrate } from './schema';
import type { SqlDb } from './sql';
import { isNetworkError, setSyncStatus } from './status';
import { pull } from './sync';

// Keeps the phone's copy of the lab in step with Supabase, and decides whether
// reads can come from it. Decisions: docs/design/offline-mode.md.

/** First pull keeps a year of history (plus every active culture and its ancestry). */
export const HISTORY_DAYS = 365;
const SYNC_EVERY_MS = 2 * 60 * 1000;

let dbPromise: Promise<SqlDb | null> | null = null;
let accountId: string | null = null;
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

/** Pulls changes now. Concurrent calls share one pull. Never throws. */
export function syncNow(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    const db = await localDb();
    const acct = accountId;
    if (!db || !acct) return;
    setSyncStatus({ state: 'syncing', message: null });
    try {
      await pull(db, supabaseRemote, { accountId: acct, historyFrom: daysAgoLocal(HISTORY_DAYS) });
      if (acct === accountId) ready = true;
      setSyncStatus({ state: 'synced', lastSyncedAt: new Date().toISOString(), message: null });
    } catch (e) {
      setSyncStatus(
        isNetworkError(e)
          ? { state: 'offline', message: null }
          : { state: 'error', message: e instanceof Error ? e.message : String(e) },
      );
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/**
 * Starts syncing for a signed-in lab: now, when the app comes to the
 * foreground, when the connection returns, and every 2 minutes.
 * Returns a function that stops it. Does nothing on web.
 */
export async function startSync(lab: string): Promise<() => void> {
  accountId = lab;
  const db = await localDb();
  if (!db) return () => {};

  ready = (await getMeta(db, 'account_id')) === lab && (await getMeta(db, 'first_pull_done')) !== null;
  setSyncStatus({ state: ready ? 'synced' : 'syncing', lastSyncedAt: ready ? await getMeta(db, 'last_synced_at') : null });
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

/** Signing out removes the lab from the phone. */
export async function clearLocalCopy(): Promise<void> {
  const db = await localDb();
  ready = false;
  if (db) await clearAll(db);
}
