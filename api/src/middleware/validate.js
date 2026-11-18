import { z } from 'zod';

import { badRequest } from '../errors.js';

/**
 * Validate request parts with zod schemas. Parsed values go on req.valid.{body,query,params}
 * (Express 5 makes req.query read-only, so the originals are left alone).
 */
export function validate(schemas) {
  return function validateRequest(req, res, next) {
    req.valid ??= {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        throw badRequest(
          'Some fields are missing or invalid',
          result.error.issues.map((issue) => ({ field: [part, ...issue.path].join('.'), message: issue.message })),
        );
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};
