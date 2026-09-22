-- Lets an owner name each version of a piece's layer ("Rooftop, 4am") so the version
-- history reads as something other than V1, V2, V3. Optional: the Worker stores and
-- returns layers without a name until this has run.
--
--   wrangler d1 execute mindardb --file sql/garment_layer_label_migration.sql

alter table garment_layers add column label text null;
