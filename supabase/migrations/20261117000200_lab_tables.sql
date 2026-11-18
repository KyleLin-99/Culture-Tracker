-- Lab tables: strains, sterilization runs, media batches, items (cultures), events.
--
-- Conventions
--   * id is a UUID the phone may generate itself (needed for offline sync later).
--   * Every table has account_id and a unique (account_id, id) so foreign keys can
--     be composite: a row can only point at rows in the same account.
--   * Rows are never hard-deleted; deleted_at marks them (deletes must sync too).

-- ---------------------------------------------------------------------------
-- Strains
-- ---------------------------------------------------------------------------

create table public.strains (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  species     text,
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (account_id, id)
);

create unique index strains_name_uq
  on public.strains (account_id, lower(name))
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Sterilization runs and media batches
-- ---------------------------------------------------------------------------

create table public.sterilization_runs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  code        text,
  method      text not null check (method in ('pressure_cooker', 'autoclave', 'pasteurize', 'other')),
  psi         numeric(5, 1),
  minutes     integer check (minutes > 0),
  run_on      date not null default current_date,
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (account_id, id)
);

create table public.media_batches (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete cascade,
  code                  text,
  kind                  text not null check (kind in ('agar', 'lc', 'other')),
  recipe                text,
  sterilization_run_id  uuid,
  made_on               date not null default current_date,
  notes                 text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (account_id, id),
  foreign key (account_id, sterilization_run_id)
    references public.sterilization_runs (account_id, id)
);

-- ---------------------------------------------------------------------------
-- Items: every tracked culture
-- ---------------------------------------------------------------------------
--
-- Culture code rules (built by the trigger in the next migration, never by hand):
--   origin    S, W, C or source initials; a number only once there are several
--             with that prefix in the strain: S, S2, S3 / TBG, TBG2
--   transfer  numbers and letters alternate: S-2 -> S-2A -> S-2A1 -> S-2A1B
--   backup    parent code + (n):              S-2A1(2)
--   revived   new dash, starts with a number: S-2A1(2)-1
--   limit     20 characters total, including dashes and parentheses
--
-- strain + code is unique, so strain + date + initials + code always is too.

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  strain_id       uuid not null,
  parent_id       uuid,
  kind            text not null check (kind in ('origin', 'transfer', 'backup')),
  medium          text not null check (medium in (
                    'spore_print', 'spore_syringe', 'swab', 'tissue', 'culture',
                    'agar', 'lc', 'slant', 'other')),
  origin_prefix   text check (origin_prefix ~ '^[A-Z]{1,6}$'),
  origin_number   integer check (origin_number >= 2),
  position        integer check (position >= 1),
  backup_number   integer check (backup_number >= 1),
  code            text not null,
  generation      integer not null default 0,
  status          text not null default 'active'
                    check (status in ('active', 'contaminated', 'used', 'archived', 'discarded')),
  location        text,
  media_batch_id  uuid,
  made_on         date not null default current_date,
  initials        text not null check (initials ~ '^[A-Z]{1,6}$'),
  notes           text,
  aliases         text[] not null default '{}',
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  unique (account_id, id),
  unique (strain_id, code),
  foreign key (account_id, strain_id)      references public.strains (account_id, id),
  foreign key (account_id, parent_id)      references public.items (account_id, id),
  foreign key (account_id, media_batch_id) references public.media_batches (account_id, id),

  constraint items_code_max_20 check (char_length(code) <= 20),
  constraint items_kind_shape check (
       (kind = 'origin'   and parent_id is null     and origin_prefix is not null
                          and position is null      and backup_number is null)
    or (kind = 'transfer' and parent_id is not null and origin_prefix is null and origin_number is null
                          and position is not null  and backup_number is null)
    or (kind = 'backup'   and parent_id is not null and origin_prefix is null and origin_number is null
                          and position is null      and backup_number is not null)
  )
);

create unique index items_transfer_position_uq on public.items (parent_id, position)      where kind = 'transfer';
create unique index items_backup_number_uq     on public.items (parent_id, backup_number) where kind = 'backup';
create unique index items_origin_uq
  on public.items (strain_id, origin_prefix, coalesce(origin_number, 1))
  where kind = 'origin';

create index items_parent_idx        on public.items (parent_id);
create index items_account_code_idx  on public.items (account_id, code);
create index items_account_recent_idx on public.items (account_id, created_at desc);
create index items_aliases_idx       on public.items using gin (aliases);

-- ---------------------------------------------------------------------------
-- Events: the history of each item
-- ---------------------------------------------------------------------------

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  item_id      uuid not null,
  type         text not null check (type in (
                 'transferred', 'backed_up', 'checked', 'contaminated',
                 'status_changed', 'photo', 'note')),
  occurred_at  timestamptz not null default now(),
  note         text,
  contam_type  text,
  photo_key    text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (account_id, id),
  foreign key (account_id, item_id) references public.items (account_id, id)
);

create index events_item_idx on public.events (item_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger strains_updated_at            before update on public.strains            for each row execute function private.set_updated_at();
create trigger sterilization_runs_updated_at before update on public.sterilization_runs for each row execute function private.set_updated_at();
create trigger media_batches_updated_at      before update on public.media_batches      for each row execute function private.set_updated_at();
create trigger items_updated_at              before update on public.items              for each row execute function private.set_updated_at();
create trigger events_updated_at             before update on public.events             for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: members see and change only their account's rows.
-- No delete policies: rows are soft-deleted with deleted_at.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['strains', 'sterilization_runs', 'media_batches', 'items', 'events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "members read" on public.%I for select to authenticated using (private.is_member(account_id))', t);
    execute format(
      'create policy "members insert" on public.%I for insert to authenticated with check (private.is_member(account_id))', t);
    execute format(
      'create policy "members update" on public.%I for update to authenticated using (private.is_member(account_id)) with check (private.is_member(account_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end;
$$;
