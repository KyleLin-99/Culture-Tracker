import { describe, expect, it } from '@jest/globals';

import { ago, getSyncStatus, isNetworkError, setSyncStatus } from '../status';

describe('isNetworkError', () => {
  it('recognises failed requests on phones and in browsers', () => {
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'TypeError: fetch failed' })).toBe(true);
  });
  it('leaves database errors alone', () => {
    expect(isNetworkError({ message: 'Culture code X would be 21 characters; the limit is 20' })).toBe(false);
  });
});

describe('ago', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  it('describes how long since the last sync', () => {
    expect(ago(null, now)).toBe('never');
    expect(ago('2026-11-23T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-11-23T11:56:00Z', now)).toBe('4 min ago');
    expect(ago('2026-11-23T09:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-11-22T11:00:00Z', now)).toBe('1 day ago');
    expect(ago('2026-11-20T11:00:00Z', now)).toBe('3 days ago');
  });
});

describe('sync status store', () => {
  it('merges updates', () => {
    setSyncStatus({ state: 'synced', lastSyncedAt: '2026-11-23T12:00:00Z' });
    setSyncStatus({ state: 'offline' });
    expect(getSyncStatus()).toMatchObject({ state: 'offline', lastSyncedAt: '2026-11-23T12:00:00Z' });
  });
});
