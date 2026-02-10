-- Add support for storing uploaded product images in D1
-- Stores a Data URL string (e.g. data:image/png;base64,....)

ALTER TABLE products ADD COLUMN image_data TEXT NULL;
