import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timestamp } from './index.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Apply db/migrations/*.sql in filename order, each once, each in a transaction.
 * Returns the versions applied by this call.
 */
export async function migrate(db, dir = MIGRATIONS_DIR) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((row) => row.version));
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();

  const newlyApplied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, timestamp()]);
    });
    newlyApplied.push(version);
  }
  return newlyApplied;
}
