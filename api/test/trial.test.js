import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import request from 'supertest';

import { RagError } from '../src/services/rag/worker.js';
import { createTestContext } from './helpers.js';

let ctx;
beforeEach(async () => {
  ctx = await createTestContext();
});

/** A visitor with their own cookie jar, like one browser. */
const visitor = () => request.agent(ctx.app);

describe('landing-page trial', () => {
  test('three free questions, then a prompt to sign up', async () => {
    const browser = visitor();

    const before = await browser.get('/api/trial');
    const answers = [];
    for (let i = 1; i <= 3; i++) answers.push(await browser.post('/api/trial/ask').send({ question: `Question ${i}?` }));
    const fourth = await browser.post('/api/trial/ask').send({ question: 'One more?' });

    assert.deepEqual(before.body, { limit: 3, used: 0, remaining: 3 });
    assert.deepEqual(answers.map((r) => r.status), [200, 200, 200]);
    assert.deepEqual(answers.map((r) => r.body.trial.remaining), [2, 1, 0]);
    assert.match(answers[0].body.answer, /\[Holt 1894, p\. 40\]/);
    assert.equal(fourth.status, 403);
    assert.equal(fourth.body.error.code, 'trial_exhausted');
    assert.match(fourth.body.error.message, /Create a free account/);
    assert.deepEqual(fourth.body.error.details, { limit: 3, used: 3, remaining: 0 });
    assert.equal(ctx.rag.calls.length, 3);
    assert.deepEqual((await browser.get('/api/trial')).body, { limit: 3, used: 3, remaining: 0 });
  });

  test('the trial cookie is httpOnly and scoped to the trial', async () => {
    const res = await request(ctx.app).post('/api/trial/ask').send({ question: 'Hi?' });

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('lorelai_trial='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Path=\/api\/trial/);
    assert.match(cookie, /SameSite=Lax/);
    const stored = await ctx.db.get('SELECT token_hash, ip_hash FROM trial_sessions');
    assert.ok(!cookie.includes(stored.token_hash)); // only a hash of the token is kept
    assert.match(stored.ip_hash, /^[0-9a-f]{64}$/);
  });

  test('searches the shared library only, with follow-up context', async () => {
    await visitor().post('/api/trial/ask').send({ question: 'And at night?', history: ['How often should a baby eat?'] });

    assert.deepEqual(ctx.rag.calls[0], {
      k: 5, per_book: 2, question: 'And at night?', book_ids: null, history: ['How often should a baby eat?'],
    });
    assert.equal(ctx.rag.calls[0].upload_ids, undefined);
    assert.equal((await ctx.db.get('SELECT channel FROM ask_events')).channel, 'trial');
  });

  test('outages do not use up a free question; refusals do', async () => {
    const browser = visitor();
    ctx.rag.respond = async () => { throw new RagError('pipeline_unavailable', 'starting'); };
    const outage = await browser.post('/api/trial/ask').send({ question: 'Q?' });
    ctx.rag.respond = async () => ({ status: 'error', error: 'refusal', answer: "I can't help with that question.", citations: [] });
    const refusal = await browser.post('/api/trial/ask').send({ question: 'Q?' });

    assert.equal(outage.status, 503);
    assert.equal(outage.body.trial.remaining, 3);
    assert.equal(refusal.status, 200);
    assert.equal(refusal.body.trial.remaining, 2);
  });

  test('clearing cookies does not reset the trial past the per-network cap', async () => {
    const capped = await createTestContext({ TRIAL_IP_DAILY_LIMIT: '4' });
    const ask = (agent) => agent.post('/api/trial/ask').send({ question: 'Q?' });
    const first = request.agent(capped.app);
    for (let i = 0; i < 3; i++) await ask(first);

    const fresh = request.agent(capped.app); // same IP, new cookie
    const allowed = await ask(fresh);
    const blocked = await ask(fresh);

    assert.equal(allowed.status, 200);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'trial_ip_limit');
  });

  test('validates the question and ignores forged cookies', async () => {
    const empty = await visitor().post('/api/trial/ask').send({ question: '  ' });
    const tooMuchHistory = await visitor().post('/api/trial/ask').send({ question: 'Q?', history: ['a', 'b', 'c'] });
    const forged = await request(ctx.app).post('/api/trial/ask').set('Cookie', 'lorelai_trial=../../etc').send({ question: 'Q?' });

    assert.equal(empty.status, 400);
    assert.equal(tooMuchHistory.status, 400);
    assert.equal(forged.status, 200);
    assert.ok(forged.headers['set-cookie'].some((c) => c.startsWith('lorelai_trial=')));
  });

  test('a worker bad_request gives the question back', async () => {
    const browser = visitor();
    ctx.rag.respond = async () => { throw new RagError('bad_request', 'nope'); };

    const res = await browser.post('/api/trial/ask').send({ question: 'Q?' });

    assert.equal(res.status, 400);
    assert.equal((await browser.get('/api/trial')).body.remaining, 3);
  });
});
