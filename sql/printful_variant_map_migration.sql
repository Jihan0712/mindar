-- Printful per-size variant map migration
-- REQUIRED: run sql/printful_migration.sql first (adds printful_sync_variant_id to products)
--
-- Adds a JSON map of size -> Printful sync variant ID to the products table.
-- Example: {"S":"6a0ff0f16447e7","M":"6a0ff0f1644842","L":"6a0ff0f1644897","XL":"6a0ff0f16448d8"}
--
-- Run this in the Cloudflare D1 Console for your database.

ALTER TABLE products ADD COLUMN printful_variant_map TEXT NULL;
