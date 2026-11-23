-- Codes for sterilization runs (SR-001) and media batches (MB-001).
-- Filled in automatically per account when left blank; a typed code is kept
-- (upper-cased). Codes are unique per account among rows not deleted.

create function private.sterilization_runs_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null or trim(new.code) = '' then
    select 'SR-' || lpad((coalesce(max((substring(r.code from '^SR-([0-9]+)$'))::int), 0) + 1)::text, 3, '0')
      into new.code
    from public.sterilization_runs r
    where r.account_id = new.account_id;
  else
    new.code := upper(trim(new.code));
  end if;
  return new;
end;
$$;

create function private.media_batches_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null or trim(new.code) = '' then
    select 'MB-' || lpad((coalesce(max((substring(b.code from '^MB-([0-9]+)$'))::int), 0) + 1)::text, 3, '0')
      into new.code
    from public.media_batches b
    where b.account_id = new.account_id;
  else
    new.code := upper(trim(new.code));
  end if;
  return new;
end;
$$;

-- Rows created before this migration get codes in creation order.
do $$
declare
  r record;
begin
  for r in select id from public.sterilization_runs where code is null or trim(code) = '' order by created_at loop
    update public.sterilization_runs s
    set code = 'SR-' || lpad((select count(*) from public.sterilization_runs x
                              where x.account_id = s.account_id and x.code like 'SR-%') + 1 || '', 3, '0')
    where s.id = r.id;
  end loop;
  for r in select id from public.media_batches where code is null or trim(code) = '' order by created_at loop
    update public.media_batches m
    set code = 'MB-' || lpad((select count(*) from public.media_batches x
                              where x.account_id = m.account_id and x.code like 'MB-%') + 1 || '', 3, '0')
    where m.id = r.id;
  end loop;
end;
$$;

alter table public.sterilization_runs alter column code set not null;
alter table public.media_batches      alter column code set not null;

create unique index sterilization_runs_code_uq on public.sterilization_runs (account_id, code) where deleted_at is null;
create unique index media_batches_code_uq      on public.media_batches (account_id, code) where deleted_at is null;

create trigger sterilization_runs_before_insert
  before insert on public.sterilization_runs
  for each row execute function private.sterilization_runs_before_insert();

create trigger media_batches_before_insert
  before insert on public.media_batches
  for each row execute function private.media_batches_before_insert();
