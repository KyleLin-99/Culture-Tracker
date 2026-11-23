import * as SQLite from 'expo-sqlite';

import type { SqlDb } from './sql';

/** The phone's local database (expo-sqlite). */
export async function openLocalDb(): Promise<SqlDb | null> {
  const db = await SQLite.openDatabaseAsync('culture-tracker.db');
  await db.execAsync('pragma journal_mode = wal');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      await db.runAsync(sql, params);
    },
    all: (sql, params = []) => db.getAllAsync(sql, params),
    first: (sql, params = []) => db.getFirstAsync(sql, params),
    transaction: (fn) => db.withTransactionAsync(fn),
  };
}
