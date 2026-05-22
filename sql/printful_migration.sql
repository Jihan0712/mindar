-- Printful print-on-demand integration migration
-- Apply in Cloudflare D1 Console.
--
-- REQUIRED: run sql/orders_migration.sql first to create the orders table,
-- then run this file.

-- Add Printful sync variant ID to products so each product maps to a
-- Printful sync product variant (configured in the Printful dashboard).
ALTER TABLE products ADD COLUMN printful_sync_variant_id TEXT NULL;

-- Add city to orders (required by Printful recipient address).
ALTER TABLE orders ADD COLUMN city TEXT NOT NULL DEFAULT '';

-- Track the Printful order that was created for each store order.
ALTER TABLE orders ADD COLUMN printful_order_id TEXT NULL;

-- Mirror the Printful fulfillment status (e.g. draft, pending, inprocess, fulfilled, canceled).
ALTER TABLE orders ADD COLUMN printful_status TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_printful_id ON orders(printful_order_id);
