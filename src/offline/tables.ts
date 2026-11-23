// Which server tables the phone keeps, and which columns. Embedded relations
// (strains(name) etc.) are rebuilt locally with joins.

export const TABLES = {
  strains: ['id', 'account_id', 'name', 'species', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  sterilization_runs: [
    'id', 'account_id', 'code', 'method', 'psi', 'minutes', 'run_on', 'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  media_batches: [
    'id', 'account_id', 'code', 'kind', 'recipe', 'sterilization_run_id', 'made_on', 'notes', 'created_at', 'updated_at',
    'deleted_at',
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
} as const;

export type TableName = keyof typeof TABLES;

/** Pull order: parents before the rows that point at them. */
export const PULL_ORDER: TableName[] = ['strains', 'sterilization_runs', 'media_batches', 'items', 'events'];

/** A row as it arrives from Supabase. */
export type RemoteRow = Record<string, unknown> & { id: string; updated_at: string };
