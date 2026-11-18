import crypto from 'node:crypto';

/**
 * Give each request an ID (echoed as X-Request-Id) and log one line when it finishes.
 * Bodies and query strings (which can carry book titles) are never logged.
 */
export function requestLogger(logger) {
  return function logRequest(req, res, next) {
    req.id = crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : 'info';
      logger[level](`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`, {
        requestId: req.id,
        ...(req.user ? { userId: req.user.id } : {}),
      });
    });
    next();
  };
}
