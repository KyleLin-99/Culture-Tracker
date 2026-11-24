// The phone's pull against Supabase must name the lab it syncs. Bug: someone in
// two labs got both labs on their phone, because row-level security allows every
// lab you belong to and `changed` never filtered by account_id.
import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createRemote } from '../remote';

/** A stand-in for the Supabase query builder that records each call. */
function recordingClient() {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'order', 'range', 'gt', 'gte', 'or', 'in']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('createRemote().changed', () => {
  it.each(['strains', 'items', 'events', 'lab_settings'] as const)('asks only for the synced lab\'s %s', async (table) => {
    const { client, calls } = recordingClient();
    await createRemote(client).changed(table, { accountId: 'acct-1', since: null, historyFrom: '2025-11-23', offset: 0, limit: 500 });
    expect(calls).toContainEqual(['from', table]);
    expect(calls).toContainEqual(['eq', 'account_id', 'acct-1']);
  });

  it('keeps the lab filter on later pulls too', async () => {
    const { client, calls } = recordingClient();
    await createRemote(client).changed('items', { accountId: 'acct-2', since: '2026-11-20T00:00:00Z', historyFrom: null, offset: 500, limit: 500 });
    expect(calls).toContainEqual(['eq', 'account_id', 'acct-2']);
    expect(calls).toContainEqual(['gt', 'updated_at', '2026-11-20T00:00:00Z']);
  });
});
