import { Router } from 'express';
import { z } from 'zod';

import { REFRESH_COOKIE, isWebClient, readCookie } from '../cookies.js';
import { unauthorized } from '../errors.js';
import { validate } from '../middleware/validate.js';
import * as users from '../repositories/users.js';

const email = z.string().trim().pipe(z.email('Enter a valid email address').max(254));
// Length is what matters for password strength (NIST SP 800-63B); no composition rules
const newPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');
const displayName = z.string().trim().min(1).max(80);

const signUpBody = z.strictObject({ email, password: newPassword, displayName: displayName.optional() });
const signInBody = z.strictObject({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
// The web app sends no body: its refresh token is in an httpOnly cookie
const refreshBody = z.strictObject({ refreshToken: z.string().min(1).max(512).optional() });
const updateMeBody = z.strictObject({ displayName: displayName.nullable() });
const changePasswordBody = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword });
const deleteMeBody = z.strictObject({ password: z.string().min(1).max(128) });

const clientContext = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });

/**
 * /api/auth: accounts and sessions.
 *
 * Sign-up, sign-in and refresh return a session:
 *   {user, tokenType: "Bearer", accessToken, expiresIn, refreshToken, refreshTokenExpiresAt}
 * Send the access token as "Authorization: Bearer <token>". When it expires (15 min by
 * default), POST /refresh for a new session; each refresh token works once.
 *
 * Browser mode: requests with the header "X-LorelAI-Client: web" get the refresh token
 * as an httpOnly, SameSite=Strict cookie scoped to /api/auth instead of in the body,
 * so page scripts never see it. /refresh and /signout then read it from the cookie,
 * and only when that header is present (a cross-site page can't add it).
 */
export function authRouter({ auth, db, config, requireAuth, limiters, beforeAccountDeleted }) {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/api/auth' };

  function sendSession(req, res, session, status = 200) {
    if (!isWebClient(req)) return res.status(status).json(session);
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions,
      expires: new Date(session.refreshTokenExpiresAt),
    });
    const { refreshToken, ...rest } = session; // eslint-disable-line no-unused-vars
    return res.status(status).json(rest);
  }

  const clearSessionCookie = (res) => res.clearCookie(REFRESH_COOKIE, cookieOptions);
  const refreshTokenFrom = (req) => req.valid.body.refreshToken ?? (isWebClient(req) ? readCookie(req, REFRESH_COOKIE) : null);

  router.post('/signup', limiters.auth, validate({ body: signUpBody }), async (req, res) => {
    sendSession(req, res, await auth.signUp(req.valid.body, clientContext(req)), 201);
  });

  router.post('/signin', limiters.auth, validate({ body: signInBody }), async (req, res) => {
    sendSession(req, res, await auth.signIn(req.valid.body, clientContext(req)));
  });

  router.post('/refresh', limiters.auth, validate({ body: refreshBody }), async (req, res) => {
    const token = refreshTokenFrom(req);
    if (!token) throw unauthorized('Your session has expired. Please sign in again.', 'invalid_refresh_token');
    try {
      sendSession(req, res, await auth.refresh(token, clientContext(req)));
    } catch (error) {
      if (isWebClient(req)) clearSessionCookie(res);
      throw error;
    }
  });

  router.post('/signout', validate({ body: refreshBody }), async (req, res) => {
    const token = refreshTokenFrom(req);
    if (token) await auth.signOut(token);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post('/signout-all', requireAuth, async (req, res) => {
    await auth.signOutEverywhere(req.user.id);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: users.toPublicUser(req.user) });
  });

  router.patch('/me', requireAuth, validate({ body: updateMeBody }), async (req, res) => {
    const user = await users.update(db, req.user.id, { displayName: req.valid.body.displayName });
    res.json({ user: users.toPublicUser(user) });
  });

  router.post(
    '/change-password',
    requireAuth,
    limiters.auth,
    validate({ body: changePasswordBody }),
    async (req, res) => {
      sendSession(req, res, await auth.changePassword(req.user, req.valid.body, clientContext(req)));
    },
  );

  router.delete('/me', requireAuth, limiters.auth, validate({ body: deleteMeBody }), async (req, res) => {
    await auth.deleteAccount(req.user, req.valid.body.password, { beforeDelete: beforeAccountDeleted });
    clearSessionCookie(res);
    res.status(204).end();
  });

  return router;
}
