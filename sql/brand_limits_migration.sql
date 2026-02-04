-- Migration: create brand_settings and supporting RPCs for Admin UI
-- Run this in a Postgres SQL editor (or via psql connected to your DB).

CREATE TABLE IF NOT EXISTS public.brand_settings (
  brand text PRIMARY KEY,
  max_active integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RPC: get_brand_limits()
-- Returns (brand, active_count, max_active) for brands present in `targets`.
CREATE OR REPLACE FUNCTION public.get_brand_limits()
RETURNS TABLE(brand text, active_count integer, max_active integer)
LANGUAGE sql
SECURITY DEFINER
AS $$
  /*
    Per brand limits for brands that actually have accounts only:
    - Source brands from get_accounts() where brand is non-empty and not admin.
    - active_count counts active targets for that brand excluding admin uploads.
    - max_active from brand_settings (default 3 when missing).
  */
  with acc as (
    select * from public.get_accounts()
  ),
  all_brands as (
    select distinct nullif(a.brand, '') as b
    from acc a
    where coalesce(trim(a.brand), '') <> '' and not a.is_admin
  ),
  counts as (
    select ab.b as brand,
           (
             select count(*)
             from public.targets t
             left join public.admins a on a.user_id = t.user_id
             where t.brand = ab.b and t.is_active and a.user_id is null
           ) as active_count
    from all_brands ab
  )
  select ab.b as brand,
         coalesce(c.active_count, 0) as active_count,
         coalesce(bs.max_active, 3) as max_active
  from all_brands ab
  left join counts c on c.brand = ab.b
  left join public.brand_settings bs on bs.brand = ab.b
  order by ab.b;
$$;

-- RPC: set_brand_max_active(p_brand text, p_limit integer)
-- Upserts the max_active value for a brand.
CREATE OR REPLACE FUNCTION public.set_brand_max_active(p_brand text, p_limit integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM brand_settings WHERE brand = p_brand) THEN
    UPDATE brand_settings SET max_active = p_limit, updated_at = now() WHERE brand = p_brand;
  ELSE
    INSERT INTO brand_settings (brand, max_active, created_at, updated_at) VALUES (p_brand, p_limit, now(), now());
  END IF;
END;
$$;

-- Grants for typical app role
GRANT EXECUTE ON FUNCTION public.get_brand_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_brand_max_active(text, integer) TO authenticated;

-- RPC: set_active_target(p_target_id uuid)
-- Activate a target while enforcing limits:
-- - Admin uploaders bypass limits entirely.
-- - Non-admin users (clients) are limited to 1 active target each.
-- - Brands are limited by `brand_settings.max_active` (default 3), counting only non-admin uploads.
-- Drop any existing function with the same signature before creating.
-- PostgreSQL does not allow changing a function's return type with CREATE OR REPLACE,
-- so we drop the old function first to avoid error 42P13.
DROP FUNCTION IF EXISTS public.set_active_target(uuid);

CREATE OR REPLACE FUNCTION public.set_active_target(p_target_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user uuid;
  v_brand text;
  v_brand_owner uuid;
  v_product text;
  v_is_admin boolean := false;
  v_brand_active_count integer := 0;
  v_brand_max integer := 3;
  v_user_active_count integer := 0;
  v_client_limit integer := 1; -- per-user active limit for non-admins
  v_replaced_ids uuid[] := NULL;
BEGIN
  SELECT user_id, brand, product, brand_owner INTO v_user, v_brand, v_product, v_brand_owner FROM targets WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target not found';
  END IF;

  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = v_user) INTO v_is_admin;
  IF v_is_admin THEN
    -- Admins bypass limits; but to avoid unique-index conflicts we must
    -- deactivate any existing active rows for the same brand/product/owner
    -- before activating the requested target. Use the same advisory lock
    -- and FOR UPDATE locking as the normal path to serialize operations.
    PERFORM pg_advisory_xact_lock((hashtext(coalesce(v_brand,'') || '|' || coalesce(v_product,'') || '|' || coalesce(coalesce(v_brand_owner::text,''), '')) )::bigint);

    -- Lock matching active rows
    PERFORM id FROM targets t
    WHERE coalesce(t.brand,'') = coalesce(v_brand,'')
      AND coalesce(t.product,'') = coalesce(v_product,'')
      AND coalesce(t.brand_owner::text,'') = coalesce(v_brand_owner::text,'')
      AND t.is_active = true
      AND t.id <> p_target_id
    FOR UPDATE;

    -- Deactivate them
    UPDATE targets t
    SET is_active = false
    WHERE coalesce(t.brand,'') = coalesce(v_brand,'')
      AND coalesce(t.product,'') = coalesce(v_product,'')
      AND coalesce(t.brand_owner::text,'') = coalesce(v_brand_owner::text,'')
      AND t.is_active = true
      AND t.id <> p_target_id;

    UPDATE targets SET is_active = true WHERE id = p_target_id;
    RETURN 'activated_admin';
  END IF;



  -- Deactivate any existing active targets with the same brand+product
  -- (exclude the target we're activating). We do this for all uploaders
  -- so the unique partial index cannot block the subsequent activation.
  IF coalesce(v_brand, '') IS NOT NULL THEN
    -- Serialize activations for the same brand+product+owner to avoid races.
    PERFORM pg_advisory_xact_lock((hashtext(coalesce(v_brand,'') || '|' || coalesce(v_product,'') || '|' || coalesce(coalesce(v_brand_owner::text,''), '')) )::bigint);

    -- Lock existing active rows for this brand/product/owner to serialize updates
    PERFORM id FROM targets t
    WHERE coalesce(t.brand,'') = coalesce(v_brand,'')
      AND coalesce(t.product,'') = coalesce(v_product,'')
      AND coalesce(t.brand_owner::text,'') = coalesce(v_brand_owner::text,'')
      AND t.is_active = true
      AND t.id <> p_target_id
    FOR UPDATE;

    WITH deactivated AS (
      UPDATE targets t
      SET is_active = false
      WHERE coalesce(t.brand,'') = coalesce(v_brand,'')
        AND coalesce(t.product,'') = coalesce(v_product,'')
        AND coalesce(t.brand_owner::text,'') = coalesce(v_brand_owner::text,'')
        AND t.is_active = true
        AND t.id <> p_target_id
      RETURNING id
    )
    SELECT array_agg(id) INTO v_replaced_ids FROM deactivated;

    -- Continue to checks/activation below. We record any replaced ids to include
    -- in the final return message after activation.
  END IF;

  -- Enforce per-user (client) active limit (recompute after possible deactivation)
  SELECT COUNT(*) INTO v_user_active_count FROM targets WHERE user_id = v_user AND is_active;
  IF v_user_active_count >= v_client_limit THEN
    RAISE EXCEPTION 'Max active targets for user';
  END IF;

  -- Enforce brand-wide limit (exclude admin uploads from the count)
  IF v_brand IS NOT NULL AND v_brand <> '' THEN
    SELECT COALESCE(bs.max_active, 3) INTO v_brand_max FROM brand_settings bs WHERE bs.brand = v_brand;
    IF v_brand_max IS NULL THEN v_brand_max := 3; END IF;

    SELECT COUNT(*) INTO v_brand_active_count
    FROM targets t
    LEFT JOIN admins a ON a.user_id = t.user_id
    WHERE t.brand = v_brand AND t.is_active AND a.user_id IS NULL;

    IF v_brand_active_count >= v_brand_max THEN
      RAISE EXCEPTION 'Max active targets for brand';
    END IF;
  END IF;

  -- All checks passed: activate the target
  UPDATE targets SET is_active = true WHERE id = p_target_id;

  IF v_replaced_ids IS NOT NULL AND array_length(v_replaced_ids,1) > 0 THEN
    RETURN format('replaced_active_targets:%s', array_to_string(v_replaced_ids, ','));
  END IF;

  RETURN 'activated';
END;
$$;

-- Optional: convenience insert for brands with no entries yet (not required)
-- Example: INSERT INTO brand_settings (brand, max_active) VALUES ('', 3) ON CONFLICT DO NOTHING;

-- Notes:
-- - These functions use SECURITY DEFINER so RPC calls can be allowed under RLS when the function is granted appropriate execute permissions.
-- - After running this migration, if your project uses RLS you may need to set appropriate grants, e.g.:
--     GRANT EXECUTE ON FUNCTION public.get_brand_limits() TO authenticated;
--     GRANT EXECUTE ON FUNCTION public.set_brand_max_active(text, integer) TO authenticated;
--   (Adjust roles/permissions according to your security model.)
-- - Run in a Postgres SQL editor: paste this file and execute.
