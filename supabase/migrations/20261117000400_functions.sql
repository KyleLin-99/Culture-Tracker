-- API functions the app calls with supabase.rpc(). All run as the caller
-- (security invoker), so row-level security applies inside them.

-- ---------------------------------------------------------------------------
-- Create N transfers from a parent ("10 plates from S-2A")
-- ---------------------------------------------------------------------------

create function public.create_transfers(
  p_parent_id      uuid,
  p_count          integer,
  p_medium         text,
  p_made_on        date default current_date,
  p_media_batch_id uuid default null,
  p_location       text default null
)
returns setof public.items
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.items;
  v_child  public.items;
  v_codes  text[] := '{}';
begin
  if p_count is null or p_count not between 1 and 100 then
    raise exception 'Count must be between 1 and 100' using errcode = '22023';
  end if;

  select * into v_parent from public.items where id = p_parent_id and deleted_at is null;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  for i in 1 .. p_count loop
    insert into public.items (account_id, parent_id, kind, medium, made_on, media_batch_id, location)
    values (v_parent.account_id, v_parent.id, 'transfer', p_medium, coalesce(p_made_on, current_date),
            p_media_batch_id, p_location)
    returning * into v_child;
    v_codes := v_codes || v_child.code;
    return next v_child;
  end loop;

  insert into public.events (account_id, item_id, type, note)
  values (
    v_parent.account_id, v_parent.id, 'transferred',
    format('%s × %s: %s', p_count, p_medium,
           case when p_count = 1 then v_codes[1]
                else v_codes[1] || ' … ' || v_codes[p_count] end)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Make a backup of an item: S-2A1 -> S-2A1(1)
-- ---------------------------------------------------------------------------

create function public.create_backup(
  p_parent_id uuid,
  p_medium    text default 'slant',
  p_made_on   date default current_date,
  p_location  text default null
)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.items;
  v_backup public.items;
begin
  select * into v_parent from public.items where id = p_parent_id and deleted_at is null;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  insert into public.items (account_id, parent_id, kind, medium, made_on, location)
  values (v_parent.account_id, v_parent.id, 'backup', coalesce(p_medium, 'slant'),
          coalesce(p_made_on, current_date), p_location)
  returning * into v_backup;

  insert into public.events (account_id, item_id, type, note)
  values (v_parent.account_id, v_parent.id, 'backed_up', v_backup.code);

  return v_backup;
end;
$$;

-- ---------------------------------------------------------------------------
-- Change status and log it in one step
-- ---------------------------------------------------------------------------

create function public.set_item_status(
  p_item_id     uuid,
  p_status      text,
  p_note        text default null,
  p_contam_type text default null
)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v_item public.items;
begin
  update public.items
  set status = p_status
  where id = p_item_id and deleted_at is null
  returning * into v_item;

  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  insert into public.events (account_id, item_id, type, note, contam_type)
  values (
    v_item.account_id, v_item.id,
    case when p_status = 'contaminated' then 'contaminated' else 'status_changed' end,
    coalesce(p_note, 'Status: ' || p_status),
    p_contam_type
  );

  return v_item;
end;
$$;

-- ---------------------------------------------------------------------------
-- Look up an item by what's written on the label
-- ---------------------------------------------------------------------------
-- Ignores spaces and case: "s-2a1 (2)" finds S-2A1(2). Also matches aliases.
-- Exact matches first, then codes that start with the query.

create function public.lookup_code(p_query text)
returns table (
  id          uuid,
  code        text,
  strain_id   uuid,
  strain_name text,
  kind        text,
  medium      text,
  status      text,
  made_on     date,
  initials    text,
  exact       boolean
)
language sql
stable
set search_path = ''
as $$
  with q as (
    select upper(regexp_replace(coalesce(p_query, ''), '\s', '', 'g')) as v
  )
  select i.id, i.code, i.strain_id, s.name, i.kind, i.medium, i.status, i.made_on, i.initials,
         (i.code = q.v or q.v = any (i.aliases)) as exact
  from public.items i
  join public.strains s on s.id = i.strain_id
  cross join q
  where q.v <> ''
    and i.deleted_at is null
    and (i.code = q.v or q.v = any (i.aliases) or i.code like replace(replace(q.v, '%', '\%'), '_', '\_') || '%')
  order by exact desc, s.name, char_length(i.code), i.code
  limit 25;
$$;

-- ---------------------------------------------------------------------------
-- Lineage of one item: ancestors (depth < 0), itself (0), descendants (> 0)
-- ---------------------------------------------------------------------------

create function public.item_lineage(p_item_id uuid, p_direction text default 'both')
returns table (
  id         uuid,
  parent_id  uuid,
  code       text,
  kind       text,
  medium     text,
  status     text,
  generation integer,
  made_on    date,
  initials   text,
  depth      integer
)
language sql
stable
set search_path = ''
as $$
  with recursive
  up as (
    select i.id, i.parent_id, 0 as depth, array[i.id] as path
    from public.items i
    where i.id = p_item_id
    union all
    select p.id, p.parent_id, up.depth - 1, up.path || p.id
    from public.items p
    join up on p.id = up.parent_id
    where not p.id = any (up.path)
  ),
  down as (
    select i.id, i.parent_id, 0 as depth, array[i.id] as path
    from public.items i
    where i.id = p_item_id
    union all
    select c.id, c.parent_id, down.depth + 1, down.path || c.id
    from public.items c
    join down on c.parent_id = down.id
    where c.deleted_at is null
      and not c.id = any (down.path)
  ),
  picked as (
    select up.id, up.depth from up where p_direction in ('up', 'both')
    union
    select down.id, down.depth from down where p_direction in ('down', 'both')
  )
  select i.id, i.parent_id, i.code, i.kind, i.medium, i.status, i.generation, i.made_on, i.initials, picked.depth
  from picked
  join public.items i on i.id = picked.id
  order by picked.depth, i.code;
$$;

-- ---------------------------------------------------------------------------
-- A strain's whole family tree, in display order (parents before children,
-- siblings in numeric order so S-10 comes after S-9)
-- ---------------------------------------------------------------------------

create function public.strain_tree(p_strain_id uuid)
returns table (
  id         uuid,
  parent_id  uuid,
  code       text,
  kind       text,
  medium     text,
  status     text,
  generation integer,
  made_on    date,
  initials   text,
  depth      integer
)
language sql
stable
set search_path = ''
as $$
  with recursive tree as (
    select i.id, 0 as depth,
           array[i.origin_prefix || lpad(coalesce(i.origin_number, 1)::text, 4, '0')] as sort_path
    from public.items i
    where i.strain_id = p_strain_id
      and i.kind = 'origin'
      and i.deleted_at is null
    union all
    select c.id, tree.depth + 1,
           tree.sort_path || (case when c.kind = 'backup'
                                   then 'B' || lpad(c.backup_number::text, 4, '0')
                                   else 'T' || lpad(c.position::text, 4, '0') end)
    from public.items c
    join tree on c.parent_id = tree.id
    where c.deleted_at is null
      and tree.depth < 100
  )
  select i.id, i.parent_id, i.code, i.kind, i.medium, i.status, i.generation, i.made_on, i.initials, tree.depth
  from tree
  join public.items i on i.id = tree.id
  order by tree.sort_path;
$$;

-- ---------------------------------------------------------------------------
-- Only signed-in users may call these
-- ---------------------------------------------------------------------------

revoke all on function public.create_transfers(uuid, integer, text, date, uuid, text) from public, anon;
revoke all on function public.create_backup(uuid, text, date, text)                    from public, anon;
revoke all on function public.set_item_status(uuid, text, text, text)                  from public, anon;
revoke all on function public.lookup_code(text)                                        from public, anon;
revoke all on function public.item_lineage(uuid, text)                                 from public, anon;
revoke all on function public.strain_tree(uuid)                                        from public, anon;

grant execute on function public.create_transfers(uuid, integer, text, date, uuid, text) to authenticated;
grant execute on function public.create_backup(uuid, text, date, text)                    to authenticated;
grant execute on function public.set_item_status(uuid, text, text, text)                  to authenticated;
grant execute on function public.lookup_code(text)                                        to authenticated;
grant execute on function public.item_lineage(uuid, text)                                 to authenticated;
grant execute on function public.strain_tree(uuid)                                        to authenticated;
