-- Culture codes: built by the database from an item's place in the lineage, so a
-- code can never disagree with the item's actual parent.

-- 1 -> A, 26 -> Z, 27 -> AA, 28 -> AB ...
create function private.position_letters(p_position integer)
returns text
language plpgsql
immutable
strict
as $$
declare
  v_n      integer := p_position;
  v_result text := '';
begin
  if v_n < 1 then
    raise exception 'Position must be 1 or more, got %', v_n;
  end if;
  while v_n > 0 loop
    v_n := v_n - 1;
    v_result := chr(65 + v_n % 26) || v_result;
    v_n := v_n / 26;
  end loop;
  return v_result;
end;
$$;

-- Fills in code, generation, position / backup / origin numbers, strain and
-- initials on insert. Runs as the caller, so RLS still applies to its lookups.
create function private.items_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.items;
  v_next   integer;
begin
  -- Initials default to the signed-in member's.
  if new.initials is null then
    select m.initials into new.initials
    from public.members m
    where m.account_id = new.account_id
      and m.user_id = (select auth.uid());
  end if;
  new.initials := upper(new.initials);

  if new.kind = 'origin' then
    if new.parent_id is not null then
      raise exception 'An origin has no parent' using errcode = '23514';
    end if;
    new.origin_prefix := upper(trim(new.origin_prefix));

    -- First origin with this prefix in the strain has no number; later ones get 2, 3, ...
    if new.origin_number is null then
      select max(coalesce(i.origin_number, 1)) + 1 into new.origin_number
      from public.items i
      where i.strain_id = new.strain_id
        and i.kind = 'origin'
        and i.origin_prefix = new.origin_prefix;
    end if;

    new.code := new.origin_prefix || coalesce(new.origin_number::text, '');
    new.generation := 0;

  else
    select * into v_parent from public.items where id = new.parent_id;
    if not found then
      raise exception 'Parent item not found' using errcode = '23503';
    end if;
    if v_parent.account_id <> new.account_id then
      raise exception 'Parent belongs to another account' using errcode = '23503';
    end if;
    if new.strain_id is not null and new.strain_id <> v_parent.strain_id then
      raise exception 'A child must have the same strain as its parent' using errcode = '23514';
    end if;
    new.strain_id := v_parent.strain_id;

    if new.kind = 'transfer' then
      if new.position is null then
        select coalesce(max(i.position), 0) + 1 into new.position
        from public.items i
        where i.parent_id = v_parent.id and i.kind = 'transfer';
      end if;

      if v_parent.kind = 'transfer' then
        -- Alternate: after a number comes a letter, after a letter a number.
        if v_parent.code ~ '[0-9]$' then
          new.code := v_parent.code || private.position_letters(new.position);
        else
          new.code := v_parent.code || new.position::text;
        end if;
      else
        -- Off an origin or a backup: start a new dash segment with a number.
        new.code := v_parent.code || '-' || new.position::text;
      end if;
      new.generation := v_parent.generation + 1;

    elsif new.kind = 'backup' then
      if new.backup_number is null then
        select coalesce(max(i.backup_number), 0) + 1 into new.backup_number
        from public.items i
        where i.parent_id = v_parent.id and i.kind = 'backup';
      end if;
      new.code := v_parent.code || '(' || new.backup_number::text || ')';
      new.generation := v_parent.generation;
    end if;
  end if;

  if char_length(new.code) > 20 then
    raise exception 'Culture code % would be % characters; the limit is 20', new.code, char_length(new.code)
      using errcode = '23514', hint = 'code_too_long';
  end if;

  return new;
end;
$$;

create trigger items_before_insert
  before insert on public.items
  for each row execute function private.items_before_insert();

-- Lineage fields are fixed once written: a code on a physical label must keep
-- meaning the same thing. Status, location, notes and aliases can change.
create function private.items_lock_lineage()
returns trigger
language plpgsql
as $$
begin
  if (new.account_id, new.strain_id, new.parent_id, new.kind, new.origin_prefix,
      new.origin_number, new.position, new.backup_number, new.code, new.generation)
     is distinct from
     (old.account_id, old.strain_id, old.parent_id, old.kind, old.origin_prefix,
      old.origin_number, old.position, old.backup_number, old.code, old.generation)
  then
    raise exception 'An item''s lineage and culture code can''t be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger items_lock_lineage
  before update on public.items
  for each row execute function private.items_lock_lineage();
