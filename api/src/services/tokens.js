import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

const ISSUER = 'lorelai-api';
const AUDIENCE = 'lorelai';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Access tokens: short-lived HS256 JWTs carrying the user ID, role, and token
 * version. Refresh tokens: random opaque strings, stored only as SHA-256 hashes.
 */
export function createTokenService({ jwtSecret, accessTokenTtlSeconds, refreshTokenTtlDays }) {
  return {
    accessTokenTtlSeconds,

    signAccessToken(user) {
      return jwt.sign({ role: user.role, ver: user.token_version }, jwtSecret, {
        algorithm: 'HS256',
        subject: String(user.id),
        expiresIn: accessTokenTtlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    },

    /** Returns the claims, or throws jsonwebtoken's TokenExpiredError / JsonWebTokenError. */
    verifyAccessToken(token) {
      return jwt.verify(token, jwtSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    },

    newRefreshToken() {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000).toISOString();
      return { token, hash: hashToken(token), expiresAt };
    },

    hashToken,
  };
}
