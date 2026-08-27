-- Printful v1 order id migration
-- A checkout cart can mix products linked via the v2 catalog-direct flow and products
-- imported from Printful's v1 Sync Products — these are different Printful API calls
-- (different base URL, auth model, request shape) that can't be merged into one order
-- payload, so a mixed cart can result in up to two real Printful orders for one store
-- order. printful_order_id (existing column) keeps meaning "the v2 order"; this column
-- holds the v1 one when a sync-linked item was present.
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/printful_order_v1_migration.sql

ALTER TABLE orders ADD COLUMN printful_order_id_v1 TEXT NULL;
