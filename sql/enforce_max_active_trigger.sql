-- Trigger function to enforce the maximum number of active targets per brand
create or replace function public.enforce_brand_max_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_active int;
begin
  -- Only enforce when brand is present and we are activating a row
  if coalesce(new.brand,'') = '' then
    return new;
  end if;

  if new.is_active is distinct from true then
    return new;
  end if;

  -- Determine the limit for this brand (fallback to 3 if not configured)
  select max_active into v_limit from public.brand_settings where brand = new.brand;
  if v_limit is null then
    v_limit := 3;
  end if;

  -- Count other active rows for the same brand (exclude this row by id when present)
  select count(*) into v_active
  from public.targets t
  where t.brand = new.brand
    and t.is_active = true
    and (new.id is null or t.id <> new.id);

  if v_active >= v_limit then
    raise exception 'Max active targets for brand % is % (current active: %)', new.brand, v_limit, v_active
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- (Re)create trigger on targets
drop trigger if exists trg_enforce_brand_max_active on public.targets;
create trigger trg_enforce_brand_max_active
before insert or update of is_active, brand on public.targets
for each row
execute function public.enforce_brand_max_active();
