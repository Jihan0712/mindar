-- Stripe payment tracking migration
-- Run against your D1 database (after sql/printful_migration.sql and sql/orders_migration.sql):
--   CF Dashboard → D1 → your db → Console  (paste and execute)
--   or: wrangler d1 execute mindardb --file sql/stripe_migration.sql
--
-- NOTE: SQLite's ALTER TABLE ADD COLUMN does not support "IF NOT EXISTS" (that clause is
-- only valid on CREATE TABLE/INDEX/VIEW/TRIGGER). If you run this a second time, D1 will
-- error with "duplicate column name" on any column that's already there — that's expected
-- and means this part of the migration already succeeded; just remove that one line and
-- re-run the rest.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders: Stripe payment tracking columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN stripe_session_id        TEXT;
ALTER TABLE orders ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE orders ADD COLUMN payment_status           TEXT DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN paid_at                  TEXT;

-- Index for fast webhook lookups by stripe_session_id
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Products: which real Printful catalog product a listing is linked to (v2 catalog-
-- direct model — replaces the old printful_sync_product_id "Sync Product" concept,
-- which Printful's v2 API no longer supports). printful_variant_map already carries
-- the resolved {size: catalog_variant_id} pairs used at order time.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN printful_catalog_product_id INTEGER;
