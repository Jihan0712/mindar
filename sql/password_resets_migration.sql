/* One-time password reset links (POST /api/auth/forgot-password + /api/auth/reset-password). Only a SHA-256 of each token is stored. Safe to run more than once. */
create table if not exists password_resets (
  token_hash  text primary key,
  user_id     text not null,
  expires_at  text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  foreign key (user_id) references users(id) on delete cascade
);
create index if not exists idx_password_resets_user on password_resets(user_id);
