import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import * as userBooks from '../repositories/userBooks.js';
import { RagError } from './rag/worker.js';

export const newUploadId = () => `up_${crypto.randomBytes(6).toString('hex')}`;

/** Real PDFs start with "%PDF-", sometimes after a little junk; checked instead of trusting the Content-Type. */
export const looksLikePdf = (buffer) => buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));

function failureMessage(error) {
  if (error instanceof RagError) {
    if (error.code === 'unprocessable') return error.message; // written for readers by ingest.py
    if (error.code === 'pipeline_timeout') return 'Processing this book took too long. Try a smaller PDF.';
    if (error.code === 'pipeline_unavailable') {
      return 'The library service restarted while processing this book. Please upload it again.';
    }
  }
  return 'Something went wrong while processing this book. Please try again.';
}

/**
 * Save the PDF, then index it in the background. The upload row starts as
 * "processing" and becomes "ready" or "failed"; the PDF itself is deleted either
 * way, since only the extracted passages are needed.
 */
export async function startUpload({ db, rag, config, logger }, { userId, buffer, title, author, year, filename }) {
  const id = newUploadId();
  await fs.mkdir(config.uploads.dir, { recursive: true });
  const file = path.join(config.uploads.dir, `${id}.pdf`);
  await fs.writeFile(file, buffer);
  await userBooks.create(db, { id, userId, title, author, year, filename, sizeBytes: buffer.length });

  const done = rag
    .ingest({ path: file, book_id: id, title, author: author ?? null, year: year ?? null, owner_id: String(userId) })
    .then(async (result) => {
      await userBooks.markReady(db, id, { pages: result.pages, chunks: result.chunks });
      logger.info('Upload indexed', { uploadId: id, userId, pages: result.pages, chunks: result.chunks });
    })
    .catch(async (error) => {
      logger.warn(`Upload ${id} failed: ${error.reason ?? error.code ?? ''} ${error.message}`, { userId });
      await userBooks.markFailed(db, id, failureMessage(error));
    })
    .finally(() => fs.rm(file, { force: true }));

  return { id, done };
}

/** Remove a reader's uploaded book from the vector store and the database. */
export async function removeUpload({ db, rag }, upload) {
  if (upload.status === 'ready') {
    await rag.deleteBook({ book_id: upload.id, owner_id: String(upload.user_id) });
  }
  await userBooks.remove(db, upload.user_id, upload.id);
}

/**
 * Before an account is deleted: remove its uploaded books' passages. Best effort.
 * If the worker is down the passages are orphaned but unreachable: they're tagged
 * with the deleted user's ID, and SQLite AUTOINCREMENT never reuses IDs.
 */
export async function purgeUploadsForUser({ db, rag, logger }, userId) {
  for (const upload of await userBooks.listForUser(db, userId)) {
    if (upload.status !== 'ready') continue;
    try {
      await rag.deleteBook({ book_id: upload.id, owner_id: String(userId) });
    } catch (error) {
      logger.warn(`Could not remove passages of ${upload.id} for deleted user ${userId}: ${error.message}`);
    }
  }
}

/** At startup: uploads interrupted by a restart are marked failed and their files removed. */
export async function recoverInterruptedUploads({ db, config, logger }) {
  const ids = await userBooks.failInterrupted(db);
  for (const id of ids) await fs.rm(path.join(config.uploads.dir, `${id}.pdf`), { force: true });
  if (ids.length) logger.warn(`Marked ${ids.length} interrupted upload(s) as failed`);
}
