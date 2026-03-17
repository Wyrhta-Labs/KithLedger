import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { logError } from '../lib/logger.js';

export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof ZodError) {
    // In production, omit field-level details to avoid leaking schema information
    const details =
      process.env.NODE_ENV !== 'production' ? error.flatten().fieldErrors : undefined;
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          ...(details ? { details } : {}),
        },
      },
      400
    );
  }

  logError('Unhandled error', error);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    500
  );
};
