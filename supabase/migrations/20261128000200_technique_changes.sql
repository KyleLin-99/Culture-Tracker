-- Technique changes: dated notes like "Started using a flow hood" or "Switched
-- to 2% MEA". Stats draws them as markers on the contamination trend and compares
-- the plates made before and after each one.
--
-- Owners and techs add them; anyone can read. They're removed by setting
-- deleted_at (never hard-deleted), like everything else.

create table public.technique_changes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  changed_on  date not null,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (account_id, id)
);

create index technique_changes_account_idx on public.technique_changes (account_id, changed_on);

create trigger technique_changes_updated_at before update on public.technique_changes
  for each row execute function private.set_updated_at();

alter table public.technique_changes enable row level security;
create policy "members read" on public.technique_changes for select to authenticated
  using (private.is_member(account_id));
create policy "writers insert" on public.technique_changes for insert to authenticated
  with check (private.can_write(account_id));
create policy "writers update" on public.technique_changes for update to authenticated
  using (private.can_write(account_id)) with check (private.can_write(account_id));
revoke all on public.technique_changes from anon, authenticated;
grant select, insert, update on public.technique_changes to authenticated;
