-- Reselling HQ, Stage 3: accounts and private data.
-- Paste all of this into Supabase: SQL Editor, New query, Run. Safe to run again.
--
-- Every table has row level security: the database itself only lets a signed-in
-- person see and change their own rows. Deleting a user deletes all their rows.

-- Who may create an account. Only the server (secret key) and the sign-up check can read it.
create table if not exists public.allowed_emails (
  email text primary key check (email = lower(trim(email))),
  added_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon, authenticated;

-- One row per person, made automatically when they first sign in.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- App settings (stale limits, offer rules, budget...), one row per person.
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Past weekly check reports. The newest 52 per person are kept.
create table if not exists public.reports (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ts bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists reports_user_ts on public.reports (user_id, ts desc);

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.reports enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own reports" on public.reports;
create policy "own reports" on public.reports for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Make the profile row when a user is created.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email)) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep only the newest 52 reports for that person.
create or replace function public.trim_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reports r where r.user_id = new.user_id and r.id in (
    select id from public.reports where user_id = new.user_id order by ts desc offset 52);
  return null;
end $$;
drop trigger if exists reports_keep_52 on public.reports;
create trigger reports_keep_52 after insert on public.reports
  for each row execute function public.trim_reports();

-- Sign-up check (Supabase: Authentication, Hooks, "Before User Created").
-- Refuses any email that isn't in allowed_emails.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(event -> 'user' ->> 'email'));
begin
  if e is not null and exists (select 1 from public.allowed_emails where email = e) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Reselling HQ is private for now.'));
end $$;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.trim_reports() from public, anon, authenticated;
