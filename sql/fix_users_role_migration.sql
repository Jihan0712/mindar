-- Fixes two ways the live `users` table had drifted from sql/d1_schema.sql:
--   1. The role CHECK constraint only allowed ('admin','brand') — 'client' was missing,
--      which meant customer self-registration (POST /api/auth/register) was failing on
--      every attempt in production. SQLite can't ALTER a CHECK constraint in place, so
--      this rebuilds the table.
--   2. suspended_until (sql/user_moderation_migration.sql) had never been applied here —
--      folded into the same rebuild rather than a separate ALTER TABLE pass.
--
-- Safe to run once. Preserves every existing row (id, email, password_hash, role,
-- created_at) exactly as-is; only adds the missing role value and column.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin','brand','client')),
  suspended_until  TEXT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO users_new (id, email, password_hash, role, created_at)
  SELECT id, email, password_hash, role, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys = ON;
