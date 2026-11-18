import express, { Router } from 'express';
import { z } from 'zod';

import { HttpError, conflict, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import * as userBooks from '../repositories/userBooks.js';
import { RagError } from '../services/rag/worker.js';
import { looksLikePdf, removeUpload, startUpload } from '../services/uploads.js';

const uploadQuery = z.object({
  title: z.string().trim().min(1, 'Give the book a title').max(200),
  author: z.string().trim().max(120).optional().transform((v) => v || undefined),
  year: z.coerce.number().int().min(1).max(2100).optional(),
  filename: z.string().trim().max(255).optional(),
});
const uploadParams = z.object({ id: z.string().regex(/^up_[0-9a-f]{12}$/) });

/**
 * /api/uploads: a reader's own books (work in progress: text-based PDFs only).
 *
 * POST /api/uploads?title=...&author=...&year=...  with Content-Type: application/pdf and the file as the body.
 * Returns 202 with status "processing"; poll GET /api/uploads/:id until "ready" or "failed".
 * Uploaded books are private: only their owner's questions can search them.
 */
export function uploadsRouter({ db, rag, config, logger, requireAuth, limiters }) {
  const router = Router();
  router.use(requireAuth);

  const limits = { maxBytes: config.uploads.maxBytes, maxPerUser: config.uploads.maxPerUser };

  router.get('/', async (req, res) => {
    const rows = await userBooks.listForUser(db, req.user.id);
    res.json({ items: rows.map(userBooks.toUpload), limits });
  });

  router.post(
    '/',
    limiters.upload,
    express.raw({ type: 'application/pdf', limit: config.uploads.maxBytes }),
    validate({ query: uploadQuery }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(415, 'unsupported_media_type', 'Upload a PDF file (Content-Type: application/pdf)');
      }
      if (!looksLikePdf(req.body)) {
        throw new HttpError(415, 'unsupported_media_type', "That file isn't a PDF");
      }
      if ((await userBooks.countActiveForUser(db, req.user.id)) >= config.uploads.maxPerUser) {
        throw conflict(
          `You can keep up to ${config.uploads.maxPerUser} uploaded books. Remove one to add another.`,
          'upload_limit',
        );
      }
      const { title, author, year, filename } = req.valid.query;
      const { id } = await startUpload({ db, rag, config, logger }, {
        userId: req.user.id,
        buffer: req.body,
        title,
        author,
        year,
        filename,
      });
      res.status(202).json({ upload: userBooks.toUpload(await userBooks.findForUser(db, req.user.id, id)) });
    },
  );

  router.get('/:id', validate({ params: uploadParams }), async (req, res) => {
    const upload = await userBooks.findForUser(db, req.user.id, req.valid.params.id);
    if (!upload) throw notFound('Upload not found');
    res.json({ upload: userBooks.toUpload(upload) });
  });

  router.delete('/:id', validate({ params: uploadParams }), async (req, res) => {
    const upload = await userBooks.findForUser(db, req.user.id, req.valid.params.id);
    if (!upload) throw notFound('Upload not found');
    if (upload.status === 'processing') {
      throw conflict('This book is still being processed. Try again when it finishes.', 'still_processing');
    }
    try {
      await removeUpload({ db, rag }, upload);
    } catch (error) {
      if (error instanceof RagError) {
        throw new HttpError(503, 'pipeline_unavailable', "The library service is unavailable, so the book can't be removed right now");
      }
      throw error;
    }
    res.status(204).end();
  });

  return router;
}
