/**
 * An error with an HTTP status and a stable machine-readable code.
 * The error handler turns it into {"error": {"code", "message", "details"?}}.
 */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'invalid_request', message, details);
export const unauthorized = (message = 'Sign in to continue', code = 'unauthorized') =>
  new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that', code = 'forbidden') =>
  new HttpError(403, code, message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message, code = 'conflict') => new HttpError(409, code, message);
