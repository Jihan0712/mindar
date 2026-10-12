/* When the admin checked a pressed shirt before shipping (Orders → Shirts, or scanning the
   shirt with a phone while signed in as admin). Paste into the D1 Console once. If it errors
   with "duplicate column name", it is already applied. */
alter table garment_units add column verified_at text null;
