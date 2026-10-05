-- Footer email signup ("Stay in the loop.") — one row per address.
-- Run this against your Cloudflare D1 database (D1 Console) before the storefront's
-- signup form goes live; until it exists, the form shows its "couldn't sign you up" error.

create table if not exists newsletter_signups (
  id integer primary key autoincrement,
  email text not null unique,
  source text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
