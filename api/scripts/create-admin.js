// Create an admin account, or promote an existing user to admin.
//
//   npm run create-admin -- --email you@example.com --password "a long password"
//   npm run create-admin -- --email existing-user@example.com
//
// The password can come from ADMIN_PASSWORD instead (keeps it out of shell history).
// Safe to run while the server is running.
import { parseArgs } from 'node:util';

import { ensureAdmin } from '../src/bootstrap.js';
import { loadConfig, loadEnvFile } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createPasswordHasher } from '../src/services/passwords.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, password: { type: 'string' } } });
loadEnvFile();
const config = loadConfig();
const email = values.email ?? config.admin.email;
const password = values.password ?? config.admin.password;

if (!email) {
  console.error('Usage: npm run create-admin -- --email you@example.com [--password "..."]');
  process.exit(1);
}

const db = openDatabase(config.databasePath);
try {
  await migrate(db);
  const { action, user } = await ensureAdmin(db, createPasswordHasher({ cost: config.auth.scryptCost }), {
    email,
    password,
  });
  const messages = {
    created: `Created admin account ${user.email}.`,
    promoted: `Promoted ${user.email} to admin. Their existing sessions were signed out.`,
    unchanged: `${user.email} is already an admin.`,
  };
  console.log(messages[action]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
