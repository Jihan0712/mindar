-- Migration: add brand_owner to targets and make active uniqueness scoped by owner
-- Run in Supabase SQL editor

ALTER TABLE public.targets
  ADD COLUMN IF NOT EXISTS brand_owner uuid;

-- Populate brand_owner for existing rows where the uploader is a brand user
-- (assumes profiles.role = 'brand' for brand owners)
UPDATE public.targets t
SET brand_owner = t.user_id
FROM public.profiles p
WHERE p.user_id = t.user_id AND p.role = 'brand' AND (t.brand IS NOT NULL AND t.brand <> '');

-- Drop old unique index/constraint if present (name used in errors)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_targets_active_brand_product') THEN
    EXECUTE 'DROP INDEX IF EXISTS public.uq_targets_active_brand_product';
  END IF;
END$$;

-- Create new unique index that includes brand_owner (textified to include NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS uq_targets_active_brand_product_owner
ON public.targets ((COALESCE(brand,'')), (COALESCE(product,'')), (COALESCE(brand_owner::text,'')))
WHERE is_active = true;

-- Note: after running this migration, new uploads from brand users should set brand_owner = current_user_id
-- so that active markers are namespaced per brand owner. Admin and client uploads may keep brand_owner = NULL.
