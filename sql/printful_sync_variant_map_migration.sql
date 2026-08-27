-- Printful sync-variant map migration
-- Adds a JSON map of size -> Printful v1 sync_variant_id, for products imported from
-- Printful's own "Sync Products" (designed directly on printful.com, then pulled in here
-- via GET /store/products — v1-only, v2 has no equivalent). Distinct from
-- printful_variant_map, which holds v2 catalog_variant_id per size for the
-- catalog-direct-linking flow — the two models are not interchangeable, so this is a
-- separate column rather than a reused one.
-- Example: {"S":"4011","M":"4012","L":"4013"}
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/printful_sync_variant_map_migration.sql

ALTER TABLE products ADD COLUMN printful_sync_variant_map TEXT NULL;
