-- Printful per-placement design layer (editable transform) migration
-- Adds a JSON map of placement -> {sourceUrl, left, top, scaleX, scaleY, angle}: the raw
-- uploaded design plus its exact position/scale/rotation on the product-designer canvas.
-- This is purely so the admin dashboard can reopen a product and keep editing the design
-- instead of starting over — it is never sent to Printful and never exposed on the public
-- storefront product endpoint. The actual print-ready file Printful uses is the flattened
-- composite stored in printful_design_images (see printful_design_images_migration.sql).
-- Example: {"front":{"sourceUrl":"https://.../raw.png","left":40,"top":20,"scaleX":0.8,"scaleY":0.8,"angle":0}}
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/printful_design_layers_migration.sql

ALTER TABLE products ADD COLUMN printful_design_layers TEXT NULL;
