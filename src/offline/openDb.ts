import type { SqlDb } from './sql';

/**
 * Web: no local copy. The web dashboard reads Supabase directly (decided in
 * docs/design/offline-mode.md). Phones use openDb.native.ts.
 */
export async function openLocalDb(): Promise<SqlDb | null> {
  return null;
}
