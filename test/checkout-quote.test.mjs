// The checkout page's total comes from POST /api/checkout/quote, which prices the cart with
// the same code as POST /api/checkout/session, so the total shown is the total Stripe takes.
// Products also say whether checkout would accept them (`purchasable`), so the shop can keep
// "Add to bag" off for a piece that can't ship yet.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

const CUSTOMER = { firstName: 'B', lastName: 'One', email: 'buyer@example.com', address: '1 St', city: 'LA', country: 'US', state: 'CA', zip: '90001' };
const QR = JSON.stringify({ placement: 'back', size_in: 2, top_in: 10, left_in: 5, area_width_in: 12, area_height_in: 16 });

async function setup() {
  const h = await makeHarness({ PRINTFUL_API_KEY: 'pf_test' });
  const buyer = seedUser(h, 'buyer1', 'client');
  h.exec("insert into targets (id, user_id, name, mind_url, video_url, is_active) values (7, 'buyer1', 't', 'https://a/m.mind', 'https://a/v.mp4', 1)");
  const insert = (id, slug, extra) => h.exec(
    `insert into products (id, title, slug, price_cents, is_published, ar_target_id, printful_variant_map, printful_design_images, printful_qr)
     values (?, ?, ?, 2500, 1, ?, ?, ?, ?)`,
    id, slug, slug, extra.ar ? 7 : null, extra.map ?? null, extra.art ?? null, extra.qr ?? null);
  const MAP = JSON.stringify({ M: 4012 }), ART = JSON.stringify({ back: 'https://assets.test/back.png' });
  insert(1, 'ready-ar', { ar: true, map: MAP, art: ART, qr: QR });
  insert(2, 'ready-plain', { map: MAP, art: ART });
  insert(3, 'ar-no-qr', { ar: true, map: MAP, art: ART });
  insert(4, 'no-printful', {});
  insert(5, 'no-art', { map: MAP });
  h.onFetch((url, opts) => {
    if (url.endsWith('/shipping/rates')) return Response.json({ result: [{ id: 'STANDARD', name: 'Flat', rate: '4.99', currency: 'USD' }] });
    if (url.endsWith('/checkout/sessions') && opts.method === 'POST') return Response.json({ id: 'cs_1', url: 'https://stripe.test/cs_1' });
    return new Response('{}', { status: 404 });
  });
  return { h, buyer };
}

test('the quote is the total checkout charges, shipping included', async () => {
  const { h, buyer } = await setup();
  try {
    const body = { customer: CUSTOMER, cart: [{ slug: 'ready-ar', size: 'M', qty: 2 }] };
    const q = await h.call('POST', '/api/checkout/quote', { token: buyer, body });
    assert.equal(q.status, 200);
    assert.equal(q.json.items_cents, 5000);
    assert.equal(q.json.shipping_cents, 499);
    assert.equal(q.json.total_cents, 5499);

    const s = await h.call('POST', '/api/checkout/session', { token: buyer, body });
    assert.equal(s.status, 201);
    assert.equal(h.q('select total_cents from orders where id = ?', s.json.order_id)[0].total_cents, q.json.total_cents);
    assert.equal(h.q('select count(*) n from orders')[0].n, 1, 'a quote creates no order');
  } finally { h.restore(); }
});

test('the quote needs a session and refuses what checkout refuses', async () => {
  const { h, buyer } = await setup();
  try {
    const cart = [{ slug: 'no-printful', size: 'M', qty: 1 }];
    assert.equal((await h.call('POST', '/api/checkout/quote', { body: { customer: CUSTOMER, cart } })).status, 401);
    const q = await h.call('POST', '/api/checkout/quote', { token: buyer, body: { customer: CUSTOMER, cart } });
    assert.equal(q.status, 400);
    assert.match(q.json.error, /Not available for purchase yet/);
  } finally { h.restore(); }
});

test('purchasable matches what checkout would accept', async () => {
  const { h } = await setup();
  try {
    const res = await h.call('GET', '/api/products');
    const by = Object.fromEntries(res.json.items.map(p => [p.slug, p.purchasable]));
    assert.deepEqual(by, { 'ready-ar': true, 'ready-plain': true, 'ar-no-qr': false, 'no-printful': false, 'no-art': false });
  } finally { h.restore(); }
});
