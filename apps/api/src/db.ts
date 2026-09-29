import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

dotenv.config({ path: process.env.ENV_FILE ?? '../../.env' });

const filename = resolve(process.env.DATABASE_PATH ?? 'data/lakuenta.sqlite');
mkdirSync(dirname(filename), { recursive: true });

export const db = new Database(filename);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(readFileSync(resolve('sql/001-init.sql'), 'utf8'));

export type QueryResult<T> = { rows: T[]; rowCount: number };

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): QueryResult<T> {
  const statement = db.prepare(sql);
  if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    const rows = statement.all(...params) as T[];
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(...params);
  return { rows: [], rowCount: Number(result.changes) };
}
