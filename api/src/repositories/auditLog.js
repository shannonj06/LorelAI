import { timestamp } from '../db/index.js';

export function record(db, { actorId, action, targetType = null, targetId = null, details = null }) {
  return db.run(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [actorId, action, targetType, targetId, details === null ? null : JSON.stringify(details), timestamp()],
  );
}

export async function list(db, { limit, offset }) {
  const rows = await db.all(
    `SELECT a.id, a.actor_id, u.email AS actor_email, a.action, a.target_type, a.target_id, a.details, a.created_at
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const { total } = await db.get('SELECT COUNT(*) AS total FROM audit_log');
  return {
    items: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details === null ? null : JSON.parse(row.details),
      createdAt: row.created_at,
    })),
    total,
  };
}
