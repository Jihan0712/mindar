# SQL migrations and normalization

This folder contains migrations and guidance for the database changes required by the admin UI.

## Migration: `001_enforce_single_active_target.sql`

Purpose:
- Enforce at-most-one `is_active = true` target per brand.
- Provide a SECURITY DEFINER RPC `set_active_target(p_target_id uuid)` that atomically switches the active target within the brand.

How to apply:
1. Open your Supabase project → SQL editor.
2. Paste the contents of `001_enforce_single_active_target.sql` and execute.

Possible error: `ERROR: 23505: could not create unique index "only_one_active_per_brand" DETAIL: Key (COALESCE(brand, '__GLOBAL__'::text))=(__GLOBAL__) is duplicated.`

This means some brand bucket currently has multiple rows with `is_active = true`. You must normalize before creating the unique index.

### Normalization (keep newest active per brand)
Run this in the SQL editor to keep the newest active entry per brand and clear other active flags:

```sql
WITH ranked AS (
  SELECT
    id,
    COALESCE(NULLIF(TRIM(brand), ''), '__GLOBAL__') AS brand_key,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(brand), ''), '__GLOBAL__')
      ORDER BY created_at DESC
    ) AS rn
  FROM public.targets
  WHERE is_active = true
)
UPDATE public.targets t
SET is_active = false
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;
```

After running the normalization, re-run the migration file to create the index and the RPC.

### Notes & alternatives
- If you'd rather keep the oldest active row, change `ORDER BY created_at DESC` to `ORDER BY created_at ASC`.
- If you have a numeric `brand_id`/tenant column, consider using that instead of the sentinel `__GLOBAL__` string to avoid collision edge cases.
- The migration grants `EXECUTE` on the RPC to the `authenticated` role — review and tighten permissions if necessary for your security policy.

## Rollback
- If you need to rollback changes, restore your database from backup. The normalization updates are destructive (they clear `is_active` flags), so backups are recommended before running.

## Questions
If you run the SQL and get errors, paste the exact error message here and I will help interpret and fix. If you want an automated one-shot migration that normalizes then creates the index and RPC, I can prepare it — but I kept steps separate so you can review the changes before applying destructive normalization.
