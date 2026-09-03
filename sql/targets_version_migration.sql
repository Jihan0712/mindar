-- Adds a version counter + last-updated timestamp to targets, so the AR viewer can show
-- "INRL-047 · V3 · UPDATED 12 AUG" the same way a wardrobe piece shows its own version —
-- bumped whenever a product's shared AR video is replaced (see apiUploadProductVideo).
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/targets_version_migration.sql

alter table targets add column version integer not null default 1;
alter table targets add column updated_at text;

update targets set updated_at = created_at where updated_at is null;
