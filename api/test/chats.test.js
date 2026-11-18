import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { bearer, createTestContext } from './helpers.js';

let ctx;
let session;
beforeEach(async () => {
  ctx = await createTestContext();
  session = await ctx.signUp('reader@example.com');
});

const api = (method, path, who = session) => ctx.api()[method](path).set(bearer(who));

async function unsavedConversation() {
  const first = (await api('post', '/api/ask').send({ question: 'How often should a baby eat?' })).body;
  return [
    { role: 'user', content: 'How often should a baby eat?' },
    { role: 'assistant', content: first.answer, response: first },
  ];
}

describe('saved chats', () => {
  test('chats are not stored until saved', async () => {
    await api('post', '/api/ask').send({ question: 'How often should a baby eat?' });

    const res = await api('get', '/api/chats');

    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.limit, 50);
  });

  test('saving keeps the conversation so far, with its citations', async () => {
    const messages = await unsavedConversation();

    const saved = await api('post', '/api/chats').send({ messages });

    assert.equal(saved.status, 201);
    assert.equal(saved.body.chat.title, 'How often should a baby eat?');
    assert.deepEqual(saved.body.messages.map((m) => m.role), ['user', 'assistant']);
    assert.equal(saved.body.messages[1].response.citations[0].label, 'Holt 1894, p. 40');
    const list = await api('get', '/api/chats');
    assert.deepEqual(list.body.items.map((c) => [c.title, c.messageCount]), [['How often should a baby eat?', 2]]);
  });

  test('later questions in a saved chat are appended to it', async () => {
    const { chat } = (await api('post', '/api/chats').send({ messages: await unsavedConversation() })).body;

    const res = await api('post', '/api/ask').send({ question: 'And at night?', chatId: chat.id, history: ['How often should a baby eat?'] });
    const detail = await api('get', `/api/chats/${chat.id}`);

    assert.equal(res.body.chatId, chat.id);
    assert.ok(res.body.messageId);
    assert.deepEqual(detail.body.messages.map((m) => m.content.slice(0, 13)), [
      'How often sho', 'One book advi', 'And at night?', 'One book advi',
    ]);
    assert.equal(detail.body.messages[3].response.question, 'And at night?');
    assert.equal((await ctx.db.get('SELECT saved FROM ask_events ORDER BY id DESC')).saved, 1);
  });

  test('failed answers are not appended', async () => {
    const { chat } = (await api('post', '/api/chats').send({ messages: [] })).body;
    ctx.rag.respond = async () => ({ status: 'error', error: 'service_unavailable', answer: 'Unavailable.', citations: [] });

    const res = await api('post', '/api/ask').send({ question: 'Hello?', chatId: chat.id });

    assert.equal(res.status, 503);
    assert.equal((await api('get', `/api/chats/${chat.id}`)).body.messages.length, 0);
  });

  test('rename and unsave', async () => {
    const { chat } = (await api('post', '/api/chats').send({ title: 'Feeding', messages: await unsavedConversation() })).body;

    const renamed = await api('patch', `/api/chats/${chat.id}`).send({ title: '  Night feeds  ' });
    const removed = await api('delete', `/api/chats/${chat.id}`);

    assert.equal(renamed.body.chat.title, 'Night feeds');
    assert.equal(removed.status, 204);
    assert.equal((await api('get', `/api/chats/${chat.id}`)).status, 404);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM chat_messages')).n, 0);
  });

  test("chats are private to their owner", async () => {
    const { chat } = (await api('post', '/api/chats').send({ messages: await unsavedConversation() })).body;
    const other = await ctx.signUp('other@example.com');

    assert.equal((await api('get', `/api/chats/${chat.id}`, other)).status, 404);
    assert.equal((await api('patch', `/api/chats/${chat.id}`, other).send({ title: 'mine' })).status, 404);
    assert.equal((await api('delete', `/api/chats/${chat.id}`, other)).status, 404);
    assert.equal((await api('post', '/api/ask', other).send({ question: 'Hi?', chatId: chat.id })).status, 404);
    assert.deepEqual((await api('get', '/api/chats', other)).body.items, []);
  });

  test('validates messages and enforces the saved-chat limit', async () => {
    const tooLong = await api('post', '/api/chats').send({ messages: [{ role: 'user', content: 'x'.repeat(1001) }] });
    const badRole = await api('post', '/api/chats').send({ messages: [{ role: 'system', content: 'hi' }] });
    const huge = await api('post', '/api/chats').send({
      messages: [{ role: 'assistant', content: 'a', response: { blob: 'x'.repeat(100_001) } }],
    });
    assert.equal(tooLong.status, 400);
    assert.equal(badRole.status, 400);
    assert.equal(huge.status, 400);

    const limited = await createTestContext({ MAX_SAVED_CHATS: '1' });
    const reader = await limited.signUp('limited@example.com');
    const save = () => limited.api().post('/api/chats').set(bearer(reader)).send({ title: 'x', messages: [] });
    assert.equal((await save()).status, 201);
    const second = await save();
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'chat_limit');
  });
});
