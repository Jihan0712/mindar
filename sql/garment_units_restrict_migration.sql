-- garment_units.product_id: ON DELETE CASCADE -> ON DELETE RESTRICT
--
-- Why: under CASCADE, deleting one product silently wiped every buyer of that product,
-- their wardrobe pieces and (through garment_layers) their whole AR layer history.
-- With RESTRICT the database refuses that delete. The Worker also refuses it with a
-- readable 409 (apiDeleteProduct). Unpublish a product to take it off the shop instead.
--
-- Only needed for databases created while product_id was still ON DELETE CASCADE.
-- A database set up from the current sql/d1_schema.sql or sql/wardrobe_migration.sql
-- already has RESTRICT. Needs the label column on garment_layers (it is copied).
--
-- HOW TO RUN (Cloudflare dashboard, Storage and Databases, D1, mindardb, Console):
-- paste ONE step at a time, run it, check the result, then move on.
-- Nothing is deleted until STEP 5, after you have checked the counts in STEP 4.
-- The swap in STEP 3 is done with renames, so the original tables stay available
-- as garment_units_old / garment_layers_old until you drop them.
--
-- Comments in this file avoid semicolons and apostrophes on purpose, so the D1
-- Console splits the statements correctly.


-- ===== STEP 1  clear leftovers from any earlier attempt =====
-- Safe in any state. The live garment_units / garment_layers are not touched.

drop table if exists garment_layers_new;
drop table if exists garment_units_new;
drop table if exists garment_layers_backup;
drop table if exists garment_units_backup;
drop table if exists garment_layers_old;
drop table if exists garment_units_old;


-- ===== STEP 2  create the new empty tables next to the live ones =====

create table garment_units_new (
  id              text primary key,
  claim_code      text not null unique,
  product_id      integer not null,
  order_id        text null,
  nickname        text null,
  owner_user_id   text null,
  claimed_at      text null,
  scan_count      integer not null default 0,
  last_scanned_at text null,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  foreign key (product_id) references products(id) on delete restrict,
  foreign key (order_id) references orders(id) on delete set null,
  foreign key (owner_user_id) references users(id) on delete set null
);

create table garment_layers_new (
  id         integer primary key autoincrement,
  unit_id    text not null,
  video_url  text not null,
  version    integer not null,
  label      text null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  foreign key (unit_id) references garment_units_new(id) on delete cascade
);


-- ===== STEP 3  copy the data and swap the tables =====
-- Copies right before the swap so nothing written in between is missed.
-- Renaming garment_units_new to garment_units also repoints the foreign key
-- in garment_layers_new automatically.

insert into garment_units_new
  (id, claim_code, product_id, order_id, nickname, owner_user_id, claimed_at, scan_count, last_scanned_at, created_at)
select
  id, claim_code, product_id, order_id, nickname, owner_user_id, claimed_at, scan_count, last_scanned_at, created_at
from garment_units;

insert into garment_layers_new (id, unit_id, video_url, version, label, created_at)
select id, unit_id, video_url, version, label, created_at
from garment_layers;

drop index if exists idx_garment_units_owner;
drop index if exists idx_garment_units_product;
drop index if exists idx_garment_layers_unit;

alter table garment_layers rename to garment_layers_old;
alter table garment_units rename to garment_units_old;
alter table garment_units_new rename to garment_units;
alter table garment_layers_new rename to garment_layers;

create index idx_garment_units_owner on garment_units(owner_user_id);
create index idx_garment_units_product on garment_units(product_id);
create index idx_garment_layers_unit on garment_layers(unit_id, version);


-- ===== STEP 4  check (run these, nothing changes) =====
-- units must equal units_old, and layers must equal layers_old.
-- The first foreign key list must show products with RESTRICT.
-- The second must show garment_units with CASCADE.

select (select count(*) from garment_units) as units, (select count(*) from garment_units_old) as units_old, (select count(*) from garment_layers) as layers, (select count(*) from garment_layers_old) as layers_old;
select "table", on_delete from pragma_foreign_key_list('garment_units');
select "table", on_delete from pragma_foreign_key_list('garment_layers');

-- If anything looks wrong, undo the swap instead of continuing:
--   alter table garment_layers rename to garment_layers_new
--   alter table garment_units rename to garment_units_new
--   alter table garment_units_old rename to garment_units
--   alter table garment_layers_old rename to garment_layers
-- (one per line, each ending with a semicolon when you paste it)


-- ===== STEP 5  remove the old tables (only after STEP 4 looks right) =====

drop table garment_layers_old;
drop table garment_units_old;
