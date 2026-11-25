// Turns server refusals into sentences a grower can act on.

/** Postgres "insufficient privilege": row-level security refused the change. */
const RLS = /row-level security|permission denied/i;

const LIMIT_LABEL: Record<string, string> = {
  labs_owned: 'labs you own',
  labs_joined: 'labs you can join',
  members_per_lab: 'people in a lab',
  strains: 'strains',
  cultures: 'cultures',
  batches_and_runs: 'media batches and sterilization runs',
  recipes: 'recipes',
  active_share_links: 'active share links',
  pending_invites: 'pending invites',
};

/** "limit_reached:strains:25" from the database, as a sentence. */
function limitMessage(raw: string): string | null {
  const m = /limit_reached:([a-z_]+):(\d+)/.exec(raw);
  if (!m) return null;
  const what = LIMIT_LABEL[m[1]] ?? m[1].replace(/_/g, ' ');
  return `You've reached your plan's limit for ${what} (${m[2]}). Remove one you no longer need, or ask the app's owner about a bigger plan.`;
}

/**
 * A readable message for a database error. Row-level security refusals (a viewer
 * trying to change something, a tech trying to change lab settings) get a sentence
 * about roles; errors our own functions raise are already readable and pass through.
 */
export function friendlyError(raw: string, code?: string): string {
  const limit = limitMessage(raw);
  if (limit) return limit;
  if (RLS.test(raw) || (code === '42501' && !/^(Viewers|Only|Not a member)/.test(raw))) {
    return "Your role in this lab can't make this change. Ask the lab's owner.";
  }
  return raw;
}
