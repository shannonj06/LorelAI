import { Router } from 'express';
import { z } from 'zod';

import { conflict, forbidden, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { idParams, pagination, validate } from '../middleware/validate.js';
import * as askEvents from '../repositories/askEvents.js';
import * as auditLog from '../repositories/auditLog.js';
import * as chats from '../repositories/chats.js';
import * as refreshTokens from '../repositories/refreshTokens.js';
import * as trialSessions from '../repositories/trialSessions.js';
import * as userBooks from '../repositories/userBooks.js';
import * as users from '../repositories/users.js';
import { purgeUploadsForUser } from '../services/uploads.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const listUsersQuery = z.object({
  ...pagination,
  search: z.string().trim().max(254).optional(),
  role: z.enum(['user', 'admin']).optional(),
  active: booleanString.optional(),
});
const updateUserBody = z
  .strictObject({
    role: z.enum(['user', 'admin']).optional(),
    isActive: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide role, isActive or displayName');
const activityQuery = z.object({
  ...pagination,
  userId: z.coerce.number().int().positive().optional(),
  channel: z.enum(['app', 'trial']).optional(),
  status: z.enum(['answered', 'partial', 'insufficient', 'error']).optional(),
});
const pageQuery = z.object(pagination);

const lastAdminError = () => conflict('There must be at least one active admin', 'last_admin');

/**
 * /api/admin: admin-only (role "admin"). Every change is recorded in the audit log.
 * Admins see usage, never the content of anyone's questions: unsaved chats aren't
 * stored, and saved chats are private to their owner.
 */
export function adminRouter({ db, rag, logger, requireAuth }) {
  const router = Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/stats', async (req, res) => {
    res.json({
      users: await users.counts(db),
      questions: await askEvents.stats(db),
      trial: await trialSessions.count(db),
      savedChats: await chats.countAll(db),
      uploads: await userBooks.counts(db),
      pipeline: rag.status(),
    });
  });

  // --- Users ---

  router.get('/users', validate({ query: listUsersQuery }), async (req, res) => {
    const { search, role, active, limit, offset } = req.valid.query;
    const { rows, total } = await users.list(db, { search, role, isActive: active, limit, offset });
    res.json({ items: rows.map(users.toPublicUser), total, limit, offset });
  });

  router.get('/users/:id', validate({ params: idParams }), async (req, res) => {
    const user = await users.findById(db, req.valid.params.id);
    if (!user) throw notFound('User not found');
    res.json({
      user: users.toPublicUser(user),
      activity: {
        questions: await askEvents.countForUser(db, user.id),
        savedChats: await chats.countForUser(db, user.id),
        uploads: await userBooks.countForUser(db, user.id),
        activeSessions: await refreshTokens.countActiveForUser(db, user.id),
      },
    });
  });

  router.patch('/users/:id', validate({ params: idParams, body: updateUserBody }), async (req, res) => {
    const { id } = req.valid.params;
    const changes = req.valid.body;
    if (id === req.user.id && ((changes.role && changes.role !== req.user.role) || changes.isActive === false)) {
      throw forbidden('You cannot change your own role or disable your own account', 'self_modification');
    }

    const user = await db.transaction(async (tx) => {
      const target = await users.findById(tx, id);
      if (!target) throw notFound('User not found');

      const losesAdmin =
        target.role === 'admin' && target.is_active && (changes.role === 'user' || changes.isActive === false);
      if (losesAdmin && (await users.countActiveAdmins(tx)) <= 1) throw lastAdminError();

      const disabling = changes.isActive === false && Boolean(target.is_active);
      const roleChanging = changes.role !== undefined && changes.role !== target.role;
      const updated = await users.update(tx, id, { ...changes, bumpTokenVersion: disabling || roleChanging });
      if (disabling) await refreshTokens.revokeAllForUser(tx, id);

      await auditLog.record(tx, {
        actorId: req.user.id,
        action: 'user.update',
        targetType: 'user',
        targetId: id,
        details: {
          email: target.email,
          before: { role: target.role, isActive: Boolean(target.is_active), displayName: target.display_name },
          changes,
        },
      });
      return updated;
    });
    res.json({ user: users.toPublicUser(user) });
  });

  router.delete('/users/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params;
    if (id === req.user.id) {
      throw forbidden('Admins cannot delete themselves here; use DELETE /api/auth/me', 'self_modification');
    }
    const target = await users.findById(db, id);
    if (!target) throw notFound('User not found');
    if (target.role === 'admin' && target.is_active && (await users.countActiveAdmins(db)) <= 1) {
      throw lastAdminError();
    }
    // Uploaded books live in the vector store, outside this database (network I/O: not inside a transaction)
    await purgeUploadsForUser({ db, rag, logger }, id);
    await db.transaction(async (tx) => {
      await users.remove(tx, id);
      await auditLog.record(tx, {
        actorId: req.user.id,
        action: 'user.delete',
        targetType: 'user',
        targetId: id,
        details: { email: target.email, role: target.role },
      });
    });
    res.status(204).end();
  });

  router.post('/users/:id/revoke-sessions', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params;
    await db.transaction(async (tx) => {
      const target = await users.findById(tx, id);
      if (!target) throw notFound('User not found');
      await refreshTokens.revokeAllForUser(tx, id);
      await users.update(tx, id, { bumpTokenVersion: true });
      await auditLog.record(tx, {
        actorId: req.user.id,
        action: 'user.revoke_sessions',
        targetType: 'user',
        targetId: id,
        details: { email: target.email },
      });
    });
    res.status(204).end();
  });

  // --- Usage (no question or answer content is ever stored here) ---

  router.get('/activity', validate({ query: activityQuery }), async (req, res) => {
    const { userId, channel, status, limit, offset } = req.valid.query;
    res.json({ ...(await askEvents.recent(db, { userId, channel, status, limit, offset })), limit, offset });
  });

  router.get('/uploads', validate({ query: pageQuery }), async (req, res) => {
    const { limit, offset } = req.valid.query;
    res.json({ ...(await userBooks.listAll(db, { limit, offset })), limit, offset });
  });

  // --- Audit log and pipeline ---

  router.get('/audit-log', validate({ query: pageQuery }), async (req, res) => {
    const { limit, offset } = req.valid.query;
    res.json({ ...(await auditLog.list(db, { limit, offset })), limit, offset });
  });

  router.get('/pipeline', (req, res) => {
    res.json(rag.status());
  });

  router.post('/pipeline/restart', async (req, res) => {
    await rag.restart();
    await auditLog.record(db, { actorId: req.user.id, action: 'pipeline.restart', targetType: 'pipeline' });
    res.status(202).json(rag.status());
  });

  return router;
}
