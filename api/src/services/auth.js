import crypto from 'node:crypto';

import { timestamp } from '../db/index.js';
import { HttpError, conflict, unauthorized } from '../errors.js';
import * as refreshTokens from '../repositories/refreshTokens.js';
import * as users from '../repositories/users.js';

const invalidRefreshToken = () =>
  unauthorized('Your session has expired. Please sign in again.', 'invalid_refresh_token');

/** Sign-up, sign-in, session refresh/rotation, sign-out and password changes. */
export class AuthService {
  constructor({ db, passwords, tokens, logger }) {
    this.db = db;
    this.passwords = passwords;
    this.tokens = tokens;
    this.logger = logger;
  }

  async signUp({ email, password, displayName }, context = {}) {
    if (await users.findByEmail(this.db, email)) {
      throw conflict('An account with this email already exists', 'email_taken');
    }
    const passwordHash = await this.passwords.hash(password);
    let user;
    try {
      user = await users.create(this.db, { email, passwordHash, displayName: displayName ?? null });
    } catch (error) {
      // Two sign-ups for the same email at once: the unique index catches the second
      if (error.isUniqueViolation) throw conflict('An account with this email already exists', 'email_taken');
      throw error;
    }
    await users.recordLogin(this.db, user.id);
    this.logger.info('User signed up', { userId: user.id });
    return this.issueSession(await users.findById(this.db, user.id), context);
  }

  async signIn({ email, password }, context = {}) {
    const user = await users.findByEmail(this.db, email);
    // Verify against a dummy hash for unknown emails so response time doesn't reveal which accounts exist
    const valid = await this.passwords.verify(password, user?.password_hash ?? (await this.passwords.dummyHash()));
    if (!user || !valid) throw unauthorized('Incorrect email or password', 'invalid_credentials');
    if (!user.is_active) throw new HttpError(403, 'account_disabled', 'This account has been disabled');

    if (this.passwords.needsRehash(user.password_hash)) {
      await users.update(this.db, user.id, { passwordHash: await this.passwords.hash(password) });
    }
    await users.recordLogin(this.db, user.id);
    return this.issueSession(await users.findById(this.db, user.id), context);
  }

  /** Exchange a refresh token for a new session. The old refresh token stops working (rotation). */
  async refresh(refreshToken, context = {}) {
    const record = await refreshTokens.findByHash(this.db, this.tokens.hashToken(refreshToken));
    if (!record) throw invalidRefreshToken();

    if (record.revoked_at) {
      // A rotated-out token came back: someone kept a copy. End every session in this family.
      await refreshTokens.revokeFamily(this.db, record.family_id);
      this.logger.warn('Refresh token reuse detected; revoked its session family', { userId: record.user_id });
      throw invalidRefreshToken();
    }
    if (record.expires_at <= timestamp()) throw invalidRefreshToken();

    const user = await users.findById(this.db, record.user_id);
    if (!user || !user.is_active) {
      await refreshTokens.revoke(this.db, record.id);
      throw invalidRefreshToken();
    }
    // Only one of two concurrent refreshes with the same token wins
    if (!(await refreshTokens.revoke(this.db, record.id))) throw invalidRefreshToken();
    return this.issueSession(user, context, record.family_id);
  }

  /** Revoke one refresh token. Unknown or already-revoked tokens are ignored. */
  async signOut(refreshToken) {
    const record = await refreshTokens.findByHash(this.db, this.tokens.hashToken(refreshToken));
    if (record && !record.revoked_at) await refreshTokens.revoke(this.db, record.id);
  }

  /** End every session for a user: refresh tokens revoked, outstanding access tokens rejected. */
  async signOutEverywhere(userId) {
    await this.db.transaction(async (tx) => {
      await refreshTokens.revokeAllForUser(tx, userId);
      await users.update(tx, userId, { bumpTokenVersion: true });
    });
  }

  async changePassword(user, { currentPassword, newPassword }, context = {}) {
    if (!(await this.passwords.verify(currentPassword, user.password_hash))) {
      throw new HttpError(400, 'invalid_password', 'Current password is incorrect');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await users.update(tx, user.id, { passwordHash, bumpTokenVersion: true });
      await refreshTokens.revokeAllForUser(tx, user.id);
    });
    // Other devices are signed out; this one gets a fresh session
    return this.issueSession(await users.findById(this.db, user.id), context);
  }

  /** beforeDelete(userId) runs after the checks pass, e.g. to remove the user's uploaded books' passages. */
  async deleteAccount(user, password, { beforeDelete } = {}) {
    if (!(await this.passwords.verify(password, user.password_hash))) {
      throw new HttpError(400, 'invalid_password', 'Password is incorrect');
    }
    if (user.role === 'admin' && user.is_active && (await users.countActiveAdmins(this.db)) <= 1) {
      throw conflict('You are the only admin. Make someone else an admin before deleting your account.', 'last_admin');
    }
    if (beforeDelete) await beforeDelete(user.id);
    await users.remove(this.db, user.id);
    this.logger.info('User deleted their account', { userId: user.id });
  }

  async issueSession(user, context = {}, familyId = crypto.randomUUID()) {
    const { token, hash, expiresAt } = this.tokens.newRefreshToken();
    await refreshTokens.create(this.db, {
      userId: user.id,
      tokenHash: hash,
      familyId,
      expiresAt,
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ip: context.ip ?? null,
    });
    return {
      user: users.toPublicUser(user),
      tokenType: 'Bearer',
      accessToken: this.tokens.signAccessToken(user),
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken: token,
      refreshTokenExpiresAt: expiresAt,
    };
  }
}
