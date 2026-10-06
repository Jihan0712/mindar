/* One-time cleanup of test data: T-shirts (garment_units) that no account owns. These are guest-checkout test orders and collar-tag codes from the old register-a-piece flow. With checkout now requiring an account, every real shirt has an owner from the moment it is paid. Run in the D1 Console one step at a time. */

/* STEP 1 — look first. Every row listed here will be deleted. */
select u.id, u.claim_code, u.order_id, u.created_at, p.title
from garment_units u left join products p on p.id = u.product_id
where u.owner_user_id is null;

/* STEP 2 — their video history (garment_layers points at the unit). */
delete from garment_layers where unit_id in (select id from garment_units where owner_user_id is null);

/* STEP 3 — the unowned T-shirts themselves. */
delete from garment_units where owner_user_id is null;
