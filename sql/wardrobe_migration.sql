-- Wardrobe: a customer claims one specific physical garment (via a short code printed on
-- a tag inside the collar) and controls the AR layer it plays, independent of which order
-- it was originally sold under — so it keeps working if the piece is lent, resold, or
-- handed down. See sql/d1_schema.sql for how this fits alongside `targets`/`products`
-- (the shared physical marker + default video) and `order_ar_videos` (the older, order-
-- scoped personal video, kept for existing orders).
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/wardrobe_migration.sql

create table if not exists garment_units (
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
  foreign key (product_id) references products(id) on delete cascade,
  foreign key (order_id) references orders(id) on delete set null,
  foreign key (owner_user_id) references users(id) on delete set null
);

create index if not exists idx_garment_units_owner on garment_units(owner_user_id);
create index if not exists idx_garment_units_product on garment_units(product_id);

-- One row per upload; the current layer for a unit is the row with the highest `version`.
-- A unit with zero rows here has no layer yet ("not published").
create table if not exists garment_layers (
  id         integer primary key autoincrement,
  unit_id    text not null,
  video_url  text not null,
  version    integer not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  foreign key (unit_id) references garment_units(id) on delete cascade
);

create index if not exists idx_garment_layers_unit on garment_layers(unit_id, version);
