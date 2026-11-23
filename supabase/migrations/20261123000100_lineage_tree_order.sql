-- Fix: item_lineage listed descendants level by level (all children, then all
-- grandchildren), so a plate's children didn't appear under it. Now ancestors
-- come first (oldest at the top), then the item, then its descendants in tree
-- order: each child directly under its parent, siblings in numeric order
-- (S-9 before S-10), transfers before backups.
--
-- strain_tree gets the same sibling order so both views agree.

-- Sort key for an item among its siblings.
create or replace function private.sibling_key(p_kind text, p_position integer, p_backup_number integer)
returns text
language sql
immutable
as $$
  select case when p_kind = 'backup'
              then '1' || lpad(p_backup_number::text, 6, '0')
              else '0' || lpad(coalesce(p_position, 0)::text, 6, '0') end;
$$;

grant execute on function private.sibling_key(text, integer, integer) to authenticated;

create or replace function public.item_lineage(p_item_id uuid, p_direction text default 'both')
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
    select i.id, i.parent_id, 0 as depth, array[i.id] as path, array[]::text[] as sort_path
    from public.items i
    where i.id = p_item_id
    union all
    select c.id, c.parent_id, down.depth + 1, down.path || c.id,
           down.sort_path || private.sibling_key(c.kind, c.position, c.backup_number)
    from public.items c
    join down on c.parent_id = down.id
    where c.deleted_at is null
      and not c.id = any (down.path)
  ),
  picked as (
    -- Ancestors: ordered oldest first.
    select up.id, up.depth, array[]::text[] as sort_path
    from up
    where p_direction in ('up', 'both') and up.depth < 0
    union all
    -- The item itself (depth 0, empty sort path sorts first) and descendants.
    select down.id, down.depth, down.sort_path
    from down
    where p_direction in ('down', 'both')
       or (p_direction = 'up' and down.depth = 0)
  )
  select i.id, i.parent_id, i.code, i.kind, i.medium, i.status, i.generation, i.made_on, i.initials, picked.depth
  from picked
  join public.items i on i.id = picked.id
  order by (picked.depth >= 0), picked.depth * (picked.depth < 0)::int, picked.sort_path;
$$;

create or replace function public.strain_tree(p_strain_id uuid)
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
           array[i.origin_prefix || lpad(coalesce(i.origin_number, 1)::text, 6, '0')] as sort_path
    from public.items i
    where i.strain_id = p_strain_id
      and i.kind = 'origin'
      and i.deleted_at is null
    union all
    select c.id, tree.depth + 1,
           tree.sort_path || private.sibling_key(c.kind, c.position, c.backup_number)
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
