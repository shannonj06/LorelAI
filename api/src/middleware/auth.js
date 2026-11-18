import { forbidden, unauthorized } from '../errors.js';
import * as users from '../repositories/users.js';

/**
 * requireAuth: accepts "Authorization: Bearer <access token>" and sets req.user to
 * the current database row. Loading the user on every request (one indexed
 * lookup) means disabling an account, changing a role, or "sign out everywhere"
 * takes effect immediately instead of when the token expires.
 */
export function createRequireAuth({ db, tokens }) {
  return async function requireAuth(req, res, next) {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized();

    let claims;
    try {
      claims = tokens.verifyAccessToken(token);
    } catch (error) {
      if (error.name === 'TokenExpiredError') throw unauthorized('Your session has expired', 'token_expired');
      throw unauthorized('Invalid access token', 'invalid_token');
    }

    const user = await users.findById(db, Number(claims.sub));
    if (!user || user.token_version !== claims.ver) {
      throw unauthorized('This session is no longer valid. Please sign in again.', 'invalid_token');
    }
    if (!user.is_active) throw forbidden('This account has been disabled', 'account_disabled');

    req.user = user;
    next();
  };
}

export const requireRole = (role) =>
  function checkRole(req, res, next) {
    if (req.user?.role !== role) throw forbidden();
    next();
  };
