// End-to-end check against a running server (start it first with `npm start`).
//
//   npm run smoke                  trial question, sign-up, ask, save a chat, refresh/rotation, clean up
//   npm run smoke -- --skip-ask    everything except model calls
//
// Each question is one model call (the free OpenRouter tier allows ~50 a day).
// With ADMIN_EMAIL and ADMIN_PASSWORD set (env or api/.env), it also checks the admin endpoints.
// API_URL defaults to http://127.0.0.1:4000.
import { parseArgs } from 'node:util';

import { loadEnvFile } from '../src/config.js';

loadEnvFile();
const { values: args } = parseArgs({
  options: {
    'skip-ask': { type: 'boolean', default: false },
    question: { type: 'string', default: 'Is it good to rock a baby to sleep?' },
  },
});
const BASE = process.env.API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`;

async function call(method, path, { token, body, expect = [200], cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}, expected ${expect.join('/')}: ${text.slice(0, 400)}`);
  }
  return { status: response.status, data, headers: response.headers };
}

const ok = (message) => console.log(`  ✓ ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printAnswer(data) {
  console.log(`\n  status "${data.status}"${data.error ? `, error ${data.error.code}` : ''}`);
  console.log(`  ${data.answer.replace(/\n/g, '\n  ')}\n`);
  for (const citation of data.citations) console.log(`    [${citation.id}] ${citation.label}: ${citation.title}`);
  console.log(`  (${data.meta.latencyMs} ms, model ${data.meta.model ?? '-'}${data.meta.cached ? ', cached' : ''})\n`);
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  let health;
  for (let i = 0; i < 60; i++) {
    health = (await call('GET', '/api/health')).data;
    if (args['skip-ask'] || health.pipeline.state === 'ready') break;
    await sleep(2000);
  }
  ok(`health: ${health.status}, database ${health.database}, pipeline ${health.pipeline.state}, model ${health.pipeline.model}`);

  if (health.pipeline.state === 'ready') {
    const { data } = await call('GET', '/api/books');
    ok(`library: ${data.books.map((b) => `${b.author} (${b.year})`).join('; ')}`);
  }

  // Landing-page trial (no account)
  const trialStatus = (await call('GET', '/api/trial')).data;
  ok(`trial: ${trialStatus.remaining}/${trialStatus.limit} free questions for a new visitor`);
  if (!args['skip-ask']) {
    console.log(`\n  Trial question: "${args.question}"...`);
    const trial = await call('POST', '/api/trial/ask', { body: { question: args.question }, expect: [200, 502, 503, 504] });
    printAnswer(trial.data);
    if (trial.status !== 200) throw new Error(`The pipeline returned an error: ${trial.data.error?.code}`);
    ok(`trial answer with ${trial.data.citations.length} citations; ${trial.data.trial.remaining} free questions left`);
  }

  // Account
  const email = `smoke-${Date.now()}@example.com`;
  const password = 'smoke-test-password';
  await call('POST', '/api/auth/signup', { body: { email, password, displayName: 'Smoke Test' }, expect: [201] });
  ok(`signed up ${email}`);
  await call('POST', '/api/auth/signup', { body: { email, password }, expect: [409] });
  ok('duplicate sign-up rejected (409)');
  await call('POST', '/api/auth/signin', { body: { email, password: 'wrong-password' }, expect: [401] });
  ok('wrong password rejected (401)');
  let session = (await call('POST', '/api/auth/signin', { body: { email, password } })).data;
  ok('signed in');
  await call('GET', '/api/auth/me', { expect: [401] });
  ok('/me without a token rejected (401)');

  if (!args['skip-ask']) {
    const asked = await call('POST', '/api/ask', { token: session.accessToken, body: { question: args.question }, expect: [200, 502, 503, 504] });
    if (asked.status !== 200) throw new Error(`The pipeline returned an error: ${asked.data.error?.code}`);
    ok(`ask: ${asked.data.citations.length} citations${asked.data.meta.cached ? ' (served from cache)' : ''}`);
    const answer = asked.data;

    const saved = await call('POST', '/api/chats', {
      token: session.accessToken,
      body: { messages: [{ role: 'user', content: args.question }, { role: 'assistant', content: answer.answer, response: answer }] },
      expect: [201],
    });
    ok(`saved chat #${saved.data.chat.id} "${saved.data.chat.title}"`);
    const list = (await call('GET', '/api/chats', { token: session.accessToken })).data;
    if (list.items[0]?.id !== saved.data.chat.id) throw new Error('The saved chat is missing from the list');
    await call('DELETE', `/api/chats/${saved.data.chat.id}`, { token: session.accessToken, expect: [204] });
    ok('unsaved it again (deleted)');
  }

  const refreshed = (await call('POST', '/api/auth/refresh', { body: { refreshToken: session.refreshToken } })).data;
  ok('refreshed session');
  await call('POST', '/api/auth/refresh', { body: { refreshToken: session.refreshToken }, expect: [401] });
  ok('old refresh token rejected after rotation (401)');
  await call('POST', '/api/auth/refresh', { body: { refreshToken: refreshed.refreshToken }, expect: [401] });
  ok('token reuse revoked the session family (401)');
  session = (await call('POST', '/api/auth/signin', { body: { email, password } })).data;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    console.log('');
    await call('GET', '/api/admin/stats', { token: session.accessToken, expect: [403] });
    ok('admin endpoints rejected for a regular user (403)');
    const admin = (await call('POST', '/api/auth/signin', { body: { email: adminEmail, password: adminPassword } })).data;
    const stats = (await call('GET', '/api/admin/stats', { token: admin.accessToken })).data;
    ok(`admin stats: ${stats.users.total} users, ${stats.questions.total} questions, pipeline ${stats.pipeline.state}`);
    const found = (await call('GET', `/api/admin/users?search=${encodeURIComponent(email)}`, { token: admin.accessToken })).data;
    const userId = found.items[0].id;
    await call('PATCH', `/api/admin/users/${userId}`, { token: admin.accessToken, body: { isActive: false } });
    await call('GET', '/api/auth/me', { token: session.accessToken, expect: [401, 403] });
    ok('disabled user is locked out immediately');
    await call('DELETE', `/api/admin/users/${userId}`, { token: admin.accessToken, expect: [204] });
    ok('admin deleted the smoke-test user');
  } else {
    await call('DELETE', '/api/auth/me', { token: session.accessToken, body: { password }, expect: [204] });
    ok('deleted the smoke-test account (set ADMIN_EMAIL/ADMIN_PASSWORD to also test admin endpoints)');
  }

  console.log('\nSmoke test passed.');
}

main().catch((error) => {
  console.error(`\nSmoke test FAILED: ${error.message}`);
  process.exit(1);
});
