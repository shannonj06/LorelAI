import { Router } from 'express';
import { z } from 'zod';

import { HttpError, badRequest, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import * as chats from '../repositories/chats.js';
import * as userBooks from '../repositories/userBooks.js';
import { answerQuestion } from '../services/answers.js';
import { httpStatusFor, toAskResponse } from '../services/rag/format.js';
import { RagError } from '../services/rag/worker.js';

export const bookIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Book IDs look like "holt_1894" or "up_3fa1c2"');
export const questionSchema = z
  .string()
  .trim()
  .min(1, 'Ask a question')
  .max(1000, 'Questions are limited to 1000 characters');
// Earlier questions in the same conversation, oldest first, so follow-ups ("and at night?") make sense
export const historySchema = z.array(z.string().trim().min(1).max(1000)).max(4);

const askBody = z.strictObject({
  question: questionSchema,
  // Library book IDs and/or the reader's own upload IDs. Omit to search everything they can see.
  books: z.array(bookIdSchema).min(1, 'Pick at least one book').max(50).optional(),
  perBook: z.number().int().min(1).max(5).optional(),
  // A saved chat to append this exchange to. Without it, nothing about the question is stored.
  chatId: z.number().int().positive().optional(),
  history: historySchema.optional(),
});

/** Split requested book IDs into library books and this reader's ready uploads. */
async function resolveBooks({ db, rag }, userId, requested) {
  const uploadIds = await userBooks.readyIdsForUser(db, userId);
  if (!requested) return { bookIds: null, uploadIds };

  let library;
  try {
    library = new Set((await rag.books()).map((book) => book.book_id));
  } catch (error) {
    if (error instanceof RagError) {
      throw new HttpError(503, 'pipeline_unavailable', 'The answer service is starting up. Please try again in a moment.');
    }
    throw error;
  }
  const mine = new Set(uploadIds);
  const unknown = requested.filter((id) => !library.has(id) && !mine.has(id));
  if (unknown.length) throw badRequest(`These books aren't available to you: ${unknown.join(', ')}`);
  return { bookIds: requested.filter((id) => library.has(id)), uploadIds: requested.filter((id) => mine.has(id)) };
}

/**
 * POST /api/ask {question, books?, perBook?, chatId?, history?}
 *
 * Retrieval across the chosen books + grounded generation. Returns
 *   {question, status, answer, citations[], statements[], conflicts[], notCovered[], error, meta, chatId, messageId?}
 * Unless chatId names a saved chat, the question and answer are not stored anywhere.
 */
export function askRouter({ db, rag, config, logger, requireAuth, limiters }) {
  const router = Router();

  router.post('/', requireAuth, limiters.ask, validate({ body: askBody }), async (req, res) => {
    const { question, books, perBook, chatId, history } = req.valid.body;
    const chat = chatId ? await chats.findForUser(db, req.user.id, chatId) : null;
    if (chatId && !chat) throw notFound('Chat not found');
    const { bookIds, uploadIds } = await resolveBooks({ db, rag }, req.user.id, books);

    let result;
    try {
      result = await answerQuestion({ db, rag, config, logger }, {
        params: {
          question,
          per_book: perBook ?? config.rag.perBook,
          book_ids: bookIds,
          owner_id: String(req.user.id),
          upload_ids: uploadIds,
          history: history ?? [],
        },
        channel: 'app',
        userId: req.user.id,
        saved: Boolean(chat),
      });
    } catch (error) {
      if (error instanceof RagError && error.code === 'bad_request') throw badRequest(error.message);
      throw error;
    }
    const { outcome, latencyMs } = result;

    let body = toAskResponse(outcome, { question, latencyMs, extra: { chatId: chat?.id ?? null } });
    if (chat && outcome.status !== 'error') {
      // Failed attempts aren't saved: retrying them later is more useful than a stored error
      const messageId = await db.transaction(async (tx) => {
        await chats.addMessage(tx, chat.id, { role: 'user', content: question });
        return chats.addMessage(tx, chat.id, { role: 'assistant', content: outcome.answer, response: body });
      });
      body = { ...body, messageId };
    }
    res.status(httpStatusFor(outcome)).json(body);
  });

  return router;
}
