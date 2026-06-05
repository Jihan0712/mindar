-- Printful integration migration
-- Run against your D1 database:
--   CF Dashboard → D1 → your db → Console  (paste and execute)
--   or: wrangler d1 execute mindardb --file sql/printful_migration.sql

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Products: link each product to its Printful sync product + variant
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN printful_sync_product_id INTEGER;
ALTER TABLE products ADD COLUMN printful_sync_variant_id INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders: Printful fulfillment tracking columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN city             TEXT;
ALTER TABLE orders ADD COLUMN printful_order_id TEXT;
ALTER TABLE orders ADD COLUMN printful_status   TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN tracking_number   TEXT;
ALTER TABLE orders ADD COLUMN tracking_url      TEXT;
ALTER TABLE orders ADD COLUMN carrier           TEXT;
ALTER TABLE orders ADD COLUMN shipped_at        TEXT;

-- Index for fast webhook lookups by printful_order_id
CREATE INDEX IF NOT EXISTS idx_orders_printful ON orders(printful_order_id);
 