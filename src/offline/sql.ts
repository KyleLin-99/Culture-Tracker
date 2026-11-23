// The small slice of SQLite the offline code needs. On phones it's backed by
// expo-sqlite (openDb.native.ts); in tests by sql.js (testing/sqljsDb.ts), so
// sync and queries run in Jest exactly as they do on the device.

export type SqlParam = string | number | null;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  /** Runs `fn` in one transaction: all of its writes land, or none do. */
  transaction(fn: () => Promise<void>): Promise<void>;
}
