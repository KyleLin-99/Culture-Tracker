-- Server side of offline writing (docs/design/offline-mode.md).
--
-- Phones create rows with their own UUIDs and the codes they worked out
-- locally, then send them when online. These functions:
--   * are idempotent: sending the same change twice does nothing the second time
--   * resolve code conflicts: the first change to reach the server keeps its
--     position; a later one takes the next free position, and a "relabel" row
--     tells the phone which plate to relabel (S-2C -> S-2D).

-- ---------------------------------------------------------------------------
-- Relabels
-- ---------------------------------------------------------------------------

create table public.relabels (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  entity       text not null default 'item' check (entity in ('item')),
  entity_id    uuid not null,
  old_code     text not null,   -- what the phone wrote on the label
  new_code     text not null,   -- what the server assigned
  resolved_at  timestamptz,     -- set when the plate has been relabeled
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (account_id, id),
  unique (entity_id),
  foreign key (account_id, entity_id) references public.items (account_id, id)
);

create trigger relabels_updated_at before update on public.relabels
  for each row execute function private.set_updated_at();

alter table public.relabels enable row level security;
create policy "members read" on public.relabels for select to authenticated using (private.is_member(account_id));
create policy "members insert" on public.relabels for insert to authenticated with check (private.is_member(account_id));
create policy "members update" on public.relabels for update to authenticated
  using (private.is_member(account_id)) with check (private.is_member(account_id));
revoke all on public.relabels from anon, authenticated;
grant select, insert, update on public.relabels to authenticated;

-- ---------------------------------------------------------------------------
-- Items made on a phone
-- ---------------------------------------------------------------------------
-- p_items: a JSON array, applied in order (parents before their children):
--   { id, account_id, strain_id, parent_id, kind, medium, origin_prefix,
--     position, backup_number, made_on, media_batch_id, location, notes,
--     expected_code }
-- Returns the rows as stored, with their final codes.

create function public.apply_items(p_items jsonb)
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
                                position, backup_number, made_on, media_batch_id, location, notes)
      values ((e->>'id')::uuid, (e->>'account_id')::uuid, nullif(e->>'strain_id', '')::uuid,
              nullif(e->>'parent_id', '')::uuid, e->>'kind', e->>'medium', nullif(e->>'origin_prefix', ''),
              (e->>'position')::int, (e->>'backup_number')::int,
              coalesce((e->>'made_on')::date, current_date), nullif(e->>'media_batch_id', '')::uuid,
              nullif(e->>'location', ''), nullif(e->>'notes', ''))
      returning * into v;
    exception when unique_violation then
      -- Another device got this position first: take the next free one.
      insert into public.items (id, account_id, strain_id, parent_id, kind, medium, origin_prefix,
                                made_on, media_batch_id, location, notes)
      values ((e->>'id')::uuid, (e->>'account_id')::uuid, nullif(e->>'strain_id', '')::uuid,
              nullif(e->>'parent_id', '')::uuid, e->>'kind', e->>'medium', nullif(e->>'origin_prefix', ''),
              coalesce((e->>'made_on')::date, current_date), nullif(e->>'media_batch_id', '')::uuid,
              nullif(e->>'location', ''), nullif(e->>'notes', ''))
      returning * into v;
    end;

    -- The code differs from the label the phone printed (its own position was
    -- taken, or its parent was renumbered): record a relabel.
    if e->>'expected_code' is not null and v.code <> e->>'expected_code' then
      insert into public.relabels (account_id, entity_id, old_code, new_code)
      values (v.account_id, v.id, e->>'expected_code', v.code)
      on conflict (entity_id) do nothing;
    end if;

    return next v;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Events and status changes made on a phone
-- ---------------------------------------------------------------------------

create function public.apply_event(
  p_id          uuid,
  p_item_id     uuid,
  p_type        text,
  p_note        text default null,
  p_contam_type text default null,
  p_occurred_at timestamptz default now()
)
returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v public.events;
begin
  select * into v from public.events where id = p_id;
  if found then
    return v;
  end if;
  insert into public.events (id, account_id, item_id, type, note, contam_type, occurred_at)
  select p_id, i.account_id, i.id, p_type, p_note, p_contam_type, coalesce(p_occurred_at, now())
  from public.items i where i.id = p_item_id
  returning * into v;
  if v.id is null then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- A status change plus its event, keyed by the event's id so it applies once.
create function public.apply_status(
  p_event_id    uuid,
  p_item_id     uuid,
  p_status      text,
  p_note        text default null,
  p_contam_type text default null,
  p_occurred_at timestamptz default now()
)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v public.items;
begin
  if exists (select 1 from public.events where id = p_event_id) then
    select * into v from public.items where id = p_item_id;
    return v;
  end if;

  update public.items set status = p_status
  where id = p_item_id and deleted_at is null
  returning * into v;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  insert into public.events (id, account_id, item_id, type, note, contam_type, occurred_at)
  values (p_event_id, v.account_id, v.id,
          case when p_status = 'contaminated' then 'contaminated' else 'status_changed' end,
          coalesce(p_note, 'Status: ' || p_status), p_contam_type, coalesce(p_occurred_at, now()));
  return v;
end;
$$;

revoke all on function public.apply_items(jsonb) from public, anon;
revoke all on function public.apply_event(uuid, uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.apply_status(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.apply_items(jsonb) to authenticated;
grant execute on function public.apply_event(uuid, uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.apply_status(uuid, uuid, text, text, text, timestamptz) to authenticated;
