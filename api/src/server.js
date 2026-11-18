import { existsSync } from 'node:fs';
import path from 'node:path';

import { createApp } from './app.js';
import { ensureAdmin } from './bootstrap.js';
import { loadConfig, loadEnvFile } from './config.js';
import { openDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createLogger } from './logger.js';
import * as refreshTokens from './repositories/refreshTokens.js';
import { createPasswordHasher } from './services/passwords.js';
import { createRag } from './services/rag/worker.js';
import { recoverInterruptedUploads } from './services/uploads.js';

loadEnvFile();
const config = loadConfig();
const logger = createLogger(config.logLevel);

if (config.auth.jwtSecretIsEphemeral) {
  logger.warn('JWT_SECRET is not set: using a random secret, so sessions end when the server restarts. Set it in api/.env.');
}

const db = openDatabase(config.databasePath);
const applied = await migrate(db);
logger.info(`Database ready at ${config.databasePath}${applied.length ? ` (applied ${applied.join(', ')})` : ''}`);
logger.info(`Removed ${await refreshTokens.deleteExpired(db)} expired refresh tokens`);

await recoverInterruptedUploads({ db, config, logger });

const rag = createRag(config, logger);
rag.start();

const app = createApp({ config, db, rag, logger });

if (config.admin.email) {
  try {
    const passwords = createPasswordHasher({ cost: config.auth.scryptCost });
    const { action, user } = await ensureAdmin(db, passwords, { ...config.admin, onlyIfNoAdmin: true });
    if (action !== 'skipped') logger.info(`Admin bootstrap: ${action} ${user.email}`);
  } catch (error) {
    logger.error(`Admin bootstrap failed: ${error.message}`);
  }
}

const server = app.listen(config.port, config.host, () => {
  const site = existsSync(path.join(config.frontendDist ?? '', 'index.html'))
    ? 'serving the site and API'
    : 'API only (build lorel-ai-frontend to serve the site too)';
  logger.info(`LorelAI listening on http://${config.host}:${config.port}, ${site}`);
});
server.on('error', (error) => {
  logger.error(`Could not start the HTTP server: ${error.message}`);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  server.close();
  await rag.stop();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
