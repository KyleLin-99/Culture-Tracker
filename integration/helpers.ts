// Phones for integration tests: an empty local database with the app's schema.
import { migrate } from '@/offline/schema';
import type { SqlDb } from '@/offline/sql';
import { openTestDb } from '@/offline/testing/sqljsDb';

export * from './supabaseTest';

export async function newPhone(): Promise<SqlDb & { close(): void }> {
  const db = await openTestDb();
  await migrate(db);
  return db;
}
