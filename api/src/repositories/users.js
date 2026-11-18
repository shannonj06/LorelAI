import { timestamp } from '../db/index.js';

const COLUMNS =
  'id, email, password_hash, display_name, role, is_active, token_version, created_at, updated_at, last_login_at';

export const normalizeEmail = (email) => email.trim().toLowerCase();

/** The user as returned by the API: never includes the password hash or token version. */
export function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function findById(db, id) {
  return db.get(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
}

export function findByEmail(db, email) {
  return db.get(`SELECT ${COLUMNS} FROM users WHERE email = ?`, [normalizeEmail(email)]);
}

export async function create(db, { email, passwordHash, displayName = null, role = 'user' }) {
  const now = timestamp();
  const { lastInsertId } = await db.run(
    `INSERT INTO users (email, password_hash, display_name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [normalizeEmail(email), passwordHash, displayName, role, now, now],
  );
  return findById(db, lastInsertId);
}

const UPDATABLE = {
  displayName: 'display_name',
  role: 'role',
  isActive: 'is_active',
  passwordHash: 'password_hash',
};

/** Update the given fields. bumpTokenVersion: true invalidates the user's access tokens. */
export async function update(db, id, fields) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(fields[key]);
    }
  }
  if (fields.bumpTokenVersion) sets.push('token_version = token_version + 1');
  if (sets.length === 0) return findById(db, id);
  sets.push('updated_at = ?');
  params.push(timestamp(), id);
  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(db, id);
}

export function recordLogin(db, id) {
  return db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [timestamp(), id]);
}

export async function remove(db, id) {
  const { changes } = await db.run('DELETE FROM users WHERE id = ?', [id]);
  return changes > 0;
}

// '!' as the LIKE escape character works the same in SQLite and MySQL
const escapeLike = (text) => text.replace(/[!%_]/g, (char) => `!${char}`);

export async function list(db, { search, role, isActive, limit, offset }) {
  const where = [];
  const params = [];
  if (search) {
    where.push("(email LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!')");
    const pattern = `%${escapeLike(search)}%`;
    params.push(pattern, pattern);
  }
  if (role) {
    where.push('role = ?');
    params.push(role);
  }
  if (isActive !== undefined) {
    where.push('is_active = ?');
    params.push(isActive);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(`SELECT ${COLUMNS} FROM users ${whereSql} ORDER BY id LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);
  const { total } = await db.get(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
  return { rows, total };
}

export async function countActiveAdmins(db) {
  const row = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1");
  return row.n;
}

export async function counts(db) {
  const row = await db.get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admins
     FROM users`,
  );
  return { total: row.total, active: row.active, admins: row.admins };
}
