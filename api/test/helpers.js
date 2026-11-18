import os from 'node:os';
import path from 'node:path';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { silentLogger } from '../src/logger.js';
import { createPasswordHasher } from '../src/services/passwords.js';
import { RagError } from '../src/services/rag/worker.js';

export const PASSWORD = 'correct horse battery';

export const BOOKS = [
  { book_id: 'chavasse_1878', title: 'Advice to a Mother', author: 'Pye Henry Chavasse', year: 1878, chunks: 780 },
  { book_id: 'holt_1894', title: 'The Care and Feeding of Children', author: 'L. Emmett Holt', year: 1894, chunks: 232 },
];

/** What rag_worker.py returns for a question where two books differ. */
export const WORKER_ANSWER = {
  status: 'answered',
  answer:
    'One book advises feeding every three hours. [Holt 1894, p. 40] Another advises every two hours. [Chavasse 1878, p. 12]\n\n' +
    'The books differ: They give different intervals. [Holt 1894, p. 40; Chavasse 1878, p. 12]',
  citations: [
    {
      id: 'S1', label: 'Holt 1894, p. 40', book_id: 'holt_1894', title: 'The Care and Feeding of Children',
      author: 'L. Emmett Holt', year: 1894, page: 40, chunk_id: 'holt_1894_p40_c0', text: 'feed every three hours',
    },
    {
      id: 'S2', label: 'Chavasse 1878, p. 12', book_id: 'chavasse_1878', title: 'Advice to a Mother',
      author: 'Pye Henry Chavasse', year: 1878, page: 12, chunk_id: 'chavasse_1878_p12_c0', text: 'every two hours',
    },
  ],
  statements: [
    { text: 'One book advises feeding every three hours.', citation_ids: ['S1'] },
    { text: 'Another advises every two hours.', citation_ids: ['S2'] },
  ],
  conflicts: [{ summary: 'They give different intervals.', citation_ids: ['S1', 'S2'] }],
  not_covered: [],
  error: null,
  usage: { input_tokens: 3000, output_tokens: 400 },
  model: 'google/gemma-4-26b-a4b-it:free',
  cached: false,
  retrieval: { passages: 6, books: ['chavasse_1878', 'holt_1894'] },
  timing_ms: { retrieval: 40, generation: 5000 },
};

/**
 * A stand-in for RagWorker. Set fake.respond to change what ask() does, and
 * fake.ingestResponse (a function returning a promise) to control uploads.
 */
export function createFakeRag() {
  const fake = {
    calls: [],
    ingests: [],
    deletes: [],
    restarts: 0,
    state: 'ready',
    respond: async () => WORKER_ANSWER,
    ingestResponse: async () => ({ book_id: 'x', pages: 12, text_pages: 12, chunks: 40 }),
    async ask(params) {
      fake.calls.push(params);
      return fake.respond(params);
    },
    async books() {
      if (fake.state !== 'ready') throw new RagError('pipeline_unavailable', 'starting');
      return BOOKS;
    },
    async ingest(params) {
      fake.ingests.push(params);
      return fake.ingestResponse(params);
    },
    async deleteBook(params) {
      fake.deletes.push(params);
      return { book_id: params.book_id, deleted_passages: 40 };
    },
    status: () => ({ state: fake.state, restarts: fake.restarts, inFlight: 0, llm: { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free', keySet: true } }),
    async restart() {
      fake.restarts += 1;
    },
    async stop() {},
  };
  return fake;
}

/** A small valid-looking PDF body for upload tests (the fake pipeline never parses it). */
export const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

/** Wait until condition() is true (for background work like upload ingestion). */
export async function until(condition, timeoutMs = 3000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    DATABASE_PATH: ':memory:',
    SCRYPT_COST: '10', // fast hashing for tests
    AUTH_RATE_LIMIT: '0',
    ASK_RATE_LIMIT_PER_HOUR: '0',
    TRIAL_RATE_LIMIT_PER_HOUR: '0',
    UPLOAD_RATE_LIMIT_PER_HOUR: '0',
    UPLOADS_DIR: path.join(os.tmpdir(), `lorelai-test-uploads-${process.pid}`),
    FRONTEND_DIST: path.join(os.tmpdir(), 'lorelai-no-frontend-here'),
    ...overrides,
  });
}

/** A fresh app with an in-memory database and a fake pipeline. */
export async function createTestContext(configOverrides) {
  const config = testConfig(configOverrides);
  const db = openDatabase(':memory:');
  await migrate(db);
  const rag = createFakeRag();
  const app = createApp({ config, db, rag, logger: silentLogger });
  const passwords = createPasswordHasher({ cost: config.auth.scryptCost });

  const context = {
    config,
    db,
    rag,
    app,
    api: () => request(app),

    async signUp(email = `user${Math.random().toString(36).slice(2, 8)}@example.com`, password = PASSWORD) {
      const res = await request(app).post('/api/auth/signup').send({ email, password });
      if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    },

    async createAdmin(email = 'admin@example.com', password = PASSWORD) {
      await ensureAdmin(db, passwords, { email, password });
      const res = await request(app).post('/api/auth/signin').send({ email, password });
      return res.body;
    },
  };
  return context;
}

export const bearer = (session) => ({ Authorization: `Bearer ${session.accessToken}` });
