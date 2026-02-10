-- One-time migration: add required attributes to products
-- Run this against your D1 database.

ALTER TABLE products ADD COLUMN category TEXT NULL;
ALTER TABLE products ADD COLUMN color TEXT NULL;
ALTER TABLE products ADD COLUMN sizes TEXT NULL;
