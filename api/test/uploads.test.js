import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, test } from 'node:test';

import { RagError } from '../src/services/rag/worker.js';
import { bearer, createTestContext, PASSWORD, PDF_BYTES, until } from './helpers.js';

let ctx;
let session;
beforeEach(async () => {
  ctx = await createTestContext();
  session = await ctx.signUp('reader@example.com');
});

const upload = (query = 'title=Teething%20Without%20Tears&author=Jane%20Writer&year=2004', body = PDF_BYTES, who = session) =>
  ctx.api().post(`/api/uploads?${query}`).set(bearer(who)).set('Content-Type', 'application/pdf').send(body);
const statusOf = async (id) => (await ctx.db.get('SELECT status FROM user_books WHERE id = ?', [id]))?.status;

describe('uploads', () => {
  test('a PDF is accepted, indexed in the background, then ready', async () => {
    let finish;
    ctx.rag.ingestResponse = () => new Promise((resolve) => { finish = resolve; });

    const res = await upload();

    assert.equal(res.status, 202);
    const { id } = res.body.upload;
    assert.match(id, /^up_[0-9a-f]{12}$/);
    assert.equal(res.body.upload.status, 'processing');
    assert.equal(res.body.upload.title, 'Teething Without Tears');
    assert.equal(res.body.upload.sizeBytes, PDF_BYTES.length);

    const [ingest] = ctx.rag.ingests;
    assert.deepEqual(
      { ...ingest, path: path.basename(ingest.path) },
      { path: `${id}.pdf`, book_id: id, title: 'Teething Without Tears', author: 'Jane Writer', year: 2004, owner_id: String(session.user.id) },
    );
    assert.ok(existsSync(ingest.path));

    finish({ book_id: id, pages: 210, text_pages: 205, chunks: 640 });
    await until(async () => (await statusOf(id)) === 'ready');
    const detail = await ctx.api().get(`/api/uploads/${id}`).set(bearer(session));
    assert.deepEqual([detail.body.upload.pages, detail.body.upload.chunks], [210, 640]);
    // The PDF itself isn't kept once its text is indexed
    await until(() => !existsSync(ingest.path));
  });

  test('a scanned PDF fails with a message the reader can act on', async () => {
    ctx.rag.ingestResponse = async () => {
      throw new RagError('unprocessable', "It looks like a scan. Scanned books need OCR, which isn't supported yet.", 'no_text');
    };

    const { id } = (await upload()).body.upload;

    await until(async () => (await statusOf(id)) === 'failed');
    const list = await ctx.api().get('/api/uploads').set(bearer(session));
    assert.match(list.body.items[0].error, /OCR/);
    assert.deepEqual(list.body.limits, { maxBytes: 25 * 1024 * 1024, maxPerUser: 5 });
  });

  test('a pipeline restart mid-processing is reported plainly', async () => {
    ctx.rag.ingestResponse = async () => {
      throw new RagError('pipeline_unavailable', 'worker exited');
    };

    const { id } = (await upload()).body.upload;

    await until(async () => (await statusOf(id)) === 'failed');
    const row = await ctx.db.get('SELECT error FROM user_books WHERE id = ?', [id]);
    assert.match(row.error, /upload it again/);
  });

  test('rejects files that are not PDFs, missing titles and oversized files', async () => {
    const notPdf = await upload(undefined, Buffer.from('just some text, not a pdf'));
    const wrongType = await ctx.api().post('/api/uploads?title=x').set(bearer(session))
      .set('Content-Type', 'text/plain').send('hello');
    const noTitle = await upload('author=Someone');
    const badYear = await upload('title=X&year=99999');

    assert.equal(notPdf.status, 415);
    assert.equal(wrongType.status, 415);
    assert.equal(noTitle.status, 400);
    assert.equal(badYear.status, 400);

    const small = await createTestContext({ UPLOAD_MAX_MB: '1' });
    const reader = await small.signUp('small@example.com');
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(1024 * 1024 + 10)]);
    const tooBig = await small.api().post('/api/uploads?title=Big').set(bearer(reader))
      .set('Content-Type', 'application/pdf').send(big);
    assert.equal(tooBig.status, 413);
    assert.equal(ctx.rag.ingests.length, 0);
  });

  test('requires sign-in, and books are private to their owner', async () => {
    const anonymous = await ctx.api().post('/api/uploads?title=X').set('Content-Type', 'application/pdf').send(PDF_BYTES);
    const { id } = (await upload()).body.upload;
    const other = await ctx.signUp('other@example.com');

    assert.equal(anonymous.status, 401);
    assert.equal((await ctx.api().get(`/api/uploads/${id}`).set(bearer(other))).status, 404);
    assert.equal((await ctx.api().delete(`/api/uploads/${id}`).set(bearer(other))).status, 404);
    assert.deepEqual((await ctx.api().get('/api/uploads').set(bearer(other))).body.items, []);
  });

  test('deleting removes the passages and the record; not while processing', async () => {
    let finish;
    ctx.rag.ingestResponse = () => new Promise((resolve) => { finish = resolve; });
    const { id } = (await upload()).body.upload;

    const early = await ctx.api().delete(`/api/uploads/${id}`).set(bearer(session));
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'still_processing');

    finish({ pages: 1, chunks: 2 });
    await until(async () => (await statusOf(id)) === 'ready');
    const res = await ctx.api().delete(`/api/uploads/${id}`).set(bearer(session));

    assert.equal(res.status, 204);
    assert.deepEqual(ctx.rag.deletes, [{ book_id: id, owner_id: String(session.user.id) }]);
    assert.equal(await statusOf(id), undefined);
  });

  test('a reader can keep a limited number of books; failed ones do not count', async () => {
    const limited = await createTestContext({ UPLOAD_MAX_PER_USER: '1' });
    const reader = await limited.signUp('one@example.com');
    const send = () => limited.api().post('/api/uploads?title=X').set(bearer(reader))
      .set('Content-Type', 'application/pdf').send(PDF_BYTES);
    limited.rag.ingestResponse = async () => { throw new RagError('unprocessable', 'scan', 'no_text'); };

    const failed = (await send()).body.upload.id;
    await until(async () => (await limited.db.get('SELECT status FROM user_books WHERE id = ?', [failed])).status === 'failed');
    limited.rag.ingestResponse = async () => ({ pages: 1, chunks: 1 });
    assert.equal((await send()).status, 202);
    const third = await send();

    assert.equal(third.status, 409);
    assert.equal(third.body.error.code, 'upload_limit');
  });

  test("deleting an account removes its uploaded books' passages", async () => {
    const { id } = (await upload()).body.upload;
    await until(async () => (await statusOf(id)) === 'ready');

    const res = await ctx.api().delete('/api/auth/me').set(bearer(session)).send({ password: PASSWORD });

    assert.equal(res.status, 204);
    assert.deepEqual(ctx.rag.deletes.map((d) => d.book_id), [id]);
    assert.equal(await statusOf(id), undefined);
  });
});
