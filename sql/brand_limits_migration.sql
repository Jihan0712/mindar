-- Migration: create brand_settings and supporting RPCs for Admin UI
-- Run this in Supabase SQL editor (SQL -> New Query) or via psql connected to your Supabase DB.

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
  -- Count active targets for each brand, but exclude uploads by admin accounts
  SELECT
    COALESCE(t.brand, '') AS brand,
    COUNT(*) FILTER (WHERE t.is_active AND a.user_id IS NULL) AS active_count,
    COALESCE(bs.max_active, 3) AS max_active
  FROM targets t
  LEFT JOIN brand_settings bs ON bs.brand = t.brand
  LEFT JOIN admins a ON a.user_id = t.user_id
  GROUP BY t.brand, bs.max_active
  ORDER BY brand;
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

-- RPC: set_active_target(p_target_id uuid)
-- Activate a target while enforcing limits:
-- - Admin uploaders bypass limits entirely.
-- - Non-admin users (clients) are limited to 1 active target each.
-- - Brands are limited by `brand_settings.max_active` (default 3), counting only non-admin uploads.
CREATE OR REPLACE FUNCTION public.set_active_target(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user uuid;
  v_brand text;
  v_is_admin boolean := false;
  v_brand_active_count integer := 0;
  v_brand_max integer := 3;
  v_user_active_count integer := 0;
  v_client_limit integer := 1; -- per-user active limit for non-admins
BEGIN
  SELECT user_id, brand INTO v_user, v_brand FROM targets WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target not found';
  END IF;

  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = v_user) INTO v_is_admin;
  IF v_is_admin THEN
    -- Admins bypass limits
    UPDATE targets SET is_active = true WHERE id = p_target_id;
    RETURN;
  END IF;

  -- Enforce per-user (client) active limit
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
-- - Run in the Supabase SQL editor: paste this file and click "RUN".
