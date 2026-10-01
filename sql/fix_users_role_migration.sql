-- ALREADY APPLIED on the live D1 database. DO NOT RUN THIS AGAIN.
--
-- It rebuilt `users` to add the client role to the CHECK constraint and the
-- suspended_until column. The live users table already has both (columns:
-- id, email, password_hash, role, suspended_until, created_at).
--
-- Why it is dangerous to re-run on D1: it relied on PRAGMA foreign_keys = OFF, which
-- D1 ignores (D1 always enforces foreign keys). So its DROP TABLE users would cascade
-- and delete every row in sessions, brand_users, targets (all AR markers) and
-- brand_designs, and null out orders.user_id and garment_units.owner_user_id.
-- A leftover users_new table on the live database is from an attempt to run it again.
-- Remove it with the cleanup below.
--
-- The original statements are kept here as comments, for history only.
--
--   CREATE TABLE users_new (
--     id               TEXT PRIMARY KEY,
--     email            TEXT NOT NULL UNIQUE,
--     password_hash    TEXT NOT NULL,
--     role             TEXT NOT NULL CHECK (role IN ('admin','brand','client')),
--     suspended_until  TEXT NULL,
--     created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
--   )
--   INSERT INTO users_new (id, email, password_hash, role, created_at)
--     SELECT id, email, password_hash, role, created_at FROM users
--   DROP TABLE users
--   ALTER TABLE users_new RENAME TO users


-- ===== CLEANUP  remove the leftover users_new (D1 Console, one step at a time) =====

-- CHECK 1: must return no rows (nothing may point at users_new before it is dropped).
select name from sqlite_master where sql like '%users_new%' and name <> 'users_new';

-- CHECK 2: the live users table must list client in its role CHECK.
select sql from sqlite_master where name = 'users';

-- Only if CHECK 1 returned nothing and CHECK 2 shows client:
drop table users_new;
