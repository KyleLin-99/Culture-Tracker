// Turns server refusals into sentences a grower can act on.

/** Postgres "insufficient privilege": row-level security refused the change. */
const RLS = /row-level security|permission denied/i;

/**
 * A readable message for a database error. Row-level security refusals (a viewer
 * trying to change something, a tech trying to change lab settings) get a sentence
 * about roles; errors our own functions raise are already readable and pass through.
 */
export function friendlyError(raw: string, code?: string): string {
  if (RLS.test(raw) || (code === '42501' && !/^(Viewers|Only|Not a member)/.test(raw))) {
    return "Your role in this lab can't make this change. Ask the lab's owner.";
  }
  return raw;
}
