import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { silentLogger } from '../../logger.js';

/**
 * Errors from the pipeline. code is one of:
 *   pipeline_unavailable  worker not running, still starting, or stopped mid-request
 *   pipeline_timeout      no response within the request timeout
 *   bad_request           the worker rejected the parameters (e.g. unknown book ID)
 *   unprocessable         an uploaded PDF couldn't be ingested; reason says why (e.g. no_text)
 *   internal_error        the worker hit an unexpected exception
 */
export class RagError extends Error {
  constructor(code, message, reason = null) {
    super(message);
    this.name = 'RagError';
    this.code = code;
    this.reason = reason;
  }
}

// Keeps the Python side's output to protocol messages and real warnings
const WORKER_ENV = {
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8',
  TQDM_DISABLE: '1',
  HF_HUB_DISABLE_PROGRESS_BARS: '1',
  HF_HUB_VERBOSITY: 'error',
  TRANSFORMERS_VERBOSITY: 'error',
  TOKENIZERS_PARALLELISM: 'false',
  ANONYMIZED_TELEMETRY: 'False',
};

/**
 * Runs backend/rag_worker.py as a long-lived child process and talks to it over
 * stdin/stdout, one JSON message per line (protocol documented in rag_worker.py).
 *
 * - The embedding model loads once, when the worker starts.
 * - Requests are matched to responses by ID, so many can be in flight at once.
 * - If the worker exits, in-flight requests fail with pipeline_unavailable and the
 *   worker is restarted with exponential backoff.
 *
 * To run the pipeline as a separate service later (e.g. FastAPI on another host),
 * replace this class with an HTTP client exposing the same ask/books/status/
 * restart/stop methods. Nothing else in the API needs to change.
 */
export class RagWorker {
  #child = null;
  #pending = new Map();
  #nextId = 0;
  #state = 'stopped';
  #stopping = false;
  #restartTimer = null;
  #restartImmediately = false;
  #consecutiveFailures = 0;
  #restarts = 0;
  #startedAt = null;
  #readyAt = null;
  #lastError = null;
  #books = null;
  #chunks = null;
  #llm = null;
  #ready = null;

  constructor({
    command,
    args = [],
    cwd,
    env = {},
    requestTimeoutMs = 120_000,
    ingestTimeoutMs = 15 * 60_000,
    readyWaitMs = 30_000,
    maxRestartDelayMs = 30_000,
    logger = silentLogger,
  }) {
    Object.assign(this, {
      command, args, cwd, env, requestTimeoutMs, ingestTimeoutMs, readyWaitMs, maxRestartDelayMs, logger,
    });
    this.#resetReady();
  }

  start() {
    if (this.#child || this.#restartTimer) return;
    this.#stopping = false;
    this.#spawn();
  }

  ask(params) {
    return this.#request('ask', params, this.requestTimeoutMs);
  }

  /** Index an uploaded PDF: {path, book_id, title, author?, year?, owner_id}. Can take minutes for a long book. */
  ingest(params) {
    return this.#request('ingest', params, this.ingestTimeoutMs);
  }

  /** Remove an uploaded book's passages: {book_id, owner_id}. */
  deleteBook(params) {
    return this.#request('delete_book', params, 60_000);
  }

  /** The book catalog, as reported by the worker when it became ready. */
  async books() {
    if (this.#books) return this.#books;
    return this.#request('books', {}, 15_000);
  }

  status() {
    return {
      state: this.#state,
      pid: this.#child?.pid ?? null,
      startedAt: this.#startedAt,
      readyAt: this.#readyAt,
      restarts: this.#restarts,
      inFlight: this.#pending.size,
      books: this.#books?.length ?? null,
      chunks: this.#chunks,
      // {provider, model, fallbacks, keySet}: never the key itself
      llm: this.#llm,
      lastError: this.#lastError,
    };
  }

  /** Restart now (e.g. after re-indexing the books). In-flight requests fail with pipeline_unavailable. */
  async restart() {
    if (!this.#child) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
      this.#stopping = false;
      this.#consecutiveFailures = 0;
      this.#spawn();
      return;
    }
    // Requests from now on wait for the new process instead of going to the old one
    this.#restartImmediately = true;
    this.#state = 'restarting';
    if (this.#ready.settled) this.#resetReady();
    this.#child.kill();
  }

  /** Close the worker's stdin so it exits cleanly; kill it if it hasn't exited after graceMs. */
  async stop({ graceMs = 5000 } = {}) {
    this.#stopping = true;
    clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    const child = this.#child;
    if (!child) {
      this.#state = 'stopped';
      this.#settleReady(new RagError('pipeline_unavailable', 'The RAG worker is stopped'));
      return;
    }
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => child.kill(), graceMs);
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.stdin.end();
    });
  }

  #resetReady() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {}); // nobody may be waiting
    this.#ready = { promise, resolve, reject, settled: false };
  }

  #settleReady(error) {
    if (this.#ready.settled) return;
    this.#ready.settled = true;
    if (error) this.#ready.reject(error);
    else this.#ready.resolve();
  }

  #spawn() {
    if (this.#ready.settled) this.#resetReady();
    this.#state = 'starting';
    this.#startedAt = new Date().toISOString();
    this.#readyAt = null;

    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...WORKER_ENV, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;
    this.logger.info(`Starting RAG worker: ${this.command} ${this.args.join(' ')}`);

    child.stdin.on('error', (error) => this.logger.warn(`RAG worker stdin error: ${error.message}`));
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.#onLine(line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      // Python warnings, errors and tracebacks are worth seeing; the rest is model-loading chatter
      const important = /^(WARNING|ERROR|CRITICAL|Traceback)\b/.test(line);
      this.logger[important ? 'warn' : 'debug'](`[rag] ${line}`);
    });
    child.on('error', (error) => {
      // e.g. ENOENT when the Python executable isn't found; 'exit' may never fire
      this.#lastError = `Could not run "${this.command}": ${error.message}`;
      this.logger.error(this.#lastError);
      this.#onExit(child, null, null);
    });
    child.on('exit', (code, signal) => this.#onExit(child, code, signal));
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.logger.warn(`RAG worker wrote a non-protocol line: ${line.slice(0, 200)}`);
      return;
    }

    if (message.event === 'ready') {
      this.#state = 'ready';
      this.#readyAt = new Date().toISOString();
      this.#consecutiveFailures = 0;
      this.#lastError = null;
      this.#books = Array.isArray(message.books) ? message.books : null;
      this.#chunks = message.chunks ?? null;
      const llm = message.llm ?? {};
      this.#llm = llm.provider
        ? { provider: llm.provider, model: llm.model, fallbacks: llm.fallbacks ?? [], keySet: Boolean(llm.key_set) }
        : null;
      this.logger.info(
        `RAG worker ready (pid ${message.pid}, ${this.#books?.length ?? '?'} books, ${this.#chunks ?? '?'} chunks` +
          `${this.#llm ? `, model ${this.#llm.model} via ${this.#llm.provider}` : ''})`,
      );
      if (this.#llm && !this.#llm.keySet) {
        const variable = this.#llm.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
        this.logger.warn(`${variable} is not set for the RAG worker: questions will fail with service_error`);
      }
      this.#settleReady();
      return;
    }
    if (message.event === 'fatal') {
      this.#lastError = message.message;
      this.logger.error(`RAG worker failed to start: ${message.message}`);
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) {
      this.logger.debug(`RAG response for an unknown or timed-out request: ${message.id}`);
      return;
    }
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      const code = message.error?.code === 'shutting_down' ? 'pipeline_unavailable' : message.error?.code;
      pending.reject(
        new RagError(code ?? 'internal_error', message.error?.message ?? 'RAG worker error', message.error?.reason),
      );
    }
  }

  #onExit(child, code, signal) {
    if (this.#child !== child) return; // already handled ('error' and 'exit' can both fire)
    this.#child = null;
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;

    const restartImmediately = this.#restartImmediately;
    this.#restartImmediately = false;
    if (!restartImmediately) {
      // Fail requests waiting on a start that won't happen (a deliberate restart keeps them waiting)
      this.#settleReady(new RagError('pipeline_unavailable', this.#lastError ?? `The RAG worker stopped (${reason})`));
    }
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new RagError('pipeline_unavailable', 'The RAG worker stopped while answering'));
    }
    this.#pending.clear();

    if (this.#stopping) {
      this.#state = 'stopped';
      this.logger.info('RAG worker stopped');
      return;
    }

    let delay;
    if (restartImmediately) {
      this.#consecutiveFailures = 0;
      delay = 0;
    } else {
      this.#consecutiveFailures += 1;
      delay = Math.min(500 * 2 ** (this.#consecutiveFailures - 1), this.maxRestartDelayMs);
      this.logger.warn(`RAG worker exited (${reason}); restarting in ${delay}ms`);
    }
    this.#state = 'restarting';
    this.#restarts += 1;
    if (this.#ready.settled) this.#resetReady(); // requests that arrive now wait for the next start
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.#spawn();
    }, delay);
    this.#restartTimer.unref();
  }

  async #whenReady() {
    if (this.#state === 'ready') return;
    if (this.#state === 'stopped') throw new RagError('pipeline_unavailable', 'The RAG worker is not running');
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new RagError('pipeline_unavailable', 'The RAG worker is still starting')),
        this.readyWaitMs,
      );
    });
    try {
      await Promise.race([this.#ready.promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #request(op, params, timeoutMs) {
    await this.#whenReady();
    const child = this.#child;
    if (!child) throw new RagError('pipeline_unavailable', 'The RAG worker is not running');

    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RagError('pipeline_timeout', `No answer from the RAG worker within ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, op, params })}\n`);
    });
  }
}

/** Stand-in used when RAG_ENABLED=false: everything else works, asking returns 503. */
export class DisabledRag {
  start() {}
  async stop() {}
  async restart() {}
  async ask() {
    throw new RagError('pipeline_unavailable', 'The RAG pipeline is disabled (RAG_ENABLED=false)');
  }
  async books() {
    throw new RagError('pipeline_unavailable', 'The RAG pipeline is disabled (RAG_ENABLED=false)');
  }
  async ingest() {
    throw new RagError('pipeline_unavailable', 'The RAG pipeline is disabled (RAG_ENABLED=false)');
  }
  async deleteBook() {
    throw new RagError('pipeline_unavailable', 'The RAG pipeline is disabled (RAG_ENABLED=false)');
  }
  status() {
    return { state: 'disabled' };
  }
}

/** Build the worker from config. The model provider settings (OPENROUTER_API_KEY etc.) reach it through the environment. */
export function createRag(config, logger) {
  const ragConfig = config.rag;
  if (!ragConfig.enabled) return new DisabledRag();
  return new RagWorker({
    command: ragConfig.python,
    args: [ragConfig.script],
    env: {
      RAG_CONCURRENCY: String(ragConfig.concurrency),
      ...(ragConfig.hfOffline ? { HF_HUB_OFFLINE: '1' } : {}),
    },
    requestTimeoutMs: ragConfig.requestTimeoutMs,
    ingestTimeoutMs: config.uploads.ingestTimeoutMs,
    readyWaitMs: ragConfig.readyWaitMs,
    logger,
  });
}
