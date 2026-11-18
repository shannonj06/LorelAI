import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { bearer, createTestContext, PASSWORD, PDF_BYTES, until } from './helpers.js';

let ctx;
let admin;
let user;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.createAdmin('admin@example.com');
  user = await ctx.signUp('member@example.com');
});

const asAdmin = (method, path) => ctx.api()[method](path).set(bearer(admin));

describe('access control', () => {
  test('admin endpoints require the admin role', async () => {
    const paths = ['/api/admin/stats', '/api/admin/users', '/api/admin/activity', '/api/admin/uploads', '/api/admin/audit-log', '/api/admin/pipeline'];
    for (const path of paths) {
      assert.equal((await ctx.api().get(path)).status, 401, path);
      assert.equal((await ctx.api().get(path).set(bearer(user))).status, 403, path);
      assert.equal((await ctx.api().get(path).set(bearer(admin))).status, 200, path);
    }
  });

  test('a demoted admin loses access immediately', async () => {
    const second = await ctx.createAdmin('second@example.com');
    await asAdmin('patch', `/api/admin/users/${second.user.id}`).send({ role: 'user' });

    const res = await ctx.api().get('/api/admin/stats').set(bearer(second));

    assert.equal(res.status, 401); // role change ends existing sessions
  });
});

describe('users', () => {
  test('lists and searches users', async () => {
    await ctx.signUp('another@example.com');

    const all = await asAdmin('get', '/api/admin/users');
    const search = await asAdmin('get', '/api/admin/users?search=MEMBER');
    const admins = await asAdmin('get', '/api/admin/users?role=admin');
    const wildcard = await asAdmin('get', '/api/admin/users?search=%25');

    assert.equal(all.body.total, 3);
    assert.deepEqual(search.body.items.map((u) => u.email), ['member@example.com']);
    assert.deepEqual(admins.body.items.map((u) => u.email), ['admin@example.com']);
    assert.equal(wildcard.body.total, 0); // % is matched literally, not as a wildcard
    assert.equal(all.body.items[0].passwordHash, undefined);
  });

  test('shows one user with activity', async () => {
    await ctx.api().post('/api/ask').set(bearer(user)).send({ question: 'Feeding?' });

    const res = await asAdmin('get', `/api/admin/users/${user.user.id}`);
    const missing = await asAdmin('get', '/api/admin/users/9999');

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'member@example.com');
    assert.equal(res.body.activity.questions.total, 1);
    assert.equal(res.body.activity.activeSessions, 1);
    assert.equal(missing.status, 404);
  });

  test('promotes a user to admin', async () => {
    const res = await asAdmin('patch', `/api/admin/users/${user.user.id}`).send({ role: 'admin' });
    const relogin = (await ctx.api().post('/api/auth/signin').send({ email: 'member@example.com', password: PASSWORD })).body;

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'admin');
    assert.equal((await ctx.api().get('/api/admin/stats').set(bearer(relogin))).status, 200);
  });

  test('disabling a user locks them out at once and blocks sign-in', async () => {
    const res = await asAdmin('patch', `/api/admin/users/${user.user.id}`).send({ isActive: false });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.isActive, false);
    assert.equal((await ctx.api().get('/api/auth/me').set(bearer(user))).status, 401);
    assert.equal((await ctx.api().post('/api/auth/refresh').send({ refreshToken: user.refreshToken })).status, 401);
    const signin = await ctx.api().post('/api/auth/signin').send({ email: 'member@example.com', password: PASSWORD });
    assert.equal(signin.status, 403);
    assert.equal(signin.body.error.code, 'account_disabled');

    await asAdmin('patch', `/api/admin/users/${user.user.id}`).send({ isActive: true });
    const after = await ctx.api().post('/api/auth/signin').send({ email: 'member@example.com', password: PASSWORD });
    assert.equal(after.status, 200);
  });

  test('admins cannot demote, disable or delete themselves', async () => {
    const demote = await asAdmin('patch', `/api/admin/users/${admin.user.id}`).send({ role: 'user' });
    const disable = await asAdmin('patch', `/api/admin/users/${admin.user.id}`).send({ isActive: false });
    const remove = await asAdmin('delete', `/api/admin/users/${admin.user.id}`);
    const rename = await asAdmin('patch', `/api/admin/users/${admin.user.id}`).send({ displayName: 'Boss' });

    for (const res of [demote, disable, remove]) {
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'self_modification');
    }
    assert.equal(rename.status, 200);
  });

  test('validates updates', async () => {
    const empty = await asAdmin('patch', `/api/admin/users/${user.user.id}`).send({});
    const badRole = await asAdmin('patch', `/api/admin/users/${user.user.id}`).send({ role: 'superuser' });
    const badId = await asAdmin('patch', '/api/admin/users/abc').send({ role: 'user' });
    const missing = await asAdmin('patch', '/api/admin/users/9999').send({ role: 'user' });

    assert.equal(empty.status, 400);
    assert.equal(badRole.status, 400);
    assert.equal(badId.status, 400);
    assert.equal(missing.status, 404);
  });

  test('deletes a user with their saved chats and uploaded books', async () => {
    const answer = (await ctx.api().post('/api/ask').set(bearer(user)).send({ question: 'Feeding?' })).body;
    await ctx.api().post('/api/chats').set(bearer(user))
      .send({ messages: [{ role: 'user', content: 'Feeding?' }, { role: 'assistant', content: answer.answer, response: answer }] });
    const upload = await ctx.api().post('/api/uploads?title=Mine').set(bearer(user))
      .set('Content-Type', 'application/pdf').send(PDF_BYTES);
    await until(async () => (await ctx.db.get('SELECT status FROM user_books')).status === 'ready');

    const res = await asAdmin('delete', `/api/admin/users/${user.user.id}`);

    assert.equal(res.status, 204);
    assert.equal((await asAdmin('get', `/api/admin/users/${user.user.id}`)).status, 404);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM chats')).n, 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM user_books')).n, 0);
    assert.deepEqual(ctx.rag.deletes.map((d) => d.book_id), [upload.body.upload.id]);
    // Usage stats survive, detached from the deleted account
    assert.equal((await ctx.db.get('SELECT user_id FROM ask_events')).user_id, null);
  });

  test('revokes all of a user’s sessions', async () => {
    const res = await asAdmin('post', `/api/admin/users/${user.user.id}/revoke-sessions`);

    assert.equal(res.status, 204);
    assert.equal((await ctx.api().get('/api/auth/me').set(bearer(user))).status, 401);
    assert.equal((await ctx.api().post('/api/auth/refresh').send({ refreshToken: user.refreshToken })).status, 401);
  });
});

describe('activity, stats and audit log', () => {
  test('activity shows usage across users and the trial, never question text', async () => {
    const other = await ctx.signUp('other@example.com');
    await ctx.api().post('/api/ask').set(bearer(user)).send({ question: 'From member?' });
    await ctx.api().post('/api/ask').set(bearer(other)).send({ question: 'From other?' });
    await ctx.api().post('/api/trial/ask').send({ question: 'From a visitor?' });

    const all = await asAdmin('get', '/api/admin/activity');
    const filtered = await asAdmin('get', `/api/admin/activity?userId=${user.user.id}`);
    const trial = await asAdmin('get', '/api/admin/activity?channel=trial');

    assert.equal(all.body.total, 3);
    assert.deepEqual(filtered.body.items.map((e) => [e.userEmail, e.channel, e.citations]), [['member@example.com', 'app', 2]]);
    assert.deepEqual(trial.body.items.map((e) => [e.userId, e.channel]), [[null, 'trial']]);
    assert.ok(!JSON.stringify(all.body).includes('From member'));
  });

  test('lists uploads across readers', async () => {
    await ctx.api().post('/api/uploads?title=Mine').set(bearer(user)).set('Content-Type', 'application/pdf').send(PDF_BYTES);

    const res = await asAdmin('get', '/api/admin/uploads');

    assert.deepEqual(res.body.items.map((u) => [u.title, u.userEmail]), [['Mine', 'member@example.com']]);
  });

  test('stats count users, questions by status, and pipeline state', async () => {
    await ctx.api().post('/api/ask').set(bearer(user)).send({ question: 'One?' });
    ctx.rag.respond = async () => ({ status: 'error', error: 'service_unavailable', answer: 'Unavailable.', citations: [] });
    await ctx.api().post('/api/ask').set(bearer(user)).send({ question: 'Two?' });

    const res = await asAdmin('get', '/api/admin/stats');

    assert.deepEqual(res.body.users, { total: 2, active: 2, admins: 1 });
    assert.equal(res.body.questions.total, 2);
    assert.equal(res.body.questions.last24h, 2);
    assert.deepEqual(res.body.questions.byStatus, { answered: 1, partial: 0, insufficient: 0, error: 1 });
    assert.deepEqual(res.body.questions.errorsByCode, { service_unavailable: 1 });
    assert.equal(res.body.questions.errorRate, 0.5);
    assert.deepEqual(res.body.questions.byChannel, { app: 2, trial: 0 });
    assert.deepEqual(res.body.questions.tokens, { input: 3000, output: 400 });
    assert.deepEqual(res.body.questions.byModel, { 'google/gemma-4-26b-a4b-it:free': 1 });
    assert.deepEqual(res.body.uploads, { total: 0, byStatus: { processing: 0, ready: 0, failed: 0 } });
    assert.deepEqual(res.body.savedChats, { chats: 0, messages: 0 });
    assert.equal(res.body.pipeline.state, 'ready');
  });

  test('admin changes are written to the audit log', async () => {
    await asAdmin('patch', `/api/admin/users/${user.user.id}`).send({ role: 'admin' });
    await asAdmin('post', '/api/admin/pipeline/restart');

    const res = await asAdmin('get', '/api/admin/audit-log');

    assert.deepEqual(res.body.items.map((e) => e.action), ['pipeline.restart', 'user.update', 'admin.bootstrap']);
    const update = res.body.items[1];
    assert.equal(update.actorEmail, 'admin@example.com');
    assert.equal(update.targetId, user.user.id);
    assert.deepEqual(update.details.changes, { role: 'admin' });
    assert.equal(update.details.before.role, 'user');
  });

  test('pipeline status and restart', async () => {
    const status = await asAdmin('get', '/api/admin/pipeline');
    const restart = await asAdmin('post', '/api/admin/pipeline/restart');

    assert.equal(status.body.state, 'ready');
    assert.equal(restart.status, 202);
    assert.equal(ctx.rag.restarts, 1);
  });
});
