// Row shapes returned by the database. Once the Supabase project is linked you
// can generate exact types with `npm run db:types`.

export type ItemKind = 'origin' | 'transfer' | 'backup';

export type Medium =
  | 'spore_print'
  | 'spore_syringe'
  | 'swab'
  | 'tissue'
  | 'culture'
  | 'agar'
  | 'lc'
  | 'slant'
  | 'other';

export type ItemStatus = 'active' | 'contaminated' | 'used' | 'archived' | 'discarded';

export type Membership = {
  account_id: string;
  user_id: string;
  role: 'owner' | 'member';
  initials: string;
  accounts: { name: string } | null;
};

export type Strain = {
  id: string;
  account_id: string;
  name: string;
  species: string | null;
  notes: string | null;
  created_at: string;
};

export type Item = {
  id: string;
  account_id: string;
  strain_id: string;
  parent_id: string | null;
  kind: ItemKind;
  medium: Medium;
  origin_prefix: string | null;
  origin_number: number | null;
  position: number | null;
  backup_number: number | null;
  code: string;
  generation: number;
  status: ItemStatus;
  location: string | null;
  made_on: string;
  initials: string;
  notes: string | null;
  created_at: string;
};

/** An item with the names of what it points at, for the culture screen. */
export type ItemWithRefs = Item & {
  media_batch_id: string | null;
  strains: { name: string } | null;
  media_batches: { code: string; sterilization_runs: { code: string } | null } | null;
};

/** Row shape of item_lineage() and strain_tree(). */
export type TreeRow = {
  id: string;
  parent_id: string | null;
  code: string;
  kind: ItemKind;
  medium: Medium;
  status: ItemStatus;
  generation: number;
  made_on: string;
  initials: string;
  depth: number;
};

export type LookupRow = {
  id: string;
  code: string;
  strain_id: string;
  strain_name: string;
  kind: ItemKind;
  medium: Medium;
  status: ItemStatus;
  made_on: string;
  initials: string;
  exact: boolean;
};

export type ItemEvent = {
  id: string;
  type: string;
  occurred_at: string;
  note: string | null;
  contam_type: string | null;
};

export type SterilizationMethod = 'pressure_cooker' | 'autoclave' | 'pasteurize' | 'other';

export type SterilizationRun = {
  id: string;
  account_id: string;
  code: string;
  method: SterilizationMethod;
  psi: number | null;
  minutes: number | null;
  run_on: string;
  notes: string | null;
  created_at: string;
};

export type MediaKind = 'agar' | 'lc' | 'other';

export type MediaBatch = {
  id: string;
  account_id: string;
  code: string;
  kind: MediaKind;
  recipe: string | null;
  sterilization_run_id: string | null;
  made_on: string;
  notes: string | null;
  created_at: string;
  sterilization_runs?: { code: string } | null;
};

export type TraceFactor = 'parent' | 'media_batch' | 'sterilization_run' | 'made_on';

/** Row shape of contamination_trace(). */
export type TraceRow = {
  factor: TraceFactor;
  factor_id: string;
  label: string;
  contaminated_with: number;
  clean_with: number;
  contaminated_total: number;
  clean_total: number;
  rate_with: number;
  rate_without: number | null;
  relative_risk: number;
  p_value: number;
};
