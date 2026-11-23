-- Make several backups of one culture at once: S-2A1 -> S-2A1(1), S-2A1(2), ...
-- Numbering continues from any backups that already exist.

create function public.create_backups(
  p_parent_id uuid,
  p_count     integer,
  p_medium    text default 'slant',
  p_made_on   date default current_date,
  p_location  text default null
)
returns setof public.items
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.items;
  v_backup public.items;
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
    insert into public.items (account_id, parent_id, kind, medium, made_on, location)
    values (v_parent.account_id, v_parent.id, 'backup', coalesce(p_medium, 'slant'),
            coalesce(p_made_on, current_date), p_location)
    returning * into v_backup;
    v_codes := v_codes || v_backup.code;
    return next v_backup;
  end loop;

  insert into public.events (account_id, item_id, type, note)
  values (
    v_parent.account_id, v_parent.id, 'backed_up',
    format('%s × %s backup: %s', p_count, coalesce(p_medium, 'slant'),
           case when p_count = 1 then v_codes[1]
                else v_codes[1] || ' … ' || v_codes[p_count] end)
  );
end;
$$;

revoke all on function public.create_backups(uuid, integer, text, date, text) from public, anon;
grant execute on function public.create_backups(uuid, integer, text, date, text) to authenticated;
