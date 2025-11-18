-- Core app schema and RPCs for admin/brand flows
-- Safe to re-run (idempotent guards included)

begin;

-- Ensure required extension
create extension if not exists pgcrypto;

-- ===============
-- profiles table
-- ===============
create table if not exists public.profiles (
  user_id uuid primary key,
  email text,
  name text,
  brand text,
  role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add missing columns if table existed with a different shape
alter table public.profiles
  add column if not exists email text,
  add column if not exists name text,
  add column if not exists brand text,
  add column if not exists role text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Simple trigger to maintain updated_at
create or replace function public._profiles_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_profiles_touch_updated on public.profiles;
create trigger trg_profiles_touch_updated
before update on public.profiles
for each row execute function public._profiles_touch_updated_at();

-- Enable RLS (policies created only if absent below)
alter table public.profiles enable row level security;

-- Recreate policies idempotently (DROP + CREATE; CREATE POLICY has no IF NOT EXISTS)
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============
-- admins table
-- ============
create table if not exists public.admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

-- Basic RLS so admins can read their own row; use RPCs for broader access
alter table public.admins enable row level security;

drop policy if exists admins_self_select on public.admins;
create policy admins_self_select on public.admins for select
  using (auth.uid() = user_id);

-- ================
-- admin_tokens table
-- ================
create table if not exists public.admin_tokens (
  token uuid primary key default gen_random_uuid(),
  created_by_id uuid,
  created_at timestamptz not null default now(),
  consumed_at timestamptz null
);

alter table public.admin_tokens
  add column if not exists created_by_id uuid,
  add column if not exists consumed_at timestamptz null,
  add column if not exists created_at timestamptz not null default now();

alter table public.admin_tokens enable row level security;

-- Policies: allow token owner (creator) to view/delete own tokens; admins manage via RPCs
drop policy if exists admin_tokens_creator_select on public.admin_tokens;
create policy admin_tokens_creator_select on public.admin_tokens for select
  using (created_by_id = auth.uid());

drop policy if exists admin_tokens_creator_delete on public.admin_tokens;
create policy admin_tokens_creator_delete on public.admin_tokens for delete
  using (created_by_id = auth.uid());

-- =========================
-- Utility + Admin RPCs
-- =========================
-- Current email from JWT (used by claim functions)
drop function if exists public.current_auth_email();
create or replace function public.current_auth_email()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  );
$$;

-- Admin check (do not DROP; other policies depend on it)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public, extensions as $$
  select exists(select 1 from public.admins a where a.user_id = auth.uid());
$$;
 grant execute on function public.is_admin() to authenticated;

-- Create admin token (admins only)
 drop function if exists public.create_admin_token();
create or replace function public.create_admin_token()
returns uuid language plpgsql security definer set search_path=public, extensions as $$
declare v_uid uuid := auth.uid(); v_tok uuid; begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.admins where user_id = v_uid) then raise exception 'Only admins can create admin tokens'; end if;
  insert into public.admin_tokens(created_by_id) values (v_uid) returning token into v_tok; return v_tok;
end; $$;
 grant execute on function public.create_admin_token() to authenticated;

-- Pending admin tokens (admins only)
 drop function if exists public.get_pending_admin_tokens(integer);
create or replace function public.get_pending_admin_tokens(p_limit integer default 10)
returns table(token uuid, created_at timestamptz, created_by_id uuid)
language sql security definer set search_path=public, extensions as $$
  select t.token, t.created_at, t.created_by_id
  from public.admin_tokens t
  where t.consumed_at is null
  order by t.created_at desc
  limit greatest(p_limit, 1)
$$;
 grant execute on function public.get_pending_admin_tokens(integer) to authenticated;

-- Consume admin token and promote user (admins only)
 drop function if exists public.consume_admin_token_and_promote(uuid, uuid);
create or replace function public.consume_admin_token_and_promote(p_token uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public, extensions as $$
declare v_uid uuid := auth.uid(); v_row public.admin_tokens; begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.admins where user_id = v_uid) then raise exception 'Only admins can promote'; end if;
  select * into v_row from public.admin_tokens where token = p_token and consumed_at is null;
  if not found then return false; end if;
  insert into public.admins(user_id) values (p_user_id) on conflict do nothing;
  update public.admin_tokens set consumed_at = now() where token = p_token;
  return true;
end; $$;
 grant execute on function public.consume_admin_token_and_promote(uuid, uuid) to authenticated;

 -- Accounts view for admin dashboard (show all auth.users, even if profiles missing)
 drop function if exists public.get_accounts();
create or replace function public.get_accounts()
returns table(user_id uuid, email text, brand text, is_admin boolean)
language sql security definer set search_path=public, extensions as $$
  select 
    u.id as user_id,
    coalesce(u.email, '') as email,
    coalesce(
      p.brand,
      (
        select bi.brand
        from public.brand_invitations bi
        where lower(bi.email) = lower(u.email)
          and bi.consumed_at is null
        order by bi.created_at desc
        limit 1
      ),
      ''
    ) as brand,
    exists(select 1 from public.admins a where a.user_id = u.id) as is_admin
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  order by u.created_at desc nulls last
$$;
 grant execute on function public.get_accounts() to authenticated;

-- Brand accounts count (only users with role='brand' and non-empty brand)
drop function if exists public.get_brand_accounts_count();
create or replace function public.get_brand_accounts_count()
returns integer
language sql security definer set search_path=public, extensions as $$
  select count(*)::int
  from public.profiles p
  where coalesce(trim(p.brand), '') <> ''
    and not exists (
      select 1 from public.admins a where a.user_id = p.user_id
    )
$$;
grant execute on function public.get_brand_accounts_count() to authenticated;

-- Distinct brands count (number of unique brand names with at least one non-admin profile)
drop function if exists public.get_distinct_brand_count();
create or replace function public.get_distinct_brand_count()
returns integer
language sql security definer set search_path=public, extensions as $$
  select count(*)::int from (
    select distinct p.brand
    from public.profiles p
    where coalesce(trim(p.brand), '') <> ''
      and not exists (
        select 1 from public.admins a where a.user_id = p.user_id
      )
  ) s
$$;
grant execute on function public.get_distinct_brand_count() to authenticated;

-- Backfill missing profiles from auth.users (admin-run migration helper)
drop function if exists public.backfill_profiles_from_auth();
create or replace function public.backfill_profiles_from_auth()
returns integer
language plpgsql security definer set search_path=public, extensions as $$
declare
  v_count integer := 0;
begin
  -- Insert a profile row for every auth.user that does not already have one.
  insert into public.profiles (user_id, email, name, brand, role, created_at, updated_at)
  select u.id, u.email, null, null, case when exists (select 1 from public.admins a where a.user_id = u.id) then 'admin' else 'client' end, now(), now()
  from auth.users u
  where not exists (select 1 from public.profiles p where p.user_id = u.id)
  returning 1 into v_count;

  -- The above INTO gets only the first returning row; instead compute count of new rows
  GET DIAGNOSTICS v_count = ROW_COUNT;
  return v_count;
end; $$;
grant execute on function public.backfill_profiles_from_auth() to authenticated;

commit;
