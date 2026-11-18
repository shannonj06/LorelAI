import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { createTestContext } from './helpers.js';

function fakeBuild() {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'lorelai-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>LorelAI</title><div id="root"></div>');
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  return dist;
}

describe('serving the built site', () => {
  test('serves index.html for client routes and hashed assets with long caching', async () => {
    const ctx = await createTestContext({ FRONTEND_DIST: fakeBuild() });

    for (const route of ['/', '/try', '/app', '/app/chat/3']) {
      const res = await ctx.api().get(route);
      assert.equal(res.status, 200, route);
      assert.match(res.text, /<div id="root">/);
    }
    const asset = await ctx.api().get('/assets/app-abc123.js');
    assert.match(asset.headers['cache-control'], /immutable/);
  });

  test('API paths still return JSON errors, never the page', async () => {
    const ctx = await createTestContext({ FRONTEND_DIST: fakeBuild() });

    const res = await ctx.api().get('/api/nope');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });

  test('the page gets a strict Content-Security-Policy', async () => {
    const ctx = await createTestContext({ FRONTEND_DIST: fakeBuild() });

    const csp = (await ctx.api().get('/')).headers['content-security-policy'];

    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co/);
    assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  });

  test('without a build, / describes the API', async () => {
    const ctx = await createTestContext();

    const res = await ctx.api().get('/');

    assert.equal(res.body.name, 'LorelAI API');
  });
});
