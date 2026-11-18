import { Router } from 'express';

import { HttpError } from '../errors.js';
import { bookFromWorker } from '../services/rag/format.js';
import { RagError } from '../services/rag/worker.js';

/** GET /api/books — the library the pipeline answers from. Public. */
export function booksRouter({ rag }) {
  const router = Router();

  router.get('/', async (req, res) => {
    let books;
    try {
      books = await rag.books();
    } catch (error) {
      if (error instanceof RagError) {
        throw new HttpError(503, error.code, 'The book catalog is unavailable while the pipeline starts up');
      }
      throw error;
    }
    res.json({ books: books.map(bookFromWorker) });
  });

  return router;
}
