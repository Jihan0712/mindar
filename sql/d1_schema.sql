-- Cloudflare D1 (SQLite) schema used by cloudflare/worker/index.js
-- Apply in the Cloudflare Dashboard (D1 → your DB → Console) or via your preferred migration flow.

PRAGMA foreign_keys = ON;

-- ---------- Auth ----------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','brand','client')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------- Brands / Limits ----------

CREATE TABLE IF NOT EXISTS brands (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS brand_users (
  user_id  TEXT NOT NULL,
  brand_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, brand_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS brand_limits (
  brand_id   INTEGER PRIMARY KEY,
  max_active INTEGER NOT NULL DEFAULT 3,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

-- ---------- AR Targets ----------

CREATE TABLE IF NOT EXISTS targets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  brand_id   INTEGER NULL,
  name       TEXT NOT NULL,
  product    TEXT NULL,
  mind_url   TEXT NOT NULL,
  video_url  TEXT NOT NULL,
  image_url  TEXT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_brand_active ON targets(brand_id, is_active);
CREATE INDEX IF NOT EXISTS idx_targets_brand_product ON targets(brand_id, product);

-- ---------- Products (Shop ↔ AR linking) ----------

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id     INTEGER NULL,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  category     TEXT NULL,
  color        TEXT NULL,
  sizes        TEXT NULL,
  description  TEXT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  image_url    TEXT NULL,
  image_data   TEXT NULL,
  is_published INTEGER NOT NULL DEFAULT 0,
  ar_target_id INTEGER NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  FOREIGN KEY (ar_target_id) REFERENCES targets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_products_brand_published ON products(brand_id, is_published);
