// Which server tables the phone keeps, and which columns. Embedded relations
// (strains(name) etc.) are rebuilt locally with joins.

export const TABLES = {
  strains: ['id', 'account_id', 'name', 'species', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  sterilization_runs: [
    'id', 'account_id', 'code', 'method', 'psi', 'minutes', 'run_on', 'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  recipes: [
    'id', 'account_id', 'family_id', 'version', 'name', 'kind', 'volume_ml', 'ingredients', 'steps', 'created_at',
    'updated_at', 'deleted_at',
  ],
  media_batches: [
    'id', 'account_id', 'code', 'kind', 'recipe', 'sterilization_run_id', 'recipe_id', 'volume_ml', 'made_on', 'notes',
    'created_at', 'updated_at', 'deleted_at',
  ],
  items: [
    'id', 'account_id', 'strain_id', 'parent_id', 'kind', 'medium', 'origin_prefix', 'origin_number', 'position',
    'backup_number', 'code', 'generation', 'status', 'location', 'media_batch_id', 'made_on', 'initials', 'notes',
    'aliases', 'created_at', 'updated_at', 'deleted_at',
  ],
  events: [
    'id', 'account_id', 'item_id', 'type', 'occurred_at', 'note', 'contam_type', 'photo_key', 'created_at', 'updated_at',
    'deleted_at',
  ],
  colonization_checks: [
    'id', 'account_id', 'item_id', 'checked_on', 'percent', 'radius_mm', 'note', 'source', 'created_at', 'updated_at',
    'deleted_at',
  ],
  relabels: [
    'id', 'account_id', 'entity', 'entity_id', 'old_code', 'new_code', 'resolved_at', 'created_at', 'updated_at',
    'deleted_at',
  ],
} as const;

/** Tables whose rows can be changed on the phone before the server confirms them. */
export const PENDING_TABLES: TableName[] = ['strains', 'items', 'events', 'colonization_checks', 'relabels'];

export type TableName = keyof typeof TABLES;

/** Pull order: parents before the rows that point at them. */
export const PULL_ORDER: TableName[] = ['strains', 'sterilization_runs', 'recipes', 'media_batches', 'items', 'events', 'colonization_checks', 'relabels'];

/** A row as it arrives from Supabase. */
export type RemoteRow = Record<string, unknown> & { id: string; updated_at: string };
