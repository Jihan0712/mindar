-- Brand invitation flow (clean, minimal)
-- Requires: public.admins(user_id uuid primary key) to identify admins
-- Assumes: public.profiles(user_id uuid primary key, email text, name text, brand text, role text)

begin;

-- Idempotent cleanup (allows re-running script safely)
drop function if exists public.create_brand_invite(text, text);
drop function if exists public.get_brand_invite(uuid);
drop function if exists public.claim_brand_invite(uuid);
drop function if exists public.current_auth_email();

-- 1) Table
create table if not exists public.brand_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  brand text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz null,
  created_by uuid null
);

-- Ensure newer columns exist even if an older version of the table was already present
alter table public.brand_invitations
  add column if not exists consumed_at timestamptz null,
  add column if not exists created_by uuid null;

-- Normalize email to lowercase on insert/update
create or replace function public._normalize_email()
returns trigger
language plpgsql as $$
begin
  if new.email is not null then
    new.email := lower(new.email);
  end if;
  return new;
end; $$;

drop trigger if exists trg_brand_invites_normalize_email on public.brand_invitations;
create trigger trg_brand_invites_normalize_email
before insert or update on public.brand_invitations
for each row execute function public._normalize_email();

-- Enable RLS
alter table public.brand_invitations enable row level security;

-- Drop existing policies if present (PostgreSQL does not support IF NOT EXISTS in CREATE POLICY)
drop policy if exists brand_invites_select_admin on public.brand_invitations;
drop policy if exists brand_invites_insert_admin on public.brand_invitations;
drop policy if exists brand_invites_update_admin on public.brand_invitations;
drop policy if exists brand_invites_delete_admin on public.brand_invitations;

create policy brand_invites_select_admin
on public.brand_invitations for select
using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy brand_invites_insert_admin
on public.brand_invitations for insert
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy brand_invites_update_admin
on public.brand_invitations for update
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy brand_invites_delete_admin
on public.brand_invitations for delete
using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- 2) Helper to get current auth email from JWT
create or replace function public.current_auth_email()
returns text
language sql
stable
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claim.email', true), '')),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  );
$$;

-- 3) RPC: create invite (admins only)
create or replace function public.create_brand_invite(p_email text, p_brand text)
returns uuid
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (select 1 from public.admins a where a.user_id = v_uid) then
    raise exception 'Only admins can create invites';
  end if;
  insert into public.brand_invitations(email, brand, created_by)
  values (lower(p_email), p_brand, v_uid)
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.create_brand_invite(text, text) to authenticated;

-- 4) RPC: get invite (by id) for prefill
-- SECURITY DEFINER so it works pre-sign-in; link secrecy is via UUID
create or replace function public.get_brand_invite(p_id uuid)
returns table(id uuid, email text, brand text, consumed_at timestamptz)
language sql
security definer set search_path = public, extensions
as $$
  select i.id, i.email, i.brand, i.consumed_at
  from public.brand_invitations i
  where i.id = p_id;
$$;

grant execute on function public.get_brand_invite(uuid) to anon, authenticated;

-- 5) RPC: claim invite (must be signed-in; email must match invitation)
create or replace function public.claim_brand_invite(p_id uuid)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.current_auth_email();
  v_inv record;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_inv from public.brand_invitations where id = p_id;
  if not found then
    raise exception 'Invitation not found';
  end if;
  if v_inv.consumed_at is not null then
    raise exception 'Invitation already used';
  end if;
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'Signed-in email does not match invitation';
  end if;

  -- Upsert profile as brand (align with profiles.user_id schema)
  insert into public.profiles(user_id, email, brand, role)
  values (v_uid, v_inv.email, v_inv.brand, 'brand')
  on conflict (user_id) do update
    set email = excluded.email,
        brand = excluded.brand,
        role = 'brand';

  -- Mark invite consumed
  update public.brand_invitations set consumed_at = now() where id = p_id;
end; $$;

grant execute on function public.claim_brand_invite(uuid) to authenticated;

commit;
