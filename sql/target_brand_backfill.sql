/* One-time backfill: give targets uploaded by an admin (brand_id null) the brand of the product they are linked to, so brand-scoped viewer links (?brand=) and the brand's own target list find them. New links are kept in sync by the Worker (syncTargetBrandFromProduct). Never overwrites a brand a target already has. Safe to run more than once. */
update targets
set brand_id = (
  select p.brand_id from products p
  where p.ar_target_id = targets.id and p.brand_id is not null
  order by p.id limit 1
)
where brand_id is null
  and exists (select 1 from products p where p.ar_target_id = targets.id and p.brand_id is not null);
