import { HttpError } from '../errors.js';

/** Every error response has the shape {"error": {"code", "message", "details"?}, "requestId"}. */
export function errorHandler(logger) {
  // Express recognizes error handlers by their four parameters
  // eslint-disable-next-line no-unused-vars
  return function handleError(error, req, res, next) {
    let status;
    let code;
    let message;
    let details;

    if (error instanceof HttpError) {
      ({ status, code, message, details } = error);
    } else if (error.type === 'entity.parse.failed') {
      [status, code, message] = [400, 'invalid_json', 'The request body is not valid JSON'];
    } else if (error.type === 'entity.too.large') {
      [status, code, message] = [413, 'payload_too_large', 'The request body is too large'];
    } else if (error.expose && error.status >= 400 && error.status < 500) {
      // Other body-parser errors (unsupported charset, etc.)
      [status, code, message] = [error.status, 'invalid_request', error.message];
    } else {
      [status, code, message] = [500, 'internal_error', 'Something went wrong on our side'];
      logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${error.stack ?? error}`, {
        requestId: req.id,
      });
    }

    if (status === 401) res.set('WWW-Authenticate', 'Bearer');
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId: req.id });
  };
}
