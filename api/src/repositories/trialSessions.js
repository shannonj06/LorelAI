import { timestamp } from '../db/index.js';

export async function findOrCreate(db, { tokenHash, ipHash }) {
  const existing = await db.get('SELECT id, questions FROM trial_sessions WHERE token_hash = ?', [tokenHash]);
  if (existing) return existing;
  const now = timestamp();
  try {
    await db.run(
      'INSERT INTO trial_sessions (token_hash, ip_hash, questions, created_at, last_used_at) VALUES (?, ?, 0, ?, ?)',
      [tokenHash, ipHash, now, now],
    );
  } catch (error) {
    if (!error.isUniqueViolation) throw error; // created by a parallel request
  }
  return db.get('SELECT id, questions FROM trial_sessions WHERE token_hash = ?', [tokenHash]);
}

/** Use one question if any remain. Returns false when the trial is used up (atomic, so parallel requests can't overshoot). */
export async function reserve(db, id, limit) {
  const { changes } = await db.run(
    'UPDATE trial_sessions SET questions = questions + 1, last_used_at = ? WHERE id = ? AND questions < ?',
    [timestamp(), id, limit],
  );
  return changes > 0;
}

/** Give a question back when the answer failed for reasons that weren't the visitor's fault. */
export function refund(db, id) {
  return db.run('UPDATE trial_sessions SET questions = questions - 1 WHERE id = ? AND questions > 0', [id]);
}

export async function used(db, id) {
  const row = await db.get('SELECT questions FROM trial_sessions WHERE id = ?', [id]);
  return row?.questions ?? 0;
}

/** Trial questions asked from one (hashed) IP in the last 24 hours, across all its sessions. */
export async function usedByIpToday(db, ipHash) {
  const since = timestamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const row = await db.get(
    'SELECT COALESCE(SUM(questions), 0) AS n FROM trial_sessions WHERE ip_hash = ? AND last_used_at >= ?',
    [ipHash, since],
  );
  return row.n;
}

export async function count(db) {
  const row = await db.get('SELECT COUNT(*) AS n, COALESCE(SUM(questions), 0) AS questions FROM trial_sessions');
  return { sessions: row.n, questions: row.questions };
}
