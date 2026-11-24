-- Refreshing a backup: stored slants, LC and agar lose viability, so a due backup is
-- replaced by a fresh culture. Which one keeps the line strongest:
--   * parent still active -> a new backup from the parent (same generation): S-2A1(3)
--   * parent gone         -> a culture grown from the old backup (revival):  S-2A1(2)-1
-- The new culture records refresh_of = the old backup. The old backup stays active
-- until the grower retires it (the app offers that once the new one has a growth check),
-- so a contaminated refresh never loses the line. While a refresh is alive (not
-- contaminated or discarded) the old backup stops showing as due.

alter table public.items
  add column refresh_of uuid,
  add foreign key (account_id, refresh_of) references public.items (account_id, id);

create index items_refresh_of_idx on public.items (refresh_of) where refresh_of is not null;

-- A refresh must be a sibling backup of the old backup, or grown from it; and the
-- link is fixed once written, like the rest of the lineage.
create function private.items_check_refresh()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_backup public.items;
begin
  if tg_op = 'UPDATE' then
    if new.refresh_of is distinct from old.refresh_of then
      raise exception 'An item''s lineage and culture code can''t be changed' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.refresh_of is null then
    return new;
  end if;
  select * into old_backup from public.items where id = new.refresh_of;
  if not found or old_backup.kind <> 'backup' then
    raise exception 'Only a backup can be refreshed' using errcode = '22023';
  end if;
  if not ((new.kind = 'backup' and new.parent_id = old_backup.parent_id) or new.parent_id = old_backup.id) then
    raise exception 'A refresh is a new backup from the same parent, or grown from the old backup' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger items_check_refresh
  before insert or update on public.items
  for each row execute function private.items_check_refresh();

-- Phones send refreshes through apply_items: same function, now also storing refresh_of.
create or replace function public.apply_items(p_items jsonb)
returns setof public.items
language plpgsql
set search_path = ''
as $$
declare
  e   jsonb;
  v   public.items;
begin
  for e in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v from public.items where id = (e->>'id')::uuid;
    if found then
      return next v;  -- already applied
      continue;
    end if;

    begin
      insert into public.items (id, account_id, strain_id, parent_id, kind, medium, origin_prefix,
                                position, backup_number, made_on, media_batch_id, location, notes, refresh_of)
      values ((e->>'id')::uuid, (e->>'account_id')::uuid, nullif(e->>'strain_id', '')::uuid,
              nullif(e->>'parent_id', '')::uuid, e->>'kind', e->>'medium', nullif(e->>'origin_prefix', ''),
              (e->>'position')::int, (e->>'backup_number')::int,
              coalesce((e->>'made_on')::date, current_date), nullif(e->>'media_batch_id', '')::uuid,
              nullif(e->>'location', ''), nullif(e->>'notes', ''), nullif(e->>'refresh_of', '')::uuid)
      returning * into v;
    exception when unique_violation then
      -- Another device got this position first: take the next free one.
      insert into public.items (id, account_id, strain_id, parent_id, kind, medium, origin_prefix,
                                made_on, media_batch_id, location, notes, refresh_of)
      values ((e->>'id')::uuid, (e->>'account_id')::uuid, nullif(e->>'strain_id', '')::uuid,
              nullif(e->>'parent_id', '')::uuid, e->>'kind', e->>'medium', nullif(e->>'origin_prefix', ''),
              coalesce((e->>'made_on')::date, current_date), nullif(e->>'media_batch_id', '')::uuid,
              nullif(e->>'location', ''), nullif(e->>'notes', ''), nullif(e->>'refresh_of', '')::uuid)
      returning * into v;
    end;

    if e->>'expected_code' is not null and v.code <> e->>'expected_code' then
      insert into public.relabels (account_id, entity_id, old_code, new_code)
      values (v.account_id, v.id, e->>'expected_code', v.code)
      on conflict (entity_id) do nothing;
    end if;

    return next v;
  end loop;
end;
$$;

-- The web's refresh (phones plan it locally and send it through apply_items).
create function public.refresh_backup(p_backup_id uuid, p_made_on date)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  old_backup public.items;
  parent     public.items;
  v          public.items;
begin
  select * into old_backup from public.items where id = p_backup_id and deleted_at is null;
  if not found then
    raise exception 'Culture not found' using errcode = 'P0002';
  end if;
  if old_backup.kind <> 'backup' then
    raise exception 'Only a backup can be refreshed' using errcode = '22023';
  end if;
  select * into parent from public.items where id = old_backup.parent_id and deleted_at is null;

  if found and parent.status = 'active' then
    insert into public.items (account_id, strain_id, parent_id, kind, medium, made_on, refresh_of)
    values (old_backup.account_id, old_backup.strain_id, parent.id, 'backup', old_backup.medium, p_made_on, old_backup.id)
    returning * into v;
    insert into public.events (account_id, item_id, type, note)
    values (v.account_id, parent.id, 'backed_up', format('1 × %s backup: %s (refresh of %s)', v.medium, v.code, old_backup.code));
  else
    insert into public.items (account_id, strain_id, parent_id, kind, medium, made_on, refresh_of)
    values (old_backup.account_id, old_backup.strain_id, old_backup.id, 'transfer', old_backup.medium, p_made_on, old_backup.id)
    returning * into v;
    insert into public.events (account_id, item_id, type, note)
    values (v.account_id, old_backup.id, 'transferred', format('1 × %s: %s (refresh)', v.medium, v.code));
  end if;
  return v;
end;
$$;

revoke all on function public.refresh_backup(uuid, date) from public, anon;
grant execute on function public.refresh_backup(uuid, date) to authenticated;
