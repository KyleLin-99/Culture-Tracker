// sql.js (SQLite compiled to WebAssembly) behind the SqlDb interface, for Jest.
import initSqlJs from 'sql.js';

import type { SqlDb, SqlParam } from '../sql';

export async function openTestDb(): Promise<SqlDb & { close(): void }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('pragma foreign_keys = off');

  const all = async <T,>(sql: string, params: SqlParam[] = []): Promise<T[]> => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };

  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      db.run(sql, params);
    },
    all,
    first: async <T,>(sql: string, params: SqlParam[] = []) => (await all<T>(sql, params))[0] ?? null,
    transaction: async (fn) => {
      db.exec('begin');
      try {
        await fn();
        db.exec('commit');
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
    close: () => db.close(),
  };
}
