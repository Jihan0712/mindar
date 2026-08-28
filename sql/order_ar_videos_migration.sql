-- Create order_ar_videos table (D1 / SQLite)
-- Stores each customer's personal AR video, one per (order, line-item) — the physical AR
-- marker stays whatever the purchased product is linked to (shared across every buyer of
-- that product); this table only holds the personal video overlay a customer uploads for
-- the specific shirt they ordered. A re-upload for the same (order_id, item_index) replaces
-- the previous row (the "edit" path), enforced by the unique constraint below.
--
-- Run this in the Cloudflare D1 Console for your database, or:
--   wrangler d1 execute mindardb --file sql/order_ar_videos_migration.sql

create table if not exists order_ar_videos (
  id          integer primary key autoincrement,
  order_id    text not null,
  item_index  integer not null,
  video_url   text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  foreign key (order_id) references orders(id) on delete cascade,
  unique(order_id, item_index)
);
