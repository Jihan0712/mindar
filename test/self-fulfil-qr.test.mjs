// Admin self-fulfil (shirts and QR codes without Printful) and the rule that a QR is never
// printed without PUBLIC_SITE_URL. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

const SITE = 'https://shop.inrl.co';

async function setup(vars, { stripeStatus = 'open', withSession = true } = {}) {
  const h = await makeHarness(vars);
  const admin = seedUser(h, 'admin1', 'admin');
  const buyer = seedUser(h, 'buyer1', 'client');
  h.exec("insert into targets (id, user_id, name, mind_url, video_url, is_active) values (7, 'admin1', 't', 'https://a/m.mind', 'https://a/v.mp4', 1)");
  h.exec(`insert into products (id, title, slug, price_cents, is_published, ar_target_id, printful_qr)
          values (19, 'INRL BETA', 'inrl-beta', 1900, 1, 7, ?)`,
    JSON.stringify({ placement: 'front', size_in: 2.5, top_in: 13, left_in: 9, area_width_in: 12, area_height_in: 16 }));
  h.exec(`insert into orders (id, user_id, email, first_name, last_name, address, country, state, zip, total_cents,
                              items_json, status, payment_status, stripe_session_id)
          values ('ord_1', 'buyer1', 'buyer1@test', 'B', 'One', '1 St', 'US', 'CA', '90001', 1900, ?, 'pending_payment', 'unpaid', ?)`,
    JSON.stringify([{ slug: 'inrl-beta', size: 'M', qty: 2, name: 'INRL BETA (M)' }]), withSession ? 'cs_1' : null);
  h.onFetch((url, opts) => {
    if (url.endsWith('/checkout/sessions/cs_1')) return Response.json({ id: 'cs_1', status: stripeStatus });
    if (url.endsWith('/checkout/sessions/cs_1/expire')) return Response.json({ id: 'cs_1', status: 'expired' });
    return new Response('{}', { status: 404 });
  });
  return { h, admin, buyer };
}

const order = h => h.q("select status, payment_status, printful_status, printful_order_id from orders where id = 'ord_1'")[0];
const units = h => h.q("select claim_code, owner_user_id, qr_url from garment_units where order_id = 'ord_1' order by unit_index");

test('self-fulfil mints the buyer\'s shirts with QR codes on PUBLIC_SITE_URL and sends nothing to Printful', async () => {
  const { h, admin } = await setup({ PUBLIC_SITE_URL: SITE + '/' });
  try {
    const r = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, shirts: 2, qr_codes: 2 });
    assert.deepEqual(order(h), { status: 'paid', payment_status: 'paid', printful_status: 'self', printful_order_id: null });
    const us = units(h);
    assert.equal(us.length, 2);
    for (const u of us) {
      assert.equal(u.owner_user_id, 'buyer1');
      const obj = h.ASSETS_BUCKET.objects.get(`qr/${u.claim_code}.png`);
      assert.ok(obj, 'QR image stored');
      assert.equal(obj.customMetadata.size_in, '2.5');
      assert.ok(u.qr_url.endsWith(`qr/${u.claim_code}.png`));
    }
    const pieces = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin });
    assert.deepEqual(pieces.json.items.map(i => i.link), us.map(u => `${SITE}/p/${u.claim_code}`));
    assert.ok(h.outside.some(c => c.url.endsWith('/checkout/sessions/cs_1/expire') && c.method === 'POST'), 'open Stripe session expired');
    assert.ok(!h.outside.some(c => c.url.includes('printful')), 'Printful never called');
  } finally { h.restore(); }
});

test('without PUBLIC_SITE_URL no QR is stored, on-screen links keep the request host, and a rerun fills the QR in', async () => {
  const { h, admin, buyer } = await setup({});
  try {
    const r = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /PUBLIC_SITE_URL/);
    assert.equal(order(h).printful_status, 'self');
    assert.equal(units(h).length, 2);
    assert.ok(units(h).every(u => u.qr_url === null));
    assert.equal([...h.ASSETS_BUCKET.objects.keys()].filter(k => k.startsWith('qr/')).length, 0);

    const code = units(h)[0].claim_code;
    const pieces = await h.call('GET', '/api/admin/orders/ord_1/pieces', { token: admin, host: 'https://shop.example' });
    assert.equal(pieces.json.items[0].link, `https://shop.example/p/${code}`);
    const unitId = h.q('select id from garment_units where claim_code = ?', code)[0].id;
    const piece = await h.call('GET', `/api/pieces/${unitId}`, { token: buyer, host: 'https://shop.example' });
    assert.equal(piece.json.viewer_url, `https://shop.example/p/${code}`);

    h.env.PUBLIC_SITE_URL = SITE;
    const again = await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin });
    assert.equal(again.status, 200, again.text);
    assert.deepEqual(again.json, { ok: true, shirts: 2, qr_codes: 2 });
    assert.equal(units(h).length, 2, 'rerun mints nothing new');
  } finally { h.restore(); }
});

test('refused when Stripe already took the payment, for non-admins, and Resubmit to Printful refuses a self order', async () => {
  const paid = await setup({ PUBLIC_SITE_URL: SITE }, { stripeStatus: 'complete' });
  try {
    const r = await paid.h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: paid.admin });
    assert.equal(r.status, 409);
    assert.equal(order(paid.h).payment_status, 'unpaid');
    assert.equal(units(paid.h).length, 0);
    const nonAdmin = await paid.h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: paid.buyer });
    assert.equal(nonAdmin.status, 403);
  } finally { paid.h.restore(); }

  const self = await setup({ PUBLIC_SITE_URL: SITE }, { withSession: false });
  try {
    assert.equal((await self.h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: self.admin })).status, 200);
    const resub = await self.h.call('POST', '/api/admin/orders/ord_1/resubmit', { token: self.admin });
    assert.equal(resub.status, 409);
    assert.ok(!self.h.outside.some(c => c.url.includes('printful')));
  } finally { self.h.restore(); }
});

test('a late Stripe "session expired" event leaves a self-fulfilled order paid', async () => {
  const secret = 'whsec_test';
  const { h, admin } = await setup({ PUBLIC_SITE_URL: SITE, STRIPE_WEBHOOK_SECRET: secret });
  try {
    assert.equal((await h.call('POST', '/api/admin/orders/ord_1/self-fulfil', { token: admin })).status, 200);
    const body = JSON.stringify({ type: 'checkout.session.expired', data: { object: { id: 'cs_1', metadata: { order_id: 'ord_1' } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const res = await h.callRaw('POST', '/api/webhooks/stripe', body, { 'Stripe-Signature': `t=${t},v1=${sig}` });
    assert.equal(res.status, 200);
    assert.deepEqual(order(h), { status: 'paid', payment_status: 'paid', printful_status: 'self', printful_order_id: null });
  } finally { h.restore(); }
});
