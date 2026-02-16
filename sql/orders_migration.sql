-- Orders table for Worker /api/orders
-- Apply in Cloudflare D1 Console.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NULL,
  email       TEXT NOT NULL,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  address     TEXT NOT NULL,
  country     TEXT NOT NULL,
  state       TEXT NOT NULL,
  zip         TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  total_cents INTEGER NOT NULL,
  items_json  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'created',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email, created_at);
