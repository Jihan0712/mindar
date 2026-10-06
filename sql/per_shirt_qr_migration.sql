/* Per-shirt QR printed at order time (docs/superpowers/specs/2026-10-02-per-shirt-qr-design.md). Paste into the D1 Console once. ALTER TABLE ADD COLUMN fails if the column already exists, so if a line errors with "duplicate column name", skip it and run the rest. */

/* Where each shirt's QR prints: {placement, size_in, top_in, left_in, area_width_in, area_height_in}. */
alter table products add column printful_qr text null;

/* A shirt's slot in its order (unit_index runs 0..qty-1 within the line) and its QR image. */
alter table garment_units add column item_index integer null;
alter table garment_units add column unit_index integer null;
alter table garment_units add column qr_url text null;

/* Makes minting idempotent: re-running it for an order only fills missing slots. NULLs are distinct in SQLite, so older pieces with no order are unaffected. */
create unique index if not exists idx_garment_units_order_slot
  on garment_units(order_id, item_index, unit_index);
