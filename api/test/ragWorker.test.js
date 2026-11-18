import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RagError, RagWorker } from '../src/services/rag/worker.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-rag-worker.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let worker;
afterEach(async () => {
  await worker?.stop({ graceMs: 1000 });
  worker = null;
});

function startWorker(mode = 'normal', options = {}) {
  worker = new RagWorker({ command: process.execPath, args: [FAKE, mode], requestTimeoutMs: 2000, readyWaitMs: 3000, ...options });
  worker.start();
  return worker;
}

async function until(condition, timeoutMs = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await sleep(20);
  }
}

describe('RagWorker', () => {
  test('waits for ready, then answers requests', async () => {
    startWorker('normal', { env: { FAKE_STARTUP_MS: '200' } });
    assert.equal(worker.status().state, 'starting');

    const result = await worker.ask({ question: 'hello' });

    assert.equal(result.answer, 'echo: hello');
    const status = worker.status();
    assert.equal(status.state, 'ready');
    assert.equal(status.books, 1);
    assert.equal(status.chunks, 232);
    assert.ok(status.pid);
  });

  test('matches concurrent responses to their requests', async () => {
    startWorker();

    const answers = await Promise.all([
      worker.ask({ question: 'wait:150' }),
      worker.ask({ question: 'wait:10' }),
      worker.ask({ question: 'wait:80' }),
    ]);

    assert.deepEqual(answers.map((a) => a.answer), ['echo: wait:150', 'echo: wait:10', 'echo: wait:80']);
    assert.equal(worker.status().inFlight, 0);
  });

  test('serves the book catalog from the ready event', async () => {
    startWorker();

    const books = await worker.books();

    assert.equal(books[0].book_id, 'holt_1894');
  });

  test('passes worker errors through with their code', async () => {
    startWorker();

    await assert.rejects(worker.ask({ question: 'bad' }), (error) => error instanceof RagError && error.code === 'bad_request');
  });

  test('times out a request that never gets an answer', async () => {
    startWorker('normal', { requestTimeoutMs: 200 });

    await assert.rejects(worker.ask({ question: 'silent' }), { code: 'pipeline_timeout' });
    assert.equal(worker.status().inFlight, 0);
    // The worker is still usable
    assert.equal((await worker.ask({ question: 'after' })).answer, 'echo: after');
  });

  test('a crash fails in-flight requests and the worker restarts', async () => {
    startWorker();
    const firstPid = (await worker.ask({ question: 'one' })).pid;

    const pending = worker.ask({ question: 'wait:2000' });
    const crash = worker.ask({ question: 'crash' });

    await assert.rejects(pending, { code: 'pipeline_unavailable' });
    await assert.rejects(crash, { code: 'pipeline_unavailable' });
    // A request made while restarting waits for the new process
    const after = await worker.ask({ question: 'two' });
    assert.notEqual(after.pid, firstPid);
    assert.equal(worker.status().restarts, 1);
  });

  test('reports a startup failure and keeps retrying with backoff', async () => {
    startWorker('fatal', { readyWaitMs: 300 });

    await assert.rejects(worker.ask({ question: 'x' }), { code: 'pipeline_unavailable' });
    await until(() => worker.status().restarts >= 2);
    assert.match(worker.status().lastError, /No module named chromadb/);
    assert.notEqual(worker.status().state, 'ready');
  });

  test('a missing Python executable is reported, not thrown', async () => {
    worker = new RagWorker({ command: 'definitely-not-a-real-python-xyz', args: [], readyWaitMs: 300 });
    worker.start();

    await assert.rejects(worker.ask({ question: 'x' }), { code: 'pipeline_unavailable' });
    assert.match(worker.status().lastError, /Could not run "definitely-not-a-real-python-xyz"/);
  });

  test('restart() replaces the process right away', async () => {
    startWorker();
    const firstPid = (await worker.ask({ question: 'one' })).pid;

    await worker.restart();
    const after = await worker.ask({ question: 'two' });

    assert.notEqual(after.pid, firstPid);
  });

  test('stop() shuts the worker down and rejects new requests', async () => {
    startWorker();
    await worker.ask({ question: 'one' });

    await worker.stop();

    assert.equal(worker.status().state, 'stopped');
    await assert.rejects(worker.ask({ question: 'two' }), { code: 'pipeline_unavailable' });
  });
});
