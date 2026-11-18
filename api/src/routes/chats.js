import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, notFound } from '../errors.js';
import { idParams, validate } from '../middleware/validate.js';
import * as chats from '../repositories/chats.js';

const MAX_RESPONSE_CHARS = 100_000;

const message = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('user'), content: z.string().trim().min(1).max(1000) }),
  z.strictObject({
    role: z.literal('assistant'),
    content: z.string().min(1).max(20_000),
    // The /api/ask response shown for this answer (citations etc.), so a saved chat renders the same
    response: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
]);
const title = z.string().trim().min(1).max(120);
const createBody = z.strictObject({ title: title.optional(), messages: z.array(message).max(100).default([]) });
const renameBody = z.strictObject({ title });

const defaultTitle = (messages) => {
  const first = messages.find((m) => m.role === 'user')?.content ?? '';
  if (!first) return 'Untitled chat';
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}...` : first;
};

/**
 * /api/chats: saved chats. Chats are not stored unless the reader saves one.
 * POST saves the conversation so far; later questions sent with chatId are appended.
 * DELETE "unsaves" it: the stored copy is removed.
 */
export function chatsRouter({ db, config, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.json({ items: await chats.listForUser(db, req.user.id), limit: config.chats.maxSavedPerUser });
  });

  router.post('/', validate({ body: createBody }), async (req, res) => {
    const { messages } = req.valid.body;
    for (const m of messages) {
      if (m.response && JSON.stringify(m.response).length > MAX_RESPONSE_CHARS) {
        throw badRequest('One of the answers is too large to save');
      }
    }
    if ((await chats.countForUser(db, req.user.id)) >= config.chats.maxSavedPerUser) {
      throw conflict(
        `You can keep up to ${config.chats.maxSavedPerUser} saved chats. Delete one to save another.`,
        'chat_limit',
      );
    }
    const chat = await chats.create(db, {
      userId: req.user.id,
      title: req.valid.body.title ?? defaultTitle(messages),
      messages,
    });
    res.status(201).json({ chat, messages: await chats.messages(db, chat.id) });
  });

  router.get('/:id', validate({ params: idParams }), async (req, res) => {
    const chat = await chats.findForUser(db, req.user.id, req.valid.params.id);
    if (!chat) throw notFound('Chat not found');
    res.json({ chat, messages: await chats.messages(db, chat.id) });
  });

  router.patch('/:id', validate({ params: idParams, body: renameBody }), async (req, res) => {
    if (!(await chats.rename(db, req.user.id, req.valid.params.id, req.valid.body.title))) {
      throw notFound('Chat not found');
    }
    res.json({ chat: await chats.findForUser(db, req.user.id, req.valid.params.id) });
  });

  router.delete('/:id', validate({ params: idParams }), async (req, res) => {
    if (!(await chats.remove(db, req.user.id, req.valid.params.id))) throw notFound('Chat not found');
    res.status(204).end();
  });

  return router;
}
