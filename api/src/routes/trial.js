import crypto from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { TRIAL_COOKIE, readCookie } from '../cookies.js';
import { HttpError, badRequest } from '../errors.js';
import { validate } from '../middleware/validate.js';
import * as trialSessions from '../repositories/trialSessions.js';
import { answerQuestion } from '../services/answers.js';
import { httpStatusFor, isServiceFailure, toAskResponse } from '../services/rag/format.js';
import { RagError } from '../services/rag/worker.js';
import { hashToken } from '../services/tokens.js';
import { questionSchema } from './ask.js';

const trialBody = z.strictObject({
  question: questionSchema,
  history: z.array(z.string().trim().min(1).max(1000)).max(2).optional(),
});
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TRIAL_DAYS = 30;

/**
 * /api/trial: the landing page's live demo. No account needed, a few free questions
 * against the shared library. The visitor is identified by a random token in an
 * httpOnly cookie, with a per-IP daily cap so clearing cookies doesn't reset it.
 */
export function trialRouter({ db, rag, config, logger, limiters }) {
  const router = Router();
  const limit = config.trial.questionLimit;
  // Salted, so stored IP hashes can't be reversed by hashing every IPv4 address
  const hashIp = (ip) => crypto.createHash('sha256').update(`${config.auth.jwtSecret}:${ip}`).digest('hex');
  const summary = (used) => ({ limit, used, remaining: Math.max(0, limit - used) });

  function trialToken(req, res) {
    const existing = readCookie(req, TRIAL_COOKIE);
    if (existing && TOKEN.test(existing)) return existing;
    const token = crypto.randomBytes(32).toString('base64url');
    res.cookie(TRIAL_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/api/trial',
      maxAge: TRIAL_DAYS * 24 * 60 * 60 * 1000,
    });
    return token;
  }

  router.get('/', async (req, res) => {
    const token = readCookie(req, TRIAL_COOKIE);
    let used = 0;
    if (token && TOKEN.test(token)) {
      const session = await db.get('SELECT questions FROM trial_sessions WHERE token_hash = ?', [hashToken(token)]);
      used = session?.questions ?? 0;
    }
    res.json(summary(used));
  });

  router.post('/ask', limiters.trial, validate({ body: trialBody }), async (req, res) => {
    const { question, history } = req.valid.body;
    const ipHash = hashIp(req.ip);
    const session = await trialSessions.findOrCreate(db, { tokenHash: hashToken(trialToken(req, res)), ipHash });

    if ((await trialSessions.usedByIpToday(db, ipHash)) >= config.trial.ipDailyLimit) {
      throw new HttpError(
        429,
        'trial_ip_limit',
        'The free questions from this network are used up for today. Create a free account to keep asking.',
        summary(limit),
      );
    }
    if (!(await trialSessions.reserve(db, session.id, limit))) {
      throw new HttpError(
        403,
        'trial_exhausted',
        `You've used your ${limit} free questions. Create a free account to keep asking.`,
        summary(limit),
      );
    }

    let result;
    try {
      result = await answerQuestion({ db, rag, config, logger }, {
        params: { question, book_ids: null, history: history ?? [] },
        channel: 'trial',
      });
    } catch (error) {
      await trialSessions.refund(db, session.id);
      if (error instanceof RagError && error.code === 'bad_request') throw badRequest(error.message);
      throw error;
    }
    const { outcome, latencyMs } = result;
    // Outages don't use up a free question; refusals and "not in the books" do
    if (isServiceFailure(outcome)) await trialSessions.refund(db, session.id);

    const trial = summary(await trialSessions.used(db, session.id));
    res.status(httpStatusFor(outcome)).json(toAskResponse(outcome, { question, latencyMs, extra: { trial } }));
  });

  return router;
}
