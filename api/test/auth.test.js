import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { silentLogger } from '../src/logger.js';
import { bearer, createTestContext, PASSWORD } from './helpers.js';

let ctx;
beforeEach(async () => {
  ctx = await createTestContext();
});

describe('sign up', () => {
  test('creates an account and returns a session', async () => {
    const res = await ctx.api()
      .post('/api/auth/signup')
      .send({ email: '  New.User@Example.com ', password: PASSWORD, displayName: 'New User' });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'new.user@example.com');
    assert.equal(res.body.user.displayName, 'New User');
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.tokenType, 'Bearer');
    assert.equal(res.body.expiresIn, 900);
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.password_hash, undefined);

    const stored = await ctx.db.get('SELECT password_hash FROM users WHERE email = ?', ['new.user@example.com']);
    assert.match(stored.password_hash, /^scrypt\$1024\$8\$2\$/);
    assert.ok(!stored.password_hash.includes(PASSWORD));
  });

  test('rejects a duplicate email regardless of case', async () => {
    await ctx.signUp('taken@example.com');

    const res = await ctx.api().post('/api/auth/signup').send({ email: 'TAKEN@example.com', password: PASSWORD });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'email_taken');
  });

  test('validates email, password length and unknown fields', async () => {
    const cases = [
      [{ email: 'not-an-email', password: PASSWORD }, 'body.email'],
      [{ email: 'a@example.com', password: 'short' }, 'body.password'],
      [{ email: 'a@example.com', password: 'x'.repeat(129) }, 'body.password'],
      [{ email: 'a@example.com', password: PASSWORD, role: 'admin' }, 'body'],
      [{}, 'body.email'],
    ];
    for (const [body, field] of cases) {
      const res = await ctx.api().post('/api/auth/signup').send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'invalid_request');
      assert.ok(res.body.error.details.some((d) => d.field === field), `${field} in ${JSON.stringify(res.body)}`);
    }
  });

  test('cannot sign yourself up as an admin', async () => {
    const res = await ctx.api()
      .post('/api/auth/signup')
      .send({ email: 'sneaky@example.com', password: PASSWORD, role: 'admin' });

    assert.equal(res.status, 400);
    assert.equal(await ctx.db.get("SELECT id FROM users WHERE email = 'sneaky@example.com'"), null);
  });

  test('rejects malformed JSON with a clear error', async () => {
    const res = await ctx.api().post('/api/auth/signup').set('Content-Type', 'application/json').send('{"email":');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_json');
  });
});

describe('sign in', () => {
  test('returns a session for the right password', async () => {
    await ctx.signUp('reader@example.com');

    const res = await ctx.api().post('/api/auth/signin').send({ email: 'Reader@example.com', password: PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'reader@example.com');
    assert.ok(res.body.user.lastLoginAt);
  });

  test('gives the same error for a wrong password and an unknown email', async () => {
    await ctx.signUp('reader@example.com');

    const wrong = await ctx.api().post('/api/auth/signin').send({ email: 'reader@example.com', password: 'nope-nope' });
    const unknown = await ctx.api().post('/api/auth/signin').send({ email: 'ghost@example.com', password: PASSWORD });

    for (const res of [wrong, unknown]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'invalid_credentials');
      assert.equal(res.body.error.message, 'Incorrect email or password');
      assert.equal(res.headers['www-authenticate'], 'Bearer');
    }
  });

  test('upgrades an old password hash on sign-in', async () => {
    await ctx.signUp('reader@example.com');
    // Same database, but the server now hashes with a higher cost
    const config = { ...ctx.config, auth: { ...ctx.config.auth, scryptCost: 11 } };
    const app = createApp({ config, db: ctx.db, rag: ctx.rag, logger: silentLogger });

    const res = await request(app).post('/api/auth/signin').send({ email: 'reader@example.com', password: PASSWORD });

    assert.equal(res.status, 200);
    const stored = await ctx.db.get("SELECT password_hash FROM users WHERE email = 'reader@example.com'");
    assert.match(stored.password_hash, /^scrypt\$2048\$/);
  });
});

describe('access tokens', () => {
  test('GET /me returns the signed-in user', async () => {
    const session = await ctx.signUp('me@example.com');

    const res = await ctx.api().get('/api/auth/me').set(bearer(session));

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'me@example.com');
  });

  test('rejects missing, malformed, forged and expired tokens', async () => {
    const session = await ctx.signUp();
    const claims = jwt.decode(session.accessToken);
    const forged = jwt.sign({ role: 'admin', ver: 0 }, 'some-other-secret-that-is-long-enough!!', {
      subject: claims.sub, issuer: 'lorelai-api', audience: 'lorelai',
    });
    const expired = jwt.sign({ role: 'user', ver: 0, exp: Math.floor(Date.now() / 1000) - 10 }, ctx.config.auth.jwtSecret, {
      subject: claims.sub, issuer: 'lorelai-api', audience: 'lorelai',
    });

    const cases = [
      [undefined, 'unauthorized'],
      ['Token abc', 'unauthorized'],
      ['Bearer not.a.jwt', 'invalid_token'],
      [`Bearer ${forged}`, 'invalid_token'],
      [`Bearer ${expired}`, 'token_expired'],
    ];
    for (const [header, code] of cases) {
      const req = ctx.api().get('/api/auth/me');
      if (header) req.set('Authorization', header);
      const res = await req;
      assert.equal(res.status, 401, String(header));
      assert.equal(res.body.error.code, code, String(header));
    }
  });

  test('a token for a deleted user stops working', async () => {
    const session = await ctx.signUp();
    await ctx.db.run('DELETE FROM users WHERE id = ?', [session.user.id]);

    const res = await ctx.api().get('/api/auth/me').set(bearer(session));

    assert.equal(res.status, 401);
  });

  test('PATCH /me updates the display name only', async () => {
    const session = await ctx.signUp();

    const res = await ctx.api().patch('/api/auth/me').set(bearer(session)).send({ displayName: '  Pat  ' });
    const sneaky = await ctx.api().patch('/api/auth/me').set(bearer(session)).send({ displayName: 'x', role: 'admin' });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.displayName, 'Pat');
    assert.equal(sneaky.status, 400);
  });
});

describe('refresh tokens', () => {
  test('refresh rotates the token; the old one stops working', async () => {
    const session = await ctx.signUp();

    const first = await ctx.api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.refreshToken, session.refreshToken);
    assert.ok(first.body.accessToken);

    const second = await ctx.api().post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });
    assert.equal(second.status, 200);
  });

  test('reusing a rotated token revokes the whole session family', async () => {
    const session = await ctx.signUp();
    const rotated = await ctx.api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });

    const reuse = await ctx.api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    const afterReuse = await ctx.api().post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken });

    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.error.code, 'invalid_refresh_token');
    assert.equal(afterReuse.status, 401);
  });

  test('other sessions survive a family revocation', async () => {
    const phone = await ctx.signUp('two@example.com');
    const laptop = (await ctx.api().post('/api/auth/signin').send({ email: 'two@example.com', password: PASSWORD })).body;
    await ctx.api().post('/api/auth/refresh').send({ refreshToken: phone.refreshToken });
    await ctx.api().post('/api/auth/refresh').send({ refreshToken: phone.refreshToken }); // reuse

    const res = await ctx.api().post('/api/auth/refresh').send({ refreshToken: laptop.refreshToken });

    assert.equal(res.status, 200);
  });

  test('unknown and expired refresh tokens are rejected', async () => {
    const session = await ctx.signUp();
    await ctx.db.run("UPDATE refresh_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");

    for (const refreshToken of ['made-up-token', session.refreshToken]) {
      const res = await ctx.api().post('/api/auth/refresh').send({ refreshToken });
      assert.equal(res.status, 401);
    }
  });

  test('refresh tokens are stored hashed', async () => {
    const session = await ctx.signUp();

    const rows = await ctx.db.all('SELECT token_hash FROM refresh_tokens');

    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, session.refreshToken);
    assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  });
});

describe('sign out', () => {
  test('sign-out revokes the refresh token and is idempotent', async () => {
    const session = await ctx.signUp();

    const out = await ctx.api().post('/api/auth/signout').send({ refreshToken: session.refreshToken });
    const again = await ctx.api().post('/api/auth/signout').send({ refreshToken: session.refreshToken });
    const refresh = await ctx.api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });

    assert.equal(out.status, 204);
    assert.equal(again.status, 204);
    assert.equal(refresh.status, 401);
  });

  test('sign-out-all ends every session, including outstanding access tokens', async () => {
    const one = await ctx.signUp('multi@example.com');
    const two = (await ctx.api().post('/api/auth/signin').send({ email: 'multi@example.com', password: PASSWORD })).body;

    const res = await ctx.api().post('/api/auth/signout-all').set(bearer(one));

    assert.equal(res.status, 204);
    assert.equal((await ctx.api().get('/api/auth/me').set(bearer(two))).status, 401);
    assert.equal((await ctx.api().post('/api/auth/refresh').send({ refreshToken: two.refreshToken })).status, 401);
  });
});

describe('password changes and account deletion', () => {
  test('change password signs out other sessions and returns a new one', async () => {
    const session = await ctx.signUp('pw@example.com');

    const wrong = await ctx.api().post('/api/auth/change-password').set(bearer(session))
      .send({ currentPassword: 'not-it-at-all', newPassword: 'a brand new password' });
    const res = await ctx.api().post('/api/auth/change-password').set(bearer(session))
      .send({ currentPassword: PASSWORD, newPassword: 'a brand new password' });

    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'invalid_password');
    assert.equal(res.status, 200);
    assert.equal((await ctx.api().get('/api/auth/me').set(bearer(session))).status, 401);
    assert.equal((await ctx.api().get('/api/auth/me').set(bearer(res.body))).status, 200);
    const oldPw = await ctx.api().post('/api/auth/signin').send({ email: 'pw@example.com', password: PASSWORD });
    const newPw = await ctx.api().post('/api/auth/signin').send({ email: 'pw@example.com', password: 'a brand new password' });
    assert.equal(oldPw.status, 401);
    assert.equal(newPw.status, 200);
  });

  test('a user can delete their own account and its history', async () => {
    const session = await ctx.signUp('leaving@example.com');
    await ctx.api().post('/api/chats').set(bearer(session)).send({ title: 'Mine', messages: [{ role: 'user', content: 'Hi?' }] });

    const wrong = await ctx.api().delete('/api/auth/me').set(bearer(session)).send({ password: 'wrong-password' });
    const res = await ctx.api().delete('/api/auth/me').set(bearer(session)).send({ password: PASSWORD });

    assert.equal(wrong.status, 400);
    assert.equal(res.status, 204);
    assert.equal(await ctx.db.get("SELECT id FROM users WHERE email = 'leaving@example.com'"), null);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM chats')).n, 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM refresh_tokens')).n, 0);
  });

  test('the only admin cannot delete their account', async () => {
    const admin = await ctx.createAdmin();

    const res = await ctx.api().delete('/api/auth/me').set(bearer(admin)).send({ password: PASSWORD });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'last_admin');
  });
});

describe('rate limiting', () => {
  test('sign-in attempts are limited per client', async () => {
    const limited = await createTestContext({ AUTH_RATE_LIMIT: '3' });
    const attempt = () => limited.api().post('/api/auth/signin').send({ email: 'x@example.com', password: 'whatever1' });

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);

    assert.deepEqual(statuses, [401, 401, 401, 429]);
    const res = await attempt();
    assert.equal(res.body.error.code, 'rate_limited');
    assert.ok(res.headers['retry-after']);
  });
});

describe('basics', () => {
  test('unknown routes return a JSON 404', async () => {
    const res = await ctx.api().get('/api/nope');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
    assert.ok(res.body.requestId);
  });

  test('security headers are set and x-powered-by is not', async () => {
    const res = await ctx.api().get('/api/health');

    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-request-id']);
  });

  test('CORS allows the configured frontend origin only', async () => {
    const allowed = await ctx.api().get('/api/health').set('Origin', 'http://localhost:5173');
    const other = await ctx.api().get('/api/health').set('Origin', 'https://evil.example');

    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(other.headers['access-control-allow-origin'], undefined);
  });

  test('health reports database and pipeline state', async () => {
    const ready = await ctx.api().get('/api/health');
    ctx.rag.state = 'starting';
    const starting = await ctx.api().get('/api/health');

    assert.equal(ready.status, 200);
    assert.deepEqual([ready.body.status, ready.body.database, ready.body.pipeline.state], ['ok', 'ok', 'ready']);
    assert.equal(starting.status, 200);
    assert.equal(starting.body.status, 'degraded');
  });
});

describe('browser sessions (refresh token in an httpOnly cookie)', () => {
  const web = (req) => req.set('X-LorelAI-Client', 'web');
  const cookieFrom = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('lorelai_rt='));

  test('sign-in sets an httpOnly, SameSite=Strict cookie and keeps the token out of the body', async () => {
    await ctx.signUp('web@example.com');

    const res = await web(ctx.api().post('/api/auth/signin')).send({ email: 'web@example.com', password: PASSWORD });

    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.refreshToken, undefined);
    const cookie = cookieFrom(res);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api\/auth/);
  });

  test('refresh and sign-out work from the cookie, and rotate it', async () => {
    const browser = request.agent(ctx.app);
    await web(browser.post('/api/auth/signup')).send({ email: 'agent@example.com', password: PASSWORD });

    const refreshed = await web(browser.post('/api/auth/refresh')).send({});
    const again = await web(browser.post('/api/auth/refresh')).send({});
    const out = await web(browser.post('/api/auth/signout')).send({});
    const after = await web(browser.post('/api/auth/refresh')).send({});

    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);
    assert.equal(again.status, 200); // the rotated cookie was stored by the browser
    assert.equal(out.status, 204);
    assert.equal(after.status, 401);
  });

  test('the cookie alone is not enough: the web-client header is required', async () => {
    const browser = request.agent(ctx.app);
    await web(browser.post('/api/auth/signup')).send({ email: 'csrf@example.com', password: PASSWORD });

    // What a cross-site form post would look like: the cookie, but no custom header
    const res = await browser.post('/api/auth/refresh').send({});

    assert.equal(res.status, 401);
  });

  test('CORS allows the web-client header from the configured origin', async () => {
    const res = await ctx.api().options('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-lorelai-client,content-type');

    assert.match(res.headers['access-control-allow-headers'], /X-LorelAI-Client/i);
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });
});
