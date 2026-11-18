import { timestamp } from '../db/index.js';

export function create(db, { userId, tokenHash, familyId, expiresAt, userAgent = null, ip = null }) {
  return db.run(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, tokenHash, familyId, expiresAt, userAgent, ip, timestamp()],
  );
}

export function findByHash(db, tokenHash) {
  return db.get(
    'SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?',
    [tokenHash],
  );
}

/** Revoke one token. Returns true only for the call that actually revoked it. */
export async function revoke(db, id) {
  const { changes } = await db.run(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [timestamp(), id],
  );
  return changes > 0;
}

export function revokeFamily(db, familyId) {
  return db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL', [
    timestamp(),
    familyId,
  ]);
}

export function revokeAllForUser(db, userId) {
  return db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
    timestamp(),
    userId,
  ]);
}

export async function countActiveForUser(db, userId) {
  const row = await db.get(
    'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
    [userId, timestamp()],
  );
  return row.n;
}

/** Housekeeping: drop tokens that expired more than a day ago. */
export async function deleteExpired(db) {
  const cutoff = timestamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const { changes } = await db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [cutoff]);
  return changes;
}
