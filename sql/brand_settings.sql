-- Create table to hold per-brand limits for active targets
create table if not exists public.brand_settings (
  brand text primary key,
  max_active integer not null default 3 check (max_active >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.brand_settings is 'Per-brand configuration (currently: maximum number of concurrently active targets).';
comment on column public.brand_settings.max_active is 'Maximum number of concurrently active targets for this brand. Default 3.';
