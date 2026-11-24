import type { SqlDb } from './sql';

// Local copy of the lab. Mirrors the Supabase tables (see supabase/migrations),
// minus server-only rules: the server stays the source of truth.
// Bump SCHEMA_VERSION and add a step to MIGRATIONS for any change.

export const SCHEMA_VERSION = 4;

const MIGRATIONS: Record<number, string> = {
  1: `
    create table strains (
      id text primary key, account_id text not null, name text not null, species text, notes text,
      created_at text, updated_at text not null, deleted_at text
    );
    create table sterilization_runs (
      id text primary key, account_id text not null, code text not null, method text not null,
      psi real, minutes integer, run_on text, notes text,
      created_at text, updated_at text not null, deleted_at text
    );
    create table media_batches (
      id text primary key, account_id text not null, code text not null, kind text not null, recipe text,
      sterilization_run_id text, made_on text, notes text,
      created_at text, updated_at text not null, deleted_at text
    );
    create table items (
      id text primary key, account_id text not null, strain_id text not null, parent_id text,
      kind text not null, medium text not null, origin_prefix text, origin_number integer,
      position integer, backup_number integer, code text not null, generation integer not null,
      status text not null, location text, media_batch_id text, made_on text not null,
      initials text not null, notes text, aliases text not null default '[]',
      created_at text, updated_at text not null, deleted_at text
    );
    create index items_parent_idx on items (parent_id);
    create index items_code_idx on items (code);
    create index items_strain_idx on items (strain_id);
    create index items_created_idx on items (created_at);
    create table events (
      id text primary key, account_id text not null, item_id text not null, type text not null,
      occurred_at text not null, note text, contam_type text, photo_key text,
      created_at text, updated_at text not null, deleted_at text
    );
    create index events_item_idx on events (item_id, occurred_at);
    -- account_id: whose lab this copy is. pulled_until_<table>: newest updated_at seen.
    create table meta (key text primary key, value text);
  `,
  // Offline writing: rows made on the phone and not yet confirmed by the server
  // carry local_pending = 1; the outbox holds the changes to send, in order.
  2: `
    alter table strains add column local_pending integer not null default 0;
    alter table items add column local_pending integer not null default 0;
    alter table events add column local_pending integer not null default 0;
    create table relabels (
      id text primary key, account_id text not null, entity text not null, entity_id text not null,
      old_code text not null, new_code text not null, resolved_at text,
      created_at text, updated_at text not null, deleted_at text,
      local_pending integer not null default 0
    );
    create table outbox (
      seq integer primary key autoincrement,
      op text not null,
      payload text not null,
      created_at text not null,
      status text not null default 'pending',  -- pending | failed
      error text,
      attempts integer not null default 0
    );
  `,
  // Recipes (read-only on the phone, like batches and runs). Batches made
  // before this have no recipe, so the copy needs no re-pull.
  3: `
    create table recipes (
      id text primary key, account_id text not null, family_id text not null, version integer not null,
      name text not null, kind text not null, volume_ml real not null, ingredients text not null default '[]',
      steps text, created_at text, updated_at text not null, deleted_at text
    );
    create index recipes_family_idx on recipes (family_id, version);
    alter table media_batches add column recipe_id text;
    alter table media_batches add column volume_ml real;
  `,
  // Colonization checks: logged on the phone (offline too) and synced. All of
  // them are kept, old ones included, since vigor compares with ancestors.
  4: `
    create table colonization_checks (
      id text primary key, account_id text not null, item_id text not null, checked_on text not null,
      percent real, radius_mm real, note text, source text not null default 'manual',
      created_at text, updated_at text not null, deleted_at text, local_pending integer not null default 0
    );
    create index colonization_checks_item_idx on colonization_checks (item_id, checked_on);
  `,
};

/** Creates or upgrades the local tables. Safe to call on every app start. */
export async function migrate(db: SqlDb, upTo = SCHEMA_VERSION): Promise<void> {
  const row = await db.first<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  for (let v = current + 1; v <= upTo; v += 1) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[v]);
      await db.exec(`pragma user_version = ${v}`);
    });
  }
}

export async function getMeta(db: SqlDb, key: string): Promise<string | null> {
  const row = await db.first<{ value: string }>('select value from meta where key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(db: SqlDb, key: string, value: string | null): Promise<void> {
  if (value === null) await db.run('delete from meta where key = ?', [key]);
  else await db.run('insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [key, value]);
}

/** Empties the local copy (sign-out, or a different lab). */
export async function clearAll(db: SqlDb): Promise<void> {
  await db.transaction(async () => {
    await db.exec(
      'delete from outbox; delete from relabels; delete from events; delete from items; delete from colonization_checks; delete from media_batches; delete from recipes; delete from sterilization_runs; delete from strains; delete from meta;',
    );
  });
}
