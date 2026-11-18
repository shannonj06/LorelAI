import { rateLimit } from 'express-rate-limit';

import { HttpError } from '../errors.js';

const passThrough = (req, res, next) => next();
const HOUR = 60 * 60 * 1000;

/**
 * In-memory limiters: fine for one API process. With several instances behind a
 * load balancer, give each limiter a shared store (e.g. rate-limit-redis).
 * A limit of 0 turns that limiter off.
 */
export function createRateLimiters({ authPer15Minutes, askPerHour, trialPerHour, uploadsPerHour }) {
  const handler = (req, res, next, options) =>
    next(
      new HttpError(429, 'rate_limited', 'Too many requests. Please wait and try again.', {
        retryAfterSeconds: Math.ceil(options.windowMs / 1000),
      }),
    );
  const common = { standardHeaders: 'draft-8', legacyHeaders: false, handler };
  const perUser = (req) => `user:${req.user.id}`;
  const make = (limit, options) => (limit > 0 ? rateLimit({ ...common, limit, ...options }) : passThrough);

  return {
    // Brute-force protection for credential endpoints, per client IP
    auth: make(authPer15Minutes, { windowMs: 15 * 60 * 1000 }),
    // Cost control: every question is a model call. These run after requireAuth, so they're per user.
    ask: make(askPerHour, { windowMs: HOUR, keyGenerator: perUser }),
    upload: make(uploadsPerHour, { windowMs: HOUR, keyGenerator: perUser }),
    // The anonymous landing-page demo, per IP (on top of its per-visitor question limit)
    trial: make(trialPerHour, { windowMs: HOUR }),
  };
}
