-- Lets an owner name each version of a piece's layer ("Rooftop, 4am") so the version
-- history reads as something other than V1, V2, V3. Optional: the Worker stores and
-- returns layers without a name until this has run.
--
-- Only for databases whose garment_layers was created before `label` was added to
-- sql/wardrobe_migration.sql / sql/d1_schema.sql. A database set up from those files already
-- has the column, and this will fail with "duplicate column name: label" (harmless).
--
--   wrangler d1 execute mindardb --file sql/garment_layer_label_migration.sql

alter table garment_layers add column label text null;
