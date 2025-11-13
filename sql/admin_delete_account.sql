-- Recreate admin account deletion with HTTP fallback using pg_net.
-- Run these statements in SQL Editor as the database owner.
-- 1. Enable pg_net extension (if not already):
--    create extension if not exists pg_net;
-- 2. Set project URL + service role key (REPLACE placeholders):
--    alter database current set app.settings.supabase_url = 'https://YOUR-PROJECT.supabase.co';
--    alter database current set app.settings.service_role_key = 'SERVICE_ROLE_KEY';
-- 3. Create or replace the functions below.
-- 4. Test: select public.admin_delete_account('00000000-0000-0000-0000-000000000000');
-- Security note: Storing the service role key in a DB GUC is sensitive; rotate the key regularly or use the vault extension.

create or replace function public.admin_delete_account_domain_cleanup(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not admin';
  end if;
  -- Delete dependent domain rows. Adjust table order to avoid FK issues.
  delete from public.targets where user_id = p_user_id;
  delete from public.admins where user_id = p_user_id;
  delete from public.profiles where user_id = p_user_id;
end;$$;

grant execute on function public.admin_delete_account_domain_cleanup(uuid) to authenticated;

create or replace function public.admin_delete_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  svc_key text := current_setting('app.settings.service_role_key', true);
  base_url text := current_setting('app.settings.supabase_url', true);
  auth_proc regprocedure;
  http_resp jsonb;
  status text;
begin
  if not public.is_admin() then
    raise exception 'Not admin';
  end if;

  -- Try internal auth.delete_user first, then auth.admin_delete_user.
  auth_proc := to_regprocedure('auth.delete_user(uuid)');
  if auth_proc is not null then
    perform auth.delete_user(p_user_id);
    status := 'deleted_via_internal';
  else
    auth_proc := to_regprocedure('auth.admin_delete_user(uuid)');
    if auth_proc is not null then
      perform auth.admin_delete_user(p_user_id);
      status := 'deleted_via_internal';
    end if;
  end if;

  -- Domain cleanup regardless of auth function outcome.
  perform public.admin_delete_account_domain_cleanup(p_user_id);

  if status = 'deleted_via_internal' then
    return jsonb_build_object('status', status);
  end if;

  -- No internal function; attempt HTTP fallback if configuration present.
  if svc_key is null or base_url is null then
    return jsonb_build_object('status','domain_only','warning','No internal delete function and no service key configured');
  end if;

  http_resp := net.http_request(
    base_url || '/auth/v1/admin/users/' || p_user_id::text,
    method := 'DELETE',
    headers := jsonb_build_object(
      'apikey', svc_key,
      'Authorization', 'Bearer ' || svc_key,
      'Content-Type', 'application/json'
    )
  );

  return jsonb_build_object('status','http_delete_attempted','response', http_resp);
end;$$;

grant execute on function public.admin_delete_account(uuid) to authenticated;
