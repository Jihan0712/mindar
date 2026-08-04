-- Printful integration migration
-- Run against your D1 database:
--   CF Dashboard → D1 → your db → Console  (paste and execute)
--   or: wrangler d1 execute mindardb --file sql/printful_migration.sql

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Products: link each product to its Printful sync product + variant
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS printful_sync_product_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS printful_sync_variant_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS printful_variant_map TEXT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders: Printful fulfillment tracking columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS city             TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS printful_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS printful_status   TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier           TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at        TEXT;

-- Index for fast webhook lookups by printful_order_id
CREATE INDEX IF NOT EXISTS idx_orders_printful ON orders(printful_order_id);
 