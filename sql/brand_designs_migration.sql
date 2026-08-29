-- Brand design submissions — a brand uploads a raw design image here (no product yet);
-- admin reviews the queue, builds the real product (Printful link, price, AR marker) around
-- it, and assigns the finished product back to the brand via products.brand_id. No status/
-- product_id tracking column: the "queue" is just the current rows, and admin deletes an
-- entry once they've built the product from it.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS brand_designs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id    INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  name        TEXT NULL,
  note        TEXT NULL,
  image_url   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_designs_brand ON brand_designs(brand_id, created_at);
