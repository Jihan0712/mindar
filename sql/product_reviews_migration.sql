-- Create product reviews table (D1 / SQLite)

create table if not exists product_reviews (
  id integer primary key autoincrement,
  product_id integer not null,
  product_slug text,
  rating integer not null check (rating between 1 and 5),
  author text,
  comment text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index if not exists idx_product_reviews_product_created_at
  on product_reviews (product_id, created_at);
