-- List brands with current active count and configured limit (defaults to 3)
create or replace function public.get_brand_limits()
returns table(brand text, active_count int, max_active int)
language sql
security definer
set search_path = public
as $$
  with b as (
    select coalesce(t.brand, '') as brand,
           count(*) filter (where t.is_active) as active_count
    from public.targets t
    group by coalesce(t.brand, '')
  )
  select b.brand,
         b.active_count,
         coalesce(s.max_active, 3) as max_active
  from b
  left join public.brand_settings s on s.brand = b.brand
  order by b.brand;
$$;

-- Admin-only: set or update a brand's max active limit
create or replace function public.set_brand_max_active(p_brand text, p_limit int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_brand is null or length(trim(p_brand)) = 0 then
    raise exception 'Brand is required';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'Limit must be >= 0';
  end if;
  -- Only admins may change limits
  if not public.is_admin() then
    raise exception 'Only admins can change brand limit';
  end if;
  insert into public.brand_settings(brand, max_active, updated_at)
  values (trim(p_brand), p_limit, now())
  on conflict (brand) do update
    set max_active = excluded.max_active,
        updated_at = now();
end;
$$;
