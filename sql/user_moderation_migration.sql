-- Account moderation: lets admin time out (temporarily suspend) a user login.
-- Role changes and deletion use existing columns/tables — no schema change needed for those.
-- Run once; SQLite/D1 has no `ADD COLUMN IF NOT EXISTS`, so re-running this errors
-- ("duplicate column name") if already applied — that's expected and harmless.

ALTER TABLE users ADD COLUMN suspended_until TEXT NULL;
