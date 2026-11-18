import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SQLite extended result codes for constraint violations
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;

/** Timestamps are stored as UTC ISO-8601 strings; they sort and compare correctly as text. */
export const timestamp = (date = new Date()) => date.toISOString();

function toParams(params) {
  // node:sqlite binds numbers, strings, bigints, buffers and null, but not booleans or undefined
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

function normalizeError(error) {
  if (error?.errcode === SQLITE_CONSTRAINT_UNIQUE || error?.errcode === SQLITE_CONSTRAINT_PRIMARYKEY) {
    error.isUniqueViolation = true;
  }
  return error;
}

/**
 * Open the SQLite database behind a small async interface:
 *
 *   get(sql, params)  -> first row or null
 *   all(sql, params)  -> rows
 *   run(sql, params)  -> { changes, lastInsertId }
 *   exec(sql)         -> runs one or more statements (migrations)
 *   transaction(fn)   -> runs fn(tx) atomically; tx has the same methods
 *
 * Repositories only use this interface with portable SQL and `?` placeholders,
 * so moving to MySQL means reimplementing this file with mysql2/promise (a pool,
 * plus a dedicated connection per transaction), not rewriting the repositories.
 *
 * node:sqlite is synchronous, so a transaction is atomic as long as fn only awaits
 * database calls. Don't await network I/O inside a transaction.
 */
export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL;');

  const statements = new Map();
  const prepare = (sql) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = sqlite.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const attempt = (fn) => {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }
  };

  let inTransaction = false;
  const db = {
    dialect: 'sqlite',
    get: (sql, params = []) => attempt(() => prepare(sql).get(...toParams(params)) ?? null),
    all: (sql, params = []) => attempt(() => prepare(sql).all(...toParams(params))),
    run: (sql, params = []) =>
      attempt(() => {
        const result = prepare(sql).run(...toParams(params));
        return { changes: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
      }),
    exec: (sql) => attempt(() => sqlite.exec(sql)),
    async transaction(fn) {
      if (inTransaction) return fn(db); // nested calls join the outer transaction
      sqlite.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = await fn(db);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    async ping() {
      prepare('SELECT 1 AS ok').get();
      return true;
    },
    async close() {
      sqlite.close();
    },
  };
  return db;
}
