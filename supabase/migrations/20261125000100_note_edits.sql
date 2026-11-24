-- Notes can be edited or removed. The rest of an item's history (transfers,
-- backups, status changes, contamination) is a fixed record and stays as written.

create function private.protect_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.account_id <> old.account_id
     or new.item_id <> old.item_id
     or new.type <> old.type
     or new.occurred_at <> old.occurred_at
     or new.created_by is distinct from old.created_by then
    raise exception 'History entries can''t be moved, retyped or redated' using errcode = 'P0001';
  end if;
  if old.type <> 'note' and (
       new.note is distinct from old.note
       or new.contam_type is distinct from old.contam_type
       or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Only notes can be edited or removed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger events_protect
  before update on public.events
  for each row execute function private.protect_events();

-- Edit a note's text, or remove it (p_delete). Safe to send twice, so phones
-- can retry it from their outbox. Runs as the caller: RLS limits it to their lab.
create function public.edit_note(
  p_id     uuid,
  p_note   text default null,
  p_delete boolean default false
)
returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v public.events;
begin
  select * into v from public.events where id = p_id;
  if not found then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;
  if v.type <> 'note' then
    raise exception 'Only notes can be edited or removed' using errcode = 'P0001';
  end if;

  if p_delete then
    if v.deleted_at is null then
      update public.events set deleted_at = now() where id = p_id returning * into v;
    end if;
    return v;
  end if;

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'A note can''t be empty' using errcode = '22023';
  end if;
  if v.deleted_at is not null then
    raise exception 'This note was removed' using errcode = 'P0001';
  end if;
  update public.events set note = btrim(p_note) where id = p_id returning * into v;
  return v;
end;
$$;

revoke all on function public.edit_note(uuid, text, boolean) from public, anon;
grant execute on function public.edit_note(uuid, text, boolean) to authenticated;
