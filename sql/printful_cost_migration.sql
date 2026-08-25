-- Printful per-size cost migration
-- REQUIRED: run sql/printful_migration.sql and sql/printful_variant_map_migration.sql first
--
-- Stores what Printful charges the store (not the customer) per size, captured at link
-- time from the Printful catalog variant's price. Used only by the admin dashboard to
-- show a margin indicator against the product's own price_cents — never exposed via the
-- public /api/products endpoints.
-- Example: {"S":"8.50","M":"8.50","L":"9.20","XL":"9.20"}
--
-- Run this in the Cloudflare D1 Console for your database.

ALTER TABLE products ADD COLUMN printful_variant_cost_map TEXT NULL;
