import * as askEvents from '../repositories/askEvents.js';
import { outcomeFromRagError, outcomeFromWorker } from './rag/format.js';
import { RagError } from './rag/worker.js';

/**
 * Ask the pipeline one question and record the outcome (without its content).
 * Shared by POST /api/ask and the landing page's POST /api/trial/ask.
 *
 * Returns {outcome, latencyMs}. Throws RagError("bad_request") for the caller's
 * mistakes (e.g. an unknown book), which shouldn't count as a question.
 */
export async function answerQuestion({ db, rag, config, logger }, { params, channel, userId = null, saved = false }) {
  const started = performance.now();
  let outcome;
  try {
    outcome = outcomeFromWorker(
      await rag.ask({ k: config.rag.topK, per_book: config.rag.perBook, ...params }),
    );
  } catch (error) {
    if (!(error instanceof RagError) || error.code === 'bad_request') throw error;
    logger.warn(`Pipeline error (${error.code}): ${error.message}`);
    outcome = outcomeFromRagError(error);
  }
  const latencyMs = Math.round(performance.now() - started);

  await askEvents.record(db, {
    userId,
    channel,
    status: outcome.status,
    errorCode: outcome.errorCode,
    citations: outcome.citations.length,
    booksCited: new Set(outcome.citations.map((c) => c.bookId)).size,
    passagesRetrieved: outcome.passagesRetrieved,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    model: outcome.model,
    cached: outcome.cached,
    saved,
    latencyMs,
  });
  return { outcome, latencyMs };
}
