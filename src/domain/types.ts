// Row shapes returned by the database. Once the Supabase project is linked you
// can generate exact types with `npm run db:types`.

export type ItemKind = 'origin' | 'transfer' | 'backup';

/** A member's role in a lab (docs/design/lab-sharing.md). */
export type Role = 'owner' | 'tech' | 'viewer';

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
  role: Role;
  initials: string;
  accounts: { name: string } | null;
};

/** Someone in a lab, as the People screen lists them. */
export type Member = { account_id: string; user_id: string; role: Role; initials: string; created_at: string };

/** An unused invite (the code itself is shown once, when made). */
export type Invite = { id: string; role: Role; created_at: string; expires_at: string };

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
  /** The backup this culture refreshes, if any. */
  refresh_of?: string | null;
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

/** How far a culture had grown on a day: percent of the plate and/or colony radius. */
export type ColonizationCheck = {
  id: string;
  item_id: string;
  checked_on: string;
  percent: number | null;
  radius_mm: number | null;
  note: string | null;
  source: 'manual' | 'photo';
  created_at: string;
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
  /** The exact recipe version this batch was mixed from, and how much was made. */
  recipe_id: string | null;
  volume_ml: number | null;
  made_on: string;
  notes: string | null;
  created_at: string;
  sterilization_runs?: { code: string } | null;
  recipes?: { name: string; version: number; family_id?: string } | null;
};

export type Ingredient = { name: string; amount: number; unit: string };

/** One saved version of a recipe. Versions of the same recipe share family_id. */
export type Recipe = {
  id: string;
  account_id: string;
  family_id: string;
  version: number;
  name: string;
  kind: MediaKind;
  volume_ml: number;
  ingredients: Ingredient[];
  steps: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type TraceFactor = 'parent' | 'media_batch' | 'sterilization_run' | 'recipe' | 'made_on';

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

/** A dated change in how the lab works, shown as a marker on the contamination trend. */
export type TechniqueChange = {
  id: string;
  account_id: string;
  changed_on: string;
  title: string;
  note: string | null;
  created_at: string;
};
