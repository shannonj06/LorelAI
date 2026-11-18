import { timestamp } from '../db/index.js';

const COLUMNS =
  'id, user_id, title, author, year, filename, size_bytes, status, error, pages, chunks, created_at, updated_at';

export const toUpload = (row) => ({
  id: row.id,
  title: row.title,
  author: row.author,
  year: row.year,
  filename: row.filename,
  sizeBytes: row.size_bytes,
  status: row.status,
  error: row.error,
  pages: row.pages,
  chunks: row.chunks,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.user_email !== undefined ? { userId: row.user_id, userEmail: row.user_email } : {}),
});

export function create(db, { id, userId, title, author, year, filename, sizeBytes }) {
  const now = timestamp();
  return db.run(
    `INSERT INTO user_books (id, user_id, title, author, year, filename, size_bytes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)`,
    [id, userId, title, author ?? null, year ?? null, filename ?? null, sizeBytes, now, now],
  );
}

export function findForUser(db, userId, id) {
  return db.get(`SELECT ${COLUMNS} FROM user_books WHERE id = ? AND user_id = ?`, [id, userId]);
}

export function listForUser(db, userId) {
  return db.all(`SELECT ${COLUMNS} FROM user_books WHERE user_id = ? ORDER BY created_at DESC, id`, [userId]);
}

export async function readyIdsForUser(db, userId) {
  const rows = await db.all("SELECT id FROM user_books WHERE user_id = ? AND status = 'ready'", [userId]);
  return rows.map((row) => row.id);
}

/** Uploads that count against the per-reader limit (failed ones don't). */
export async function countActiveForUser(db, userId) {
  const row = await db.get("SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status <> 'failed'", [userId]);
  return row.n;
}

export function markReady(db, id, { pages, chunks }) {
  return db.run(
    "UPDATE user_books SET status = 'ready', error = NULL, pages = ?, chunks = ?, updated_at = ? WHERE id = ?",
    [pages, chunks, timestamp(), id],
  );
}

export function markFailed(db, id, error) {
  return db.run("UPDATE user_books SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", [
    error,
    timestamp(),
    id,
  ]);
}

/** After a restart, uploads that were mid-processing will never finish. Returns their IDs. */
export async function failInterrupted(db) {
  const rows = await db.all("SELECT id FROM user_books WHERE status = 'processing'");
  if (rows.length) {
    await db.run(
      "UPDATE user_books SET status = 'failed', error = ?, updated_at = ? WHERE status = 'processing'",
      ['Processing was interrupted by a server restart. Please upload the book again.', timestamp()],
    );
  }
  return rows.map((row) => row.id);
}

export async function remove(db, userId, id) {
  const { changes } = await db.run('DELETE FROM user_books WHERE id = ? AND user_id = ?', [id, userId]);
  return changes > 0;
}

export async function listAll(db, { limit, offset }) {
  const rows = await db.all(
    `SELECT b.${COLUMNS.split(', ').join(', b.')}, u.email AS user_email
     FROM user_books b LEFT JOIN users u ON u.id = b.user_id
     ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const { total } = await db.get('SELECT COUNT(*) AS total FROM user_books');
  return { items: rows.map(toUpload), total };
}

export async function counts(db) {
  const byStatus = { processing: 0, ready: 0, failed: 0 };
  for (const row of await db.all('SELECT status, COUNT(*) AS n FROM user_books GROUP BY status')) {
    byStatus[row.status] = row.n;
  }
  return { total: byStatus.processing + byStatus.ready + byStatus.failed, byStatus };
}

export async function countForUser(db, userId) {
  const row = await db.get('SELECT COUNT(*) AS n FROM user_books WHERE user_id = ?', [userId]);
  return row.n;
}
