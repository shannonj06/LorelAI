import * as auditLog from './repositories/auditLog.js';
import * as users from './repositories/users.js';

/**
 * Make sure an admin account exists.
 * - If the email belongs to an existing user, that user is promoted (and re-enabled).
 * - Otherwise a new admin is created with the given password.
 * With onlyIfNoAdmin, nothing happens when an active admin already exists (used at startup).
 * Returns {action: "created" | "promoted" | "unchanged" | "skipped", user}.
 */
export async function ensureAdmin(db, passwords, { email, password, onlyIfNoAdmin = false }) {
  if (onlyIfNoAdmin && (await users.countActiveAdmins(db)) > 0) return { action: 'skipped', user: null };

  const existing = await users.findByEmail(db, email);
  if (existing) {
    if (existing.role === 'admin' && existing.is_active) return { action: 'unchanged', user: existing };
    const user = await users.update(db, existing.id, { role: 'admin', isActive: true, bumpTokenVersion: true });
    await auditLog.record(db, {
      actorId: null,
      action: 'admin.bootstrap',
      targetType: 'user',
      targetId: user.id,
      details: { email: user.email, result: 'promoted' },
    });
    return { action: 'promoted', user };
  }

  if (!password || password.length < 8) {
    throw new Error(`No user ${email} exists; provide a password of at least 8 characters to create one`);
  }
  const user = await users.create(db, { email, passwordHash: await passwords.hash(password), role: 'admin' });
  await auditLog.record(db, {
    actorId: null,
    action: 'admin.bootstrap',
    targetType: 'user',
    targetId: user.id,
    details: { email: user.email, result: 'created' },
  });
  return { action: 'created', user };
}
