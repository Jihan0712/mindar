-- Printful per-placement design image migration
-- Adds a JSON map of placement -> design image URL (the print-file source used for
-- Printful mockup rendering), independent of the storefront gallery (image_url/image_urls).
-- Example: {"front":"https://.../front.png","back":"https://.../back.png"}
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/printful_design_images_migration.sql

ALTER TABLE products ADD COLUMN printful_design_images TEXT NULL;
