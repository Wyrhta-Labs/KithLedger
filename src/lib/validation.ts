import type { Context } from 'hono';
import type { ZodError } from 'zod';
import { err } from '@wyrhta/core/http';

/**
 * A bare "Invalid request body" tells the caller nothing about *what* was
 * wrong, which makes client bugs (an empty string where the schema wants an
 * email, a `datetime-local` value where it wants ISO-8601 UTC) undiagnosable
 * without server-side guesswork.
 *
 * Core's `err()` takes no `details` argument, so the offending field paths are
 * folded into the message instead — the response shape stays `{ code, message }`
 * and the web UI's existing toast surfaces it as-is.
 */
export function validationError(c: Context, error: ZodError, what = 'request body') {
  const fields = error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
  return err(c, 'VALIDATION_ERROR', `Invalid ${what}${fields ? ` — ${fields}` : ''}`, 400);
}
