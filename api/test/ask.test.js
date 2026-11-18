import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { RagError } from '../src/services/rag/worker.js';
import { bearer, createTestContext, PDF_BYTES, until, WORKER_ANSWER } from './helpers.js';

let ctx;
let session;
beforeEach(async () => {
  ctx = await createTestContext();
  session = await ctx.signUp('asker@example.com');
});

const ask = (body, who = session) => ctx.api().post('/api/ask').set(bearer(who)).send(body);
const count = async (table) => (await ctx.db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;

describe('POST /api/ask', () => {
  test('returns {answer, citations[]} with [Book, p.X] references and multi-book conflicts', async () => {
    const res = await ask({ question: '  How often should a 3-month-old eat?  ' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'answered');
    assert.equal(res.body.question, 'How often should a 3-month-old eat?');
    assert.match(res.body.answer, /\[Holt 1894, p\. 40\]/);
    assert.match(res.body.answer, /The books differ: .* \[Holt 1894, p\. 40; Chavasse 1878, p\. 12\]/);
    assert.equal(res.body.error, null);
    assert.deepEqual(res.body.citations[0], {
      id: 'S1',
      label: 'Holt 1894, p. 40',
      bookId: 'holt_1894',
      title: 'The Care and Feeding of Children',
      author: 'L. Emmett Holt',
      year: 1894,
      chapter: null,
      page: 40,
      chunkId: 'holt_1894_p40_c0',
      text: 'feed every three hours',
      source: 'library',
      score: null,
    });
    assert.deepEqual(res.body.statements[1], { text: 'Another advises every two hours.', citationIds: ['S2'] });
    assert.deepEqual(res.body.conflicts, [{ summary: 'They give different intervals.', citationIds: ['S1', 'S2'] }]);
    assert.deepEqual(res.body.notCovered, []);
    assert.deepEqual(res.body.meta.booksRetrieved, ['chavasse_1878', 'holt_1894']);
    assert.equal(res.body.meta.passagesRetrieved, 6);
    assert.equal(res.body.meta.model, 'google/gemma-4-26b-a4b-it:free');
    assert.equal(res.body.meta.cached, false);
    assert.equal(typeof res.body.meta.latencyMs, 'number');
    assert.equal(res.body.chatId, null);
  });

  test('an unsaved question leaves no content behind, only a usage event', async () => {
    await ask({ question: 'A private question about my child?' });

    assert.equal(await count('chat_messages'), 0);
    const event = await ctx.db.get('SELECT * FROM ask_events');
    assert.equal(event.channel, 'app');
    assert.equal(event.status, 'answered');
    assert.equal(event.citations, 2);
    assert.equal(event.books_cited, 2);
    assert.equal(event.input_tokens, 3000);
    assert.equal(event.saved, 0);
    const everything = JSON.stringify(await ctx.db.all('SELECT * FROM ask_events'));
    assert.ok(!everything.includes('private question'));
  });

  test('passes the question, books, history and owner to the pipeline', async () => {
    await ask({ question: 'Weaning?' });
    await ask({ question: 'And at night?', books: ['holt_1894'], perBook: 3, history: ['Weaning?'] });

    assert.deepEqual(ctx.rag.calls, [
      { k: 5, question: 'Weaning?', per_book: 2, book_ids: null, owner_id: String(session.user.id), upload_ids: [], history: [] },
      { k: 5, question: 'And at night?', per_book: 3, book_ids: ['holt_1894'], owner_id: String(session.user.id), upload_ids: [], history: ['Weaning?'] },
    ]);
  });

  test("searches the reader's ready uploads, and only theirs", async () => {
    const upload = await ctx.api().post('/api/uploads?title=My%20Book').set(bearer(session))
      .set('Content-Type', 'application/pdf').send(PDF_BYTES);
    const id = upload.body.upload.id;
    await until(async () => (await ctx.db.get('SELECT status FROM user_books WHERE id = ?', [id])).status === 'ready');
    const other = await ctx.signUp('other@example.com');

    await ask({ question: 'Everything?' });
    await ask({ question: 'Only mine?', books: [id] });
    const stolen = await ask({ question: 'Theirs?', books: [id] }, other);

    assert.deepEqual(ctx.rag.calls[0].upload_ids, [id]);
    assert.deepEqual([ctx.rag.calls[1].book_ids, ctx.rag.calls[1].upload_ids], [[], [id]]);
    assert.equal(stolen.status, 400);
    assert.equal(ctx.rag.calls.length, 2);
  });

  test('requires sign-in', async () => {
    const res = await ctx.api().post('/api/ask').send({ question: 'Hello?' });

    assert.equal(res.status, 401);
    assert.equal(ctx.rag.calls.length, 0);
  });

  test('validates the request', async () => {
    const bad = [
      {},
      { question: '   ' },
      { question: 'x'.repeat(1001) },
      { question: 'ok', books: [] },
      { question: 'ok', books: ['Not A Book!'] },
      { question: 'ok', perBook: 9 },
      { question: 'ok', history: ['a', 'b', 'c', 'd', 'e'] },
      { question: 'ok', chatId: 'abc' },
      { question: 'ok', extra: true },
    ];
    for (const body of bad) {
      const res = await ask(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(ctx.rag.calls.length, 0);
  });

  test('unknown books are a 400 and nothing is recorded', async () => {
    const res = await ask({ question: 'Feeding?', books: ['nope_1900'] });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /nope_1900/);
    assert.equal(await count('ask_events'), 0);
  });

  test('a worker bad_request is a 400 and is not recorded', async () => {
    ctx.rag.respond = async () => {
      throw new RagError('bad_request', 'history must be a list');
    };

    const res = await ask({ question: 'Feeding?' });

    assert.equal(res.status, 400);
    assert.equal(await count('ask_events'), 0);
  });

  test('partial and insufficient answers are normal 200 responses', async () => {
    ctx.rag.respond = async () => ({ ...WORKER_ANSWER, status: 'partial', not_covered: ['water temperature'] });
    const partial = await ask({ question: 'Bath age and water temperature?' });

    ctx.rag.respond = async () => ({
      status: 'insufficient', answer: "I couldn't find enough information...", citations: [], statements: [],
      conflicts: [], not_covered: [], error: null, retrieval: { passages: 0, books: [] },
    });
    const insufficient = await ask({ question: 'Best car seat?' });

    assert.equal(partial.status, 200);
    assert.deepEqual(partial.body.notCovered, ['water temperature']);
    assert.equal(insufficient.status, 200);
    assert.equal(insufficient.body.status, 'insufficient');
    assert.deepEqual(insufficient.body.citations, []);
  });

  test('pipeline errors map to HTTP statuses and keep a user-facing message', async () => {
    const cases = [
      [{ status: 'error', error: 'service_unavailable', answer: 'The answer service is temporarily unavailable.' }, 503, 'service_unavailable'],
      [{ status: 'error', error: 'service_error', answer: 'Something went wrong.' }, 502, 'service_error'],
      [{ status: 'error', error: 'invalid_output', answer: "I couldn't produce a reliably cited answer." }, 502, 'invalid_output'],
      [{ status: 'error', error: 'refusal', answer: "I can't help with that question." }, 200, 'refusal'],
      [new RagError('pipeline_unavailable', 'starting'), 503, 'pipeline_unavailable'],
      [new RagError('pipeline_timeout', 'slow'), 504, 'pipeline_timeout'],
      [new RagError('internal_error', 'KeyError'), 502, 'internal_error'],
    ];
    for (const [outcome, httpStatus, code] of cases) {
      ctx.rag.respond = async () => {
        if (outcome instanceof Error) throw outcome;
        return { citations: [], statements: [], conflicts: [], not_covered: [], ...outcome };
      };
      const res = await ask({ question: `case ${code}` });
      assert.equal(res.status, httpStatus, code);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.error.code, code);
      assert.ok(res.body.answer.length > 10);
      assert.equal(res.body.error.message, res.body.answer);
      assert.deepEqual(res.body.citations, []);
    }
    const errors = await ctx.db.get("SELECT COUNT(*) AS n FROM ask_events WHERE status = 'error'");
    assert.equal(errors.n, cases.length);
  });

  test('is 503 when the library list is needed but the pipeline is starting', async () => {
    ctx.rag.state = 'starting';

    const res = await ask({ question: 'Feeding?', books: ['holt_1894'] });

    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'pipeline_unavailable');
  });

  test('questions are rate limited per user', async () => {
    const limited = await createTestContext({ ASK_RATE_LIMIT_PER_HOUR: '2' });
    const alice = await limited.signUp('alice@example.com');
    const bob = await limited.signUp('bob@example.com');
    const askAs = (who) => limited.api().post('/api/ask').set(bearer(who)).send({ question: 'Feeding?' });

    const statuses = [(await askAs(alice)).status, (await askAs(alice)).status, (await askAs(alice)).status];
    const bobStatus = (await askAs(bob)).status;

    assert.deepEqual(statuses, [200, 200, 429]);
    assert.equal(bobStatus, 200);
  });
});

describe('GET /api/books', () => {
  test('lists the library without sign-in', async () => {
    const res = await ctx.api().get('/api/books');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.books[1], {
      id: 'holt_1894', title: 'The Care and Feeding of Children', author: 'L. Emmett Holt', year: 1894, chunks: 232,
    });
  });

  test('is 503 while the pipeline starts', async () => {
    ctx.rag.state = 'starting';

    const res = await ctx.api().get('/api/books');

    assert.equal(res.status, 503);
  });
});
