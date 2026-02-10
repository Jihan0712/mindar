-- Add support for storing up to 5 product image URLs (JSON array)

ALTER TABLE products ADD COLUMN image_urls TEXT NULL;
