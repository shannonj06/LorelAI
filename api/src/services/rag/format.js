/**
 * Converts between the Python worker's output (snake_case) and the API's JSON (camelCase).
 */

const NODE_SIDE_MESSAGES = {
  pipeline_unavailable: 'The answer service is starting up or unavailable. Please try again in a moment.',
  pipeline_timeout: 'Finding an answer took too long. Please try again.',
  internal_error: 'Something went wrong while generating an answer. Please try again later.',
};

// HTTP status for each error code. Refusals are a normal outcome, so they stay 200.
const ERROR_HTTP_STATUS = {
  refusal: 200,
  invalid_output: 502,
  service_error: 502,
  internal_error: 502,
  service_unavailable: 503,
  pipeline_unavailable: 503,
  pipeline_timeout: 504,
};

const citationFromWorker = (citation) => ({
  id: citation.id,
  label: citation.label,
  bookId: citation.book_id ?? null,
  title: citation.title ?? null,
  author: citation.author ?? null,
  year: citation.year ?? null,
  chapter: citation.chapter ?? null,
  page: citation.page ?? null,
  chunkId: citation.chunk_id ?? null,
  text: citation.text ?? null,
  // "library" (the shared books) or "upload" (the reader's own PDF)
  source: citation.source ?? 'library',
  // Similarity between the question and the passage, 0-1
  score: citation.score ?? null,
});

/** A worker "ask" result as an outcome the routes can save, record and return. */
export function outcomeFromWorker(result) {
  return {
    status: result.status,
    errorCode: result.error ?? null,
    answer: result.answer,
    citations: (result.citations ?? []).map(citationFromWorker),
    statements: (result.statements ?? []).map((s) => ({ text: s.text, citationIds: s.citation_ids })),
    conflicts: (result.conflicts ?? []).map((c) => ({ summary: c.summary, citationIds: c.citation_ids })),
    notCovered: result.not_covered ?? [],
    passagesRetrieved: result.retrieval?.passages ?? null,
    booksRetrieved: result.retrieval?.books ?? [],
    model: result.model ?? null,
    cached: Boolean(result.cached),
    usage: { inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 },
  };
}

/** The outcome when the worker couldn't be reached, timed out, or crashed. */
export function outcomeFromRagError(error) {
  const code = NODE_SIDE_MESSAGES[error.code] ? error.code : 'internal_error';
  return {
    status: 'error',
    errorCode: code,
    answer: NODE_SIDE_MESSAGES[code],
    citations: [],
    statements: [],
    conflicts: [],
    notCovered: [],
    passagesRetrieved: null,
    booksRetrieved: [],
    model: null,
    cached: false,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export function httpStatusFor(outcome) {
  if (outcome.status !== 'error') return 200;
  return ERROR_HTTP_STATUS[outcome.errorCode] ?? 502;
}

/** Errors that aren't the asker's doing (outages, timeouts): a trial question is given back. */
export const isServiceFailure = (outcome) => outcome.status === 'error' && outcome.errorCode !== 'refusal';

/** The POST /api/ask (and /api/trial/ask) response body; also stored with saved chat messages. */
export function toAskResponse(outcome, { question, latencyMs, createdAt = new Date().toISOString(), extra = {} }) {
  return {
    question,
    status: outcome.status,
    answer: outcome.answer,
    citations: outcome.citations,
    statements: outcome.statements,
    conflicts: outcome.conflicts,
    notCovered: outcome.notCovered,
    error: outcome.status === 'error' ? { code: outcome.errorCode, message: outcome.answer } : null,
    meta: {
      latencyMs,
      passagesRetrieved: outcome.passagesRetrieved,
      booksRetrieved: outcome.booksRetrieved,
      model: outcome.model,
      cached: outcome.cached,
    },
    createdAt,
    ...extra,
  };
}

export const bookFromWorker = (book) => ({
  id: book.book_id,
  title: book.title,
  author: book.author,
  year: book.year,
  chunks: book.chunks,
});
