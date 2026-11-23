import { useSyncExternalStore } from 'react';

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'error';

export type SyncStatus = {
  /** off: no local copy (web, or not signed in). */
  state: SyncState;
  /** When the local copy last matched the server (ISO time). */
  lastSyncedAt: string | null;
  message: string | null;
};

let status: SyncStatus = { state: 'off', lastSyncedAt: null, message: null };
const listeners = new Set<() => void>();

export function setSyncStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when sync status changes. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus);
}

/** Network failures look different on phones and in browsers. */
export function isNetworkError(e: unknown): boolean {
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return /network request failed|failed to fetch|fetch failed|network error|load failed/i.test(msg);
}

/** "just now", "4 min ago", "2 h ago", "3 days ago" */
export function ago(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
