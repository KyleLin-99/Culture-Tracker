-- Feedback: people send a message from the app; it is saved here (the back-office
-- inbox) and an Edge Function emails it to the app's owner. The owner's address
-- lives only in that function's secrets, never in the app or this database.

create table public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('bug', 'idea', 'question')),
  message      text not null check (char_length(message) between 1 and 4000),
  diagnostics  jsonb not null default '{}',
  status       text not null default 'new' check (status in ('new', 'done')),
  emailed_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index feedback_user_idx on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;
create policy "read own feedback" on public.feedback for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;  -- writes go through send_feedback()

insert into public.plan_limits (tier, limit_key, value) values
  ('standard', 'feedback_per_day', 5),
  ('paid1',    'feedback_per_day', 10),
  ('paid2',    'feedback_per_day', 20),
  ('special',  'feedback_per_day', 50);

create function public.send_feedback(p_kind text, p_message text, p_diagnostics jsonb default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if char_length(trim(coalesce(p_message, ''))) = 0 then
    raise exception 'Write a message first.' using errcode = '22023';
  end if;
  if p_kind not in ('bug', 'idea', 'question') then
    raise exception 'Kind is bug, idea or question' using errcode = '22023';
  end if;
  if pg_column_size(coalesce(p_diagnostics, '{}'::jsonb)) > 2000 then
    raise exception 'Diagnostics are too large' using errcode = '22023';
  end if;
  perform private.check_limit(private.tier_of(v_user), 'feedback_per_day',
    (select count(*) from public.feedback where user_id = v_user and created_at > now() - interval '24 hours'));
  insert into public.feedback (user_id, kind, message, diagnostics)
  values (v_user, p_kind, left(trim(p_message), 4000), coalesce(p_diagnostics, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.admin_list_feedback(p_status text default null)
returns table (id uuid, created_at timestamptz, email text, kind text, message text, diagnostics jsonb, status text, emailed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select f.id, f.created_at, u.email::text, f.kind, f.message, f.diagnostics, f.status, f.emailed_at is not null
    from public.feedback f left join auth.users u on u.id = f.user_id
    where p_status is null or f.status = p_status
    order by f.created_at desc limit 200;
end;
$$;

create function public.admin_set_feedback_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_status not in ('new', 'done') then raise exception 'Status is new or done' using errcode = '22023'; end if;
  update public.feedback set status = p_status where id = p_id;
  if not found then raise exception 'No such feedback' using errcode = 'P0002'; end if;
  perform private.audit('set_feedback_status', null, jsonb_build_object('id', p_id, 'status', p_status));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['send_feedback(text, text, jsonb)', 'admin_list_feedback(text)', 'admin_set_feedback_status(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
